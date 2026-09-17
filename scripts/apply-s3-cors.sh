#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${S3_BUCKET:-}" ]]; then
  echo "S3_BUCKET is not set. Run: S3_BUCKET=<bucket-name> APP_ORIGIN=<your-eb-url> bash scripts/apply-s3-cors.sh" >&2
  exit 1
fi

if [[ -z "${APP_ORIGIN:-}" ]]; then
  echo "APP_ORIGIN is not set. Run: S3_BUCKET=<bucket-name> APP_ORIGIN=<your-eb-url> bash scripts/apply-s3-cors.sh" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cors_rules="$(sed "s#__APP_ORIGIN__#$APP_ORIGIN#" "$here/s3-cors.json")"

aws s3api put-bucket-cors \
  --bucket "$S3_BUCKET" \
  --cors-configuration "{\"CORSRules\": $cors_rules}"

echo "CORS applied to $S3_BUCKET. Current rules:"
aws s3api get-bucket-cors --bucket "$S3_BUCKET"
