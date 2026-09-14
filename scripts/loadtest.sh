#!/usr/bin/env bash
#
# Thin wrapper so this fits the rest of scripts/'s bash-entrypoint convention. The actual work
# is in loadtest.js -- see that file's header for why it has to be Node (signing in and
# carrying a CSRF token needs a real HTTP client, not the autocannon CLI).
#
# Usage: BASE_URL=http://<env>.elasticbeanstalk.com bash scripts/loadtest.sh [duration-seconds] [connections]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$here/loadtest.js" "$@"
