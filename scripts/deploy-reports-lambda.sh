#!/usr/bin/env bash

set -euo pipefail

region="${AWS_REGION:-us-east-1}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
service_dir="$repo_root/services/reports"
function_name="${LAMBDA_FUNCTION_NAME:-bridgeability-reports}"
api_name="${API_GATEWAY_NAME:-bridgeability-reports-api}"
stage_name="${API_GATEWAY_STAGE:-prod}"
timeline_table="${DDB_TIMELINE_TABLE:-BridgeAbility_BookingTimeline}"

native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    echo "$1"
  fi
}

echo "== Installing MS-2's own dependencies =="
(cd "$service_dir" && npm install --omit=dev)

echo
echo "== Packaging =="
build_dir="$repo_root/.build/reports-lambda"
zip_path="$repo_root/.build/reports-lambda.zip"
rm -rf "$build_dir" "$zip_path"
mkdir -p "$build_dir"
cp -r "$service_dir/." "$build_dir/"
rm -rf "$build_dir/README.md"

if command -v zip >/dev/null 2>&1; then
  (cd "$build_dir" && zip -qr "$zip_path" .)
elif command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$(native_path "$build_dir")\\*' -DestinationPath '$(native_path "$zip_path")' -Force"
else
  echo "deploy-reports-lambda: no zip tool found (need 'zip' or 'powershell.exe')" >&2
  exit 1
fi
echo "packaged: $zip_path ($(du -h "$zip_path" | cut -f1))"
zip_path_for_cli="$(native_path "$zip_path")"

echo
echo "== Resolving LabRole =="
role_arn="$(aws iam get-role --role-name LabRole --query 'Role.Arn' --output text --region "$region")"
account_id="$(aws sts get-caller-identity --query Account --output text)"
echo "role: $role_arn"

echo
echo "== Creating or updating the Lambda function =="
env_json="$(node -e "console.log(JSON.stringify({ Variables: { DDB_TIMELINE_TABLE: '$timeline_table' } }))")"

if aws lambda get-function --function-name "$function_name" --region "$region" >/dev/null 2>&1; then
  echo "lambda: $function_name exists, updating code and config"
  aws lambda update-function-code --function-name "$function_name" --region "$region" \
    --zip-file "fileb://$zip_path_for_cli" >/dev/null
  aws lambda wait function-updated --function-name "$function_name" --region "$region"
  aws lambda update-function-configuration --function-name "$function_name" --region "$region" \
    --runtime nodejs24.x --handler index.handler --role "$role_arn" \
    --timeout 15 --memory-size 256 --environment "$env_json" >/dev/null
  aws lambda wait function-updated --function-name "$function_name" --region "$region"
else
  echo "lambda: creating $function_name"
  aws lambda create-function --function-name "$function_name" --region "$region" \
    --runtime nodejs24.x --handler index.handler --role "$role_arn" \
    --timeout 15 --memory-size 256 --environment "$env_json" \
    --zip-file "fileb://$zip_path_for_cli" >/dev/null
  aws lambda wait function-active --function-name "$function_name" --region "$region"
fi
function_arn="$(aws lambda get-function --function-name "$function_name" --region "$region" --query 'Configuration.FunctionArn' --output text)"
echo "lambda: $function_arn"

echo
echo "== API Gateway REST API =="
api_id="$(aws apigateway get-rest-apis --region "$region" \
  --query "items[?name=='$api_name'].id | [0]" --output text)"

if [ "$api_id" = "None" ] || [ -z "$api_id" ]; then
  echo "apigateway: creating $api_name"
  api_id="$(aws apigateway create-rest-api --name "$api_name" --region "$region" \
    --endpoint-configuration types=REGIONAL --query id --output text)"
else
  echo "apigateway: $api_name already exists ($api_id)"
fi

root_resource_id="$(aws apigateway get-resources --rest-api-id "$api_id" --region "$region" \
  --query "items[?path=='/'].id | [0]" --output text)"

ensure_resource() {
  local parent_id="$1"
  local path_part="$2"
  local existing
  existing="$(aws apigateway get-resources --rest-api-id "$api_id" --region "$region" \
    --query "items[?parentId=='$parent_id' && pathPart=='$path_part'].id | [0]" --output text)"
  if [ "$existing" = "None" ] || [ -z "$existing" ]; then
    aws apigateway create-resource --rest-api-id "$api_id" --region "$region" \
      --parent-id "$parent_id" --path-part "$path_part" --query id --output text
  else
    echo "$existing"
  fi
}

reports_resource_id="$(ensure_resource "$root_resource_id" "reports")"
endpoint_resource_id="$(ensure_resource "$reports_resource_id" "recently-completed")"
echo "apigateway: /reports/recently-completed -> resource $endpoint_resource_id"

echo
echo "== GET method + Lambda proxy integration =="
if ! aws apigateway get-method --rest-api-id "$api_id" --resource-id "$endpoint_resource_id" \
    --http-method GET --region "$region" >/dev/null 2>&1; then
  aws apigateway put-method --rest-api-id "$api_id" --resource-id "$endpoint_resource_id" \
    --http-method GET --authorization-type NONE --region "$region" >/dev/null
  echo "apigateway: GET method created"
else
  echo "apigateway: GET method already exists"
fi

integration_uri="arn:aws:apigateway:$region:lambda:path/2015-03-31/functions/$function_arn/invocations"
aws apigateway put-integration --rest-api-id "$api_id" --resource-id "$endpoint_resource_id" \
  --http-method GET --type AWS_PROXY --integration-http-method POST \
  --uri "$integration_uri" --region "$region" >/dev/null
echo "apigateway: Lambda proxy integration set"

echo
echo "== Lambda permission for API Gateway to invoke it =="
source_arn="arn:aws:execute-api:$region:$account_id:$api_id/*/GET/reports/recently-completed"
if ! aws lambda get-policy --function-name "$function_name" --region "$region" 2>/dev/null \
    | grep -q "$api_id"; then
  aws lambda add-permission --function-name "$function_name" --region "$region" \
    --statement-id "apigateway-$api_id" --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com --source-arn "$source_arn" >/dev/null
  echo "lambda: permission granted to $api_id"
else
  echo "lambda: permission already granted to $api_id"
fi

echo
echo "== Deploying the stage =="
aws apigateway create-deployment --rest-api-id "$api_id" --stage-name "$stage_name" \
  --region "$region" >/dev/null
invoke_url="https://$api_id.execute-api.$region.amazonaws.com/$stage_name"
echo "apigateway: deployed to $stage_name"

echo
echo "== Done =="
echo "$invoke_url"
echo
echo "Verify directly: curl \"$invoke_url/reports/recently-completed\""
echo
echo "Then set this on the Elastic Beanstalk environment (eb setenv or the console):"
echo
echo "  REPORTS_API_URL=$invoke_url"
