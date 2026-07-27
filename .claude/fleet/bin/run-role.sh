#!/usr/bin/env bash
# Run one fleet role as a headless Claude session. Invoked by scheduler.mjs
# (schedule slot or answer-watcher) or manually: bin/run-role.sh <role>.
#
# Safety order: KILLSWITCH -> role enabled -> global flock (serializes ALL
# fleet work and guarantees never-parallel `next build`) -> hard timeout.
# Every outcome (including lock-skip) leaves a line in runs/index.ndjson, so
# the chief-of-staff digest sees failures and skips, not just successes.

set -uo pipefail

FLEET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$FLEET_DIR/../.." && pwd)"
LOGS_DIR="$REPO_DIR/.fleet-logs"
RUNS_DIR="$LOGS_DIR/runs"
LOCK_FILE="$LOGS_DIR/locks/global.lock"
CONFIG="$FLEET_DIR/fleet.json"

ROLE="${1:-}"
[ -z "$ROLE" ] && { echo "usage: run-role.sh <role>" >&2; exit 1; }

mkdir -p "$RUNS_DIR" "$LOGS_DIR/locks"
STAMP="$(date +%Y%m%dT%H%M%S)"
TRACE="$RUNS_DIR/$STAMP-$ROLE"

index_line() {
  printf '%s\n' "$1" >> "$RUNS_DIR/index.ndjson"
}

if [ -f "$FLEET_DIR/KILLSWITCH" ]; then
  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"skipped\":\"killswitch\"}"
  exit 0
fi

ENABLED="$(jq -r --arg r "$ROLE" '.roles[$r].enabled // false' "$CONFIG")"
if [ "$ENABLED" != "true" ]; then
  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"skipped\":\"disabled\"}"
  exit 0
fi

TIER="$(jq -r --arg r "$ROLE" '.roles[$r].tier // 0' "$CONFIG")"
MODEL="$(jq -r --arg r "$ROLE" '.roles[$r].model // "sonnet"' "$CONFIG")"
TIMEOUT_MIN="$(jq -r --arg r "$ROLE" '.roles[$r].timeout_minutes // 20' "$CONFIG")"
SETTINGS="$FLEET_DIR/settings/tier$TIER.settings.json"
ROLE_PROMPT="$FLEET_DIR/roles/$ROLE.md"

if [ ! -f "$ROLE_PROMPT" ]; then
  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"error\":\"missing role prompt\"}"
  exit 1
fi

# Long-lived token for headless runs (survives interactive-login expiry).
# 0600, gitignored; created by the owner via `claude setup-token`.
if [ -f "$FLEET_DIR/.token.env" ]; then
  # shellcheck disable=SC1091
  . "$FLEET_DIR/.token.env"
  export CLAUDE_CODE_OAUTH_TOKEN
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"skipped\":\"lock\"}"
  exit 0
fi

PROMPT="$(cat "$ROLE_PROMPT"; "$FLEET_DIR/bin/run-context.sh" "$ROLE")"

index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"started\":\"$STAMP\",\"model\":\"$MODEL\",\"tier\":$TIER}"

timeout --kill-after=60 "${TIMEOUT_MIN}m" \
  claude -p "$PROMPT" \
    --permission-mode dontAsk \
    --setting-sources project \
    --settings "$SETTINGS" \
    --model "$MODEL" \
    --output-format json \
    > "$TRACE.json" 2> "$TRACE.err"
STATUS=$?

SESSION_ID="$(jq -r '.session_id // empty' "$TRACE.json" 2>/dev/null || true)"
COST="$(jq -r '.total_cost_usd // 0' "$TRACE.json" 2>/dev/null || echo 0)"
index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"finished\":\"$STAMP\",\"exit\":$STATUS,\"session_id\":\"$SESSION_ID\",\"cost_usd\":$COST}"

exit "$STATUS"
