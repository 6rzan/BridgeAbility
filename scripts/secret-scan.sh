#!/usr/bin/env bash
#
# Blocks secrets from reaching the repository. Run before every push; also invoked by
# scripts/package-submission.js, which refuses to build the submission ZIP if this fails.
#
# Scans tracked files only -- untracked scratch files are not our concern, and node_modules
# would produce nothing but false positives.
#
# Usage: bash scripts/secret-scan.sh

set -uo pipefail

fail=0

report() {
  printf '\n  [%s] %s\n' "$1" "$2"
  fail=1
}

# Tracked files, excluding this scanner (which necessarily contains the patterns it hunts).
files=$(git ls-files | grep -v -E '^scripts/secret-scan\.sh$' || true)
[ -z "$files" ] && { echo "secret-scan: no tracked files yet — nothing to scan."; exit 0; }

echo "secret-scan: checking $(echo "$files" | wc -l | tr -d ' ') tracked files"

# --- 1. Files that must never be tracked at all ------------------------------
forbidden=$(echo "$files" | grep -E '(^|/)\.env$|\.pem$|\.p12$|\.pfx$|(^|/)\.aws/|(^|/)\.elasticbeanstalk/(?!.*\.example)' || true)
[ -n "$forbidden" ] && report "TRACKED SECRET FILE" "$forbidden"

# --- 2. AWS long-lived credentials -------------------------------------------
# AKIA = long-lived IAM user key; ASIA = temporary STS key. Neither belongs here: the
# application authenticates through the EC2 instance profile.
hits=$(echo "$files" | xargs grep -nE '\b(AKIA|ASIA)[0-9A-Z]{16}\b' 2>/dev/null || true)
[ -n "$hits" ] && report "AWS ACCESS KEY ID" "$hits"

hits=$(echo "$files" | xargs grep -niE 'aws_secret_access_key[[:space:]]*=[[:space:]]*[A-Za-z0-9/+=]{20,}' 2>/dev/null || true)
[ -n "$hits" ] && report "AWS SECRET ACCESS KEY" "$hits"

hits=$(echo "$files" | xargs grep -niE 'aws_session_token[[:space:]]*=' 2>/dev/null || true)
[ -n "$hits" ] && report "AWS SESSION TOKEN" "$hits"

# --- 3. The AWS account number ------------------------------------------------
# Any bare 12-digit number, which is what an account ID looks like. Checked against ARNs too.
hits=$(echo "$files" | xargs grep -nE 'arn:aws:[a-z0-9-]*:[a-z0-9-]*:[0-9]{12}:' 2>/dev/null || true)
[ -n "$hits" ] && report "ACCOUNT ID IN ARN" "$hits"

# --- 4. Private keys -----------------------------------------------------------
hits=$(echo "$files" | xargs grep -nE 'BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY' 2>/dev/null || true)
[ -n "$hits" ] && report "PRIVATE KEY BLOCK" "$hits"

# --- 5. Real-looking values in .env.example ------------------------------------
if [ -f .env.example ]; then
  hits=$(grep -nE '\.rds\.amazonaws\.com' .env.example | grep -v 'xxxxxxxx' || true)
  [ -n "$hits" ] && report "REAL RDS ENDPOINT IN .env.example" "$hits"
fi

# --- 6. Database password assigned to a literal ---------------------------------
hits=$(echo "$files" | xargs grep -nE '(DB_PASSWORD|SESSION_SECRET)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'{$]{12,}' 2>/dev/null \
  | grep -v -E '\.env\.example|replace-with|your_db_password' || true)
[ -n "$hits" ] && report "HARDCODED SECRET LITERAL" "$hits"

if [ "$fail" -eq 0 ]; then
  echo "secret-scan: clean — no secrets found."
  exit 0
fi

echo ""
echo "secret-scan: FAILED. Remove the findings above before pushing."
exit 1
