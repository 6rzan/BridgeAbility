#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${S3_BUCKET:-}" ]]; then
  echo "S3_BUCKET is not set. Run: S3_BUCKET=<bucket-name> bash scripts/apply-s3-cors.sh" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

aws s3api put-bucket-cors \
  --bucket "$S3_BUCKET" \
  --cors-configuration "{\"CORSRules\": $(cat "$here/s3-cors.json")}"

echo "CORS applied to $S3_BUCKET. Current rules:"
aws s3api get-bucket-cors --bucket "$S3_BUCKET"
