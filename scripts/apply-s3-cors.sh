#!/usr/bin/env bash
#
# Apply the bucket CORS rule that F3's listing-image upload depends on.
#
# WHY THIS IS NEEDED AT ALL
#
# The image goes from the browser straight to S3 over a presigned PUT (see
# providerListingService.presignImageUpload), so the request leaves our origin and lands on
# s3.amazonaws.com. PUT is not a CORS-simple method, so the browser sends a preflight OPTIONS
# first and refuses to make the real request unless the bucket answers it. Without this rule
# the upload fails in the browser with a CORS error while every server-side test passes --
# which is exactly the class of defect that only a real browser on the deployed URL reveals.
#
# WHY IT IS NOT A SECURITY HOLE
#
# CORS is not access control. It tells a browser which origins may *read a response* from a
# cross-origin request; it grants nobody the right to write to the bucket. The right to write
# comes from the presigned URL alone, which the backend mints only for a provider who owns the
# listing, and which binds the key, the content type and the exact byte length into its
# signature. Block Public Access stays fully on and no bucket policy grants anonymous access.
# The origin list is our environment only, not "*".
#
# Run this once per bucket, from a machine with lab credentials. It is idempotent.
#
# Usage: S3_BUCKET=<bucket-name> bash scripts/apply-s3-cors.sh

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
