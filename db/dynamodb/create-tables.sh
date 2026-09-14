#!/usr/bin/env bash
# Creates both DynamoDB tables this application needs, from their tracked definitions.
#
# Idempotent: if a table already exists this reports it and moves on rather than failing, so
# it is safe to re-run after every AWS Academy lab reset (the tables do not survive a reset any
# more than the RDS instance or the Beanstalk environment do).
#
# Usage: AWS_REGION=us-east-1 bash db/dynamodb/create-tables.sh
set -euo pipefail

region="${AWS_REGION:-us-east-1}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Every definition is read with `cat` and handed to Node over stdin, never as a path Node
# itself resolves. On Windows, `cd ... && pwd` (used for `here` above) produces an MSYS-style
# path like /c/Users/..., which bash's own file-reading (cat, the `<` redirection below) always
# understands -- but a *native* Windows Node.js binary does not, so `require('/c/Users/...')`
# fails with MODULE_NOT_FOUND even though the file is right there. Reading over stdin sidesteps
# the whole path-format question: bash opens the file however it needs to, Node only ever sees
# bytes.

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

# create-table only runs once, on a table that does not yet exist -- a table left over from a
# partial or older provisioning attempt (exactly what this project hit: a BridgeAbility_
# BookingTimeline table existed with GSI-1 but not GSI-2, from a session that never finished)
# needs its GSIs reconciled separately, since DynamoDB has no "create table or add whatever is
# missing" operation. This compares the tracked definition's GSI names against what the live
# table actually has and adds each one that is missing, one at a time (UpdateTable allows only
# one GSI change per call).
reconcile_gsis() {
  local json="$1"
  local table_name="$2"

  local wanted_names
  wanted_names="$(node -e "
    const def = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    for (const gsi of def.GlobalSecondaryIndexes || []) console.log(gsi.IndexName);
  " <<< "$json")"
  [ -z "$wanted_names" ] && return

  # --output text joins multiple values with a TAB, not a space (confirmed directly -- `cat -A`
  # on real output showed GSI-2^IGSI-1, not GSI-2 GSI-1), so this converts to one name per line
  # and matches a whole line, rather than assuming a space-separated list.
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

# TTL cannot be set at creation time -- it is a separate call, and it errors if TTL is already
# enabled, so check first. See sessionStore.js for why expiresAt is also enforced in code: TTL
# deletion is documented as "typically" happening within days of expiry, not at it.
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
