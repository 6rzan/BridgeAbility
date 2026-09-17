#!/usr/bin/env bash

set -euo pipefail

region="${AWS_REGION:-us-east-1}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
service_dir="$repo_root/services/notification"
function_name="${LAMBDA_FUNCTION_NAME:-bridgeability-notification}"
queue_name="${SQS_QUEUE_NAME:-bridgeability-notifications}"
notifications_table="${DDB_NOTIFICATIONS_TABLE:-BridgeAbility_Notifications}"

native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    echo "$1"
  fi
}

echo "== Installing MS-1's own dependencies =="
(cd "$service_dir" && npm install --omit=dev)

echo
echo "== Packaging =="
build_dir="$repo_root/.build/notification-lambda"
zip_path="$repo_root/.build/notification-lambda.zip"
rm -rf "$build_dir" "$zip_path"
mkdir -p "$build_dir"
cp -r "$service_dir/." "$build_dir/"
rm -rf "$build_dir/README.md"

if command -v zip >/dev/null 2>&1; then
  (cd "$build_dir" && zip -qr "$zip_path" .)
elif command -v powershell.exe >/dev/null 2>&1; then
  build_dir_win="$(native_path "$build_dir")"
  zip_path_win="$(native_path "$zip_path")"
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$build_dir_win\\*' -DestinationPath '$zip_path_win' -Force"
else
  echo "deploy-notification-lambda: no zip tool found (need 'zip' or 'powershell.exe')" >&2
  exit 1
fi
echo "packaged: $zip_path ($(du -h "$zip_path" | cut -f1))"

zip_path_for_cli="$(native_path "$zip_path")"

echo
echo "== Resolving LabRole and the queue ARN =="
role_arn="$(aws iam get-role --role-name LabRole --query 'Role.Arn' --output text --region "$region")"
queue_url="$(aws sqs get-queue-url --queue-name "$queue_name" --region "$region" --query QueueUrl --output text)"
queue_arn="$(aws sqs get-queue-attributes --queue-url "$queue_url" --attribute-names QueueArn --region "$region" --query 'Attributes.QueueArn' --output text)"
echo "role: $role_arn"
echo "queue: $queue_arn"

echo
echo "== Creating or updating the Lambda function =="
env_json="$(node -e "console.log(JSON.stringify({ Variables: { DDB_NOTIFICATIONS_TABLE: '$notifications_table' } }))")"

if aws lambda get-function --function-name "$function_name" --region "$region" >/dev/null 2>&1; then
  echo "lambda: $function_name exists, updating code and config"
  aws lambda update-function-code --function-name "$function_name" --region "$region" \
    --zip-file "fileb://$zip_path_for_cli" >/dev/null
  aws lambda wait function-updated --function-name "$function_name" --region "$region"
  aws lambda update-function-configuration --function-name "$function_name" --region "$region" \
    --runtime nodejs24.x --handler index.handler --role "$role_arn" \
    --timeout 30 --memory-size 256 --environment "$env_json" >/dev/null
  aws lambda wait function-updated --function-name "$function_name" --region "$region"
else
  echo "lambda: creating $function_name"
  aws lambda create-function --function-name "$function_name" --region "$region" \
    --runtime nodejs24.x --handler index.handler --role "$role_arn" \
    --timeout 30 --memory-size 256 --environment "$env_json" \
    --zip-file "fileb://$zip_path_for_cli" >/dev/null
  aws lambda wait function-active --function-name "$function_name" --region "$region"
fi
function_arn="$(aws lambda get-function --function-name "$function_name" --region "$region" --query 'Configuration.FunctionArn' --output text)"
echo "lambda: $function_arn"

echo
echo "== Wiring the SQS event source mapping =="
existing_mapping_uuid="$(aws lambda list-event-source-mappings --function-name "$function_name" \
  --event-source-arn "$queue_arn" --region "$region" --query 'EventSourceMappings[0].UUID' --output text)"

if [ "$existing_mapping_uuid" != "None" ] && [ -n "$existing_mapping_uuid" ]; then
  echo "lambda: event source mapping already exists ($existing_mapping_uuid), leaving it"
else
  aws lambda create-event-source-mapping --function-name "$function_name" \
    --event-source-arn "$queue_arn" --region "$region" \
    --batch-size 10 --function-response-types ReportBatchItemFailures >/dev/null
  echo "lambda: event source mapping created (batch size 10, partial-failure reporting on)"
fi

echo
echo "== Done =="
echo "$function_arn"
echo "Test it end to end: publish a message to the SNS topic (or accept/reject a real booking"
echo "once SNS_BOOKING_EVENTS_TOPIC_ARN is set on the Elastic Beanstalk environment) and check"
echo "CloudWatch Logs for /aws/lambda/$function_name."
