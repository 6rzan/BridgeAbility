#!/usr/bin/env bash

set -euo pipefail

region="${AWS_REGION:-us-east-1}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

create_table() {
  local definition="$1"
  local json
  json="$(cat "$definition")"
  local table_name
  table_name="$(node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).TableName)" <<< "$json")"

  if aws dynamodb describe-table --table-name "$table_name" --region "$region" >/dev/null 2>&1; then
    echo "dynamodb: $table_name already exists, skipping creation"
  else
    echo "dynamodb: creating $table_name"
    aws dynamodb create-table --region "$region" --cli-input-json "$json" >/dev/null
    aws dynamodb wait table-exists --table-name "$table_name" --region "$region"
    echo "dynamodb: $table_name active"
  fi

  reconcile_gsis "$json" "$table_name"
}

reconcile_gsis() {
  local json="$1"
  local table_name="$2"

  local wanted_names
  wanted_names="$(node -e "
    const def = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    for (const gsi of def.GlobalSecondaryIndexes || []) console.log(gsi.IndexName);
  " <<< "$json")"
  [ -z "$wanted_names" ] && return

  local existing_names
  existing_names="$(aws dynamodb describe-table --table-name "$table_name" --region "$region" \
    --query 'Table.GlobalSecondaryIndexes[].IndexName' --output text 2>/dev/null | tr '\t' '\n' || true)"

  while IFS= read -r gsi_name; do
    [ -z "$gsi_name" ] && continue
    if printf '%s\n' "$existing_names" | grep -qFx "$gsi_name"; then
      echo "dynamodb: $table_name.$gsi_name already exists, skipping"
      continue
    fi

    echo "dynamodb: $table_name is missing $gsi_name -- adding it"
    aws dynamodb wait table-exists --table-name "$table_name" --region "$region"

    local update_json
    update_json="$(GSI_NAME="$gsi_name" node -e "
      const def = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      const gsi = def.GlobalSecondaryIndexes.find((g) => g.IndexName === process.env.GSI_NAME);
      // Every attribute the GSI's own key schema needs, not the whole table's attribute list --
      // UpdateTable rejects attribute-definitions for names the update does not actually use.
      const neededNames = new Set(gsi.KeySchema.map((k) => k.AttributeName));
      const attrs = def.AttributeDefinitions.filter((a) => neededNames.has(a.AttributeName));
      console.log(JSON.stringify({ AttributeDefinitions: attrs, GlobalSecondaryIndexUpdates: [{ Create: gsi }] }));
    " <<< "$json")"

    aws dynamodb update-table --table-name "$table_name" --region "$region" \
      --cli-input-json "$update_json" >/dev/null
    aws dynamodb wait table-exists --table-name "$table_name" --region "$region"
    echo "dynamodb: $table_name.$gsi_name created (backfilling in the background if the table already has items)"
  done <<< "$wanted_names"
}

create_table "$here/booking-timeline-table.json"
create_table "$here/sessions-table.json"
create_table "$here/notifications-table.json"

echo "dynamodb: checking TTL on BridgeAbility_Sessions"
ttl_status="$(aws dynamodb describe-time-to-live \
  --table-name BridgeAbility_Sessions --region "$region" \
  --query 'TimeToLiveDescription.TimeToLiveStatus' --output text 2>/dev/null || echo "DISABLED")"

if [ "$ttl_status" = "ENABLED" ] || [ "$ttl_status" = "ENABLING" ]; then
  echo "dynamodb: TTL already $ttl_status"
else
  aws dynamodb update-time-to-live \
    --table-name BridgeAbility_Sessions --region "$region" \
    --time-to-live-specification "Enabled=true,AttributeName=expiresAt" >/dev/null
  echo "dynamodb: TTL enabled on BridgeAbility_Sessions (attribute: expiresAt)"
fi

echo "dynamodb: done"
