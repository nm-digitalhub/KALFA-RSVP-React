#!/usr/bin/env bash
# Run the LOCAL-ONLY integration suite (vitest.integration.config.mts).
#
# Credentials come ONLY from the running local stack (`supabase status`), never
# from .env/.env.local. The run is refused unless DB is 127.0.0.1:54322 and the
# API is http://127.0.0.1:54321; the Vitest globalSetup and every test file
# re-check the same targets through test-db-guard before touching anything.
#
#   bash scripts/integration/run-local.sh [extra vitest args]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

[[ -x ./node_modules/.bin/vitest ]] || { echo '[STOP] local vitest binary missing (no auto-install)' >&2; exit 2; }
SUPA=(supabase); command -v supabase >/dev/null 2>&1 || SUPA=(./node_modules/.bin/supabase)

STATUS="$("${SUPA[@]}" status -o env 2>/dev/null)" || { echo '[STOP] local Supabase stack is not running (supabase status)' >&2; exit 2; }
val() { printf '%s\n' "$STATUS" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -1; }
DB_URL="$(val DB_URL)"; API_URL="$(val API_URL)"; SERVICE_ROLE_KEY="$(val SERVICE_ROLE_KEY)"; ANON_KEY="$(val ANON_KEY)"

[[ -n "$DB_URL" && -n "$API_URL" && -n "$SERVICE_ROLE_KEY" ]] || { echo '[STOP] local DB_URL / API_URL / SERVICE_ROLE_KEY not found' >&2; exit 2; }
[[ "$DB_URL" =~ ^postgres(ql)?://[^@]+@(127\.0\.0\.1|localhost):54322/ ]] || { echo '[STOP] DB_URL is not Supabase local 127.0.0.1:54322' >&2; exit 2; }
[[ "$API_URL" =~ ^http://(127\.0\.0\.1|localhost):54321$ ]] || { echo '[STOP] API_URL is not http://127.0.0.1:54321' >&2; exit 2; }

echo '[TARGET] DB  127.0.0.1:54322 (local)  API http://127.0.0.1:54321 (local)'
# Production variables are blanked for the child so nothing can fall back to them.
env -u NEXT_PUBLIC_SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_HOST \
  OUTREACH_DB_IT=1 \
  OUTREACH_TEST_DB_URL="$DB_URL" \
  OUTREACH_TEST_SUPABASE_URL="$API_URL" \
  OUTREACH_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  OUTREACH_TEST_ANON_KEY="$ANON_KEY" \
  ./node_modules/.bin/vitest run --config vitest.integration.config.mts "$@"
