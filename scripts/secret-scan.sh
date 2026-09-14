#!/usr/bin/env bash

set -uo pipefail

fail=0

report() {
  printf '\n  [%s] %s\n' "$1" "$2"
  fail=1
}

files=$(git ls-files | grep -v -E '^scripts/secret-scan\.sh$' || true)
[ -z "$files" ] && { echo "secret-scan: no tracked files yet — nothing to scan."; exit 0; }

echo "secret-scan: checking $(echo "$files" | wc -l | tr -d ' ') tracked files"

forbidden=$(echo "$files" | grep -E '(^|/)\.env$|\.pem$|\.p12$|\.pfx$|(^|/)\.aws/|(^|/)\.elasticbeanstalk/(?!.*\.example)' || true)
[ -n "$forbidden" ] && report "TRACKED SECRET FILE" "$forbidden"

hits=$(echo "$files" | xargs grep -nE '\b(AKIA|ASIA)[0-9A-Z]{16}\b' 2>/dev/null || true)
[ -n "$hits" ] && report "AWS ACCESS KEY ID" "$hits"

hits=$(echo "$files" | xargs grep -niE 'aws_secret_access_key[[:space:]]*=[[:space:]]*[A-Za-z0-9/+=]{20,}' 2>/dev/null || true)
[ -n "$hits" ] && report "AWS SECRET ACCESS KEY" "$hits"

hits=$(echo "$files" | xargs grep -niE 'aws_session_token[[:space:]]*=' 2>/dev/null || true)
[ -n "$hits" ] && report "AWS SESSION TOKEN" "$hits"

hits=$(echo "$files" | xargs grep -nE 'arn:aws:[a-z0-9-]*:[a-z0-9-]*:[0-9]{12}:' 2>/dev/null || true)
[ -n "$hits" ] && report "ACCOUNT ID IN ARN" "$hits"

hits=$(echo "$files" | xargs grep -nE 'BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY' 2>/dev/null || true)
[ -n "$hits" ] && report "PRIVATE KEY BLOCK" "$hits"

if [ -f .env.example ]; then
  hits=$(grep -nE '\.rds\.amazonaws\.com' .env.example | grep -v 'xxxxxxxx' || true)
  [ -n "$hits" ] && report "REAL RDS ENDPOINT IN .env.example" "$hits"
fi

hits=$(echo "$files" | xargs grep -nE '(DB_PASSWORD|SESSION_SECRET)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'{$]{12,}' 2>/dev/null \
  | grep -v -E '\.env\.example|replace-with|your_db_password|placeholder' || true)
[ -n "$hits" ] && report "HARDCODED SECRET LITERAL" "$hits"

if [ "$fail" -eq 0 ]; then
  echo "secret-scan: clean — no secrets found."
  exit 0
fi

echo ""
echo "secret-scan: FAILED. Remove the findings above before pushing."
exit 1
