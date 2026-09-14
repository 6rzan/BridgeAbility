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

create_table() {
  local definition="$1"
  local table_name
  table_name="$(node -e "console.log(require('$definition').TableName)")"

  if aws dynamodb describe-table --table-name "$table_name" --region "$region" >/dev/null 2>&1; then
    echo "dynamodb: $table_name already exists, skipping"
    return
  fi

  echo "dynamodb: creating $table_name"
  aws dynamodb create-table --region "$region" --cli-input-json "file://$definition" >/dev/null
  aws dynamodb wait table-exists --table-name "$table_name" --region "$region"
  echo "dynamodb: $table_name active"
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
