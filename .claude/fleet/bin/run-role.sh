#!/usr/bin/env bash
# Run one fleet role as a headless Claude session. Invoked by scheduler.mjs
# (schedule slot, inquiry-watcher or answer-watcher) or manually:
# bin/run-role.sh <role> [reason]. `reason` says WHY this run exists —
# slot | reactive:<trigger> | verdict:<request-id> | manual (default). It is
# recorded in the index and shown to the role; without it the role could not
# tell an answer-watcher spawn from its schedule and misdiagnosed a verdict
# loop as "cron" (2026-09-27).
#
# Safety order: role argument -> KILLSWITCH -> role enabled -> global flock
# (serializes ALL fleet work and guarantees never-parallel `next build`) ->
# hard timeout. Every outcome (including lock-skip) leaves a line in
# runs/index.ndjson, so the chief-of-staff digest sees failures and skips, not
# just successes.
#
# KILLSWITCH stays the FIRST gate that can stop work. Only two checks precede
# it — that REPO_DIR and HOME are real directories — and they are not gates on
# work: they are the preconditions for `mkdir` and for writing the index at
# all, so a killswitch skip can still be recorded. Everything else that can
# refuse a run (config present, `claude` resolvable) is deliberately placed
# AFTER the killswitch, so flipping the switch always wins.

# set -e is deliberate but NOT universal: the `claude` invocation below is
# guarded with `|| STATUS=$?` because a failing run MUST still reach its
# index line. A bare `set -e` there would abort before the finished record is
# written — making a failure quieter, which is the opposite of the point.
set -euo pipefail

# HOME and PATH are pinned HERE rather than inherited, so a role behaves the
# same whether the scheduler was started cleanly, restarted, or invoked by
# hand. Order matters: REPO_DIR must be resolved before HOST_DIR reads it.
# It was the other way round on 2026-07-29, and because the unbound expansion
# happened inside $( ), only the SUBSHELL died: HOST_DIR came out empty, HOME
# became "", PATH became "/.supabase/bin:...", and every role then failed with
# exit 127 while writing a corrupt index line. `set -u` reported it; nothing
# acted on it. That is why `set -e` and the preflight below now exist.
FLEET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$FLEET_DIR/../.." && pwd)"
HOST_DIR="$(cd "$REPO_DIR/.." && pwd)"
export HOME="$HOST_DIR"
export PATH="$HOST_DIR/.supabase/bin:$HOST_DIR/.local/bin:/usr/local/bin:/usr/bin:/bin"
LOGS_DIR="$REPO_DIR/.fleet-logs"
RUNS_DIR="$LOGS_DIR/runs"
LOCK_FILE="$LOGS_DIR/locks/global.lock"
CONFIG="$FLEET_DIR/fleet.json"

ROLE="${1:-}"
[ -z "$ROLE" ] && { echo "usage: run-role.sh <role> [reason]" >&2; exit 1; }
# Allowlisted shape only: the reason reaches a file name, the index and the
# prompt, so anything unexpected collapses to "unknown" rather than flowing on.
REASON="${2:-manual}"
[[ "$REASON" =~ ^(slot|manual|reactive:[a-z_]+|verdict:[0-9a-f-]{36})$ ]] || REASON="unknown"

# Structural preconditions only — see the safety-order note above. Without
# these, `mkdir` and the index write below cannot happen, so there would be no
# way to RECORD a killswitch skip. stderr is what the scheduler captures in
# locks/spawn-<role>.log; the distinct exit code 70 separates "the fleet is
# mis-wired" from "a role failed".
[ -d "$REPO_DIR" ] || { echo "run-role: repository directory not found: $REPO_DIR" >&2; exit 70; }
[ -d "$HOME" ]     || { echo "run-role: HOME directory not found: '$HOME'" >&2; exit 70; }

mkdir -p "$RUNS_DIR" "$LOGS_DIR/locks"
STAMP="$(date +%Y%m%dT%H%M%S)"
TRACE="$RUNS_DIR/$STAMP-$ROLE"

# One record, one line, always parseable. The validation is not decoration:
# on 2026-07-28 a single `"cost_usd":}` (an empty jq result interpolated into
# the record) stopped every STREAMING parser at that line, hiding 41 later
# records from the chief-of-staff digest. The rescue record is BUILT BY jq,
# not string-interpolated: a role name carrying a quote would otherwise break
# the very record written to report a broken record.
index_line() {
  local record="$1"
  if printf '%s' "$record" | jq -e . >/dev/null 2>&1; then
    printf '%s\n' "$record" >> "$RUNS_DIR/index.ndjson"
    return 0
  fi
  echo "run-role: refused to write malformed index record" >&2
  jq -cn \
    --arg ts "$(date -Is)" \
    --arg role "$ROLE" \
    --arg error "malformed index record suppressed" \
    '{ts:$ts, role:$role, error:$error}' >> "$RUNS_DIR/index.ndjson"
}

if [ -f "$FLEET_DIR/KILLSWITCH" ]; then
  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"skipped\":\"killswitch\"}"
  exit 0
fi

# Operational preflight — AFTER the killswitch, so the switch always wins.
[ -f "$CONFIG" ] || { echo "run-role: fleet config not found: $CONFIG" >&2; exit 70; }
command -v claude >/dev/null 2>&1 \
  || { echo "run-role: claude not found in PATH=$PATH" >&2; exit 127; }

# Validate the config ONCE, loudly. fleet.json is owner-edited and the
# scheduler re-reads it every 60s, so a half-written file is a real state, not
# a hypothetical. This check exists because `set -e` (added 2026-07-29) turned
# that state into a SILENT death: a bare `ENABLED="$(jq … "$CONFIG")"` on
# malformed JSON aborts the script at that line — measured exit 5, zero index
# records — where the previous `set -uo` merely yielded an empty ENABLED and
# recorded `skipped:disabled`. Hardening must not convert a logged condition
# into an unlogged one; every jq read below is safe only because of this gate.
if ! jq -e . "$CONFIG" >/dev/null 2>&1; then
  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"error\":\"fleet.json is not valid JSON\"}"
  echo "run-role: fleet config is not valid JSON: $CONFIG" >&2
  exit 78
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

# Optional per-role overrides (fleet.json): "settings": "<name>" uses
# settings/<name>.settings.json instead of the tier default, and
# "mcp_config": "<name>" adds --mcp-config settings/<name>.mcp.json. Added
# 27.9.2026 so only the design roles get Claude Design (tier0-design + design).
# Names are restricted to [a-z0-9-] so fleet.json cannot point outside settings/.
SETTINGS_NAME="$(jq -r --arg r "$ROLE" '.roles[$r].settings // empty' "$CONFIG")"
MCP_NAME="$(jq -r --arg r "$ROLE" '.roles[$r].mcp_config // empty' "$CONFIG")"
for n in "$SETTINGS_NAME" "$MCP_NAME"; do
  if [ -n "$n" ] && ! [[ "$n" =~ ^[a-z0-9-]+$ ]]; then
    index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"error\":\"invalid settings/mcp_config name\"}"
    exit 78
  fi
done
[ -n "$SETTINGS_NAME" ] && SETTINGS="$FLEET_DIR/settings/$SETTINGS_NAME.settings.json"
MCP_ARGS=()
[ -n "$MCP_NAME" ] && MCP_ARGS=(--mcp-config "$FLEET_DIR/settings/$MCP_NAME.mcp.json")
if [ ! -f "$SETTINGS" ] || { [ -n "$MCP_NAME" ] && [ ! -f "$FLEET_DIR/settings/$MCP_NAME.mcp.json" ]; }; then
  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"error\":\"missing settings/mcp_config file\"}"
  exit 1
fi

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
  index_line "$(jq -cn --arg ts "$(date -Is)" --arg role "$ROLE" --arg reason "$REASON" \
    '{ts:$ts, role:$role, skipped:"lock", reason:$reason}')"
  exit 0
fi

# A real run for a verdict: one byte per run that actually got the lock.
# scheduler.mjs (verdict-guard.mjs) caps these per verdict — lock-skips above
# never reach this line, so they cannot strand a verdict by themselves.
if [[ "$REASON" == verdict:* ]]; then
  printf '.' >> "$LOGS_DIR/locks/verdict-${REASON#verdict:}.starts"
fi

PROMPT="$(cat "$ROLE_PROMPT"; "$FLEET_DIR/bin/run-context.sh" "$ROLE" "$REASON")"

# Built by jq, not interpolated — same reason as index_line's rescue record.
index_line "$(jq -cn --arg ts "$(date -Is)" --arg role "$ROLE" --arg started "$STAMP" \
  --arg model "$MODEL" --argjson tier "$TIER" --arg reason "$REASON" \
  '{ts:$ts, role:$role, started:$started, model:$model, tier:$tier, reason:$reason}')"

# `|| STATUS=$?` — see the set -e note at the top. A non-zero run must still
# reach the index line below; without the guard, set -e would exit here.
STATUS=0
timeout --kill-after=60 "${TIMEOUT_MIN}m" \
  claude -p "$PROMPT" \
    --permission-mode dontAsk \
    --setting-sources project \
    --settings "$SETTINGS" \
    "${MCP_ARGS[@]}" \
    --model "$MODEL" \
    --output-format json \
    > "$TRACE.json" 2> "$TRACE.err" || STATUS=$?

# jq on an EMPTY trace prints nothing and exits 0, so `|| echo 0` never fires
# and the old code interpolated an empty string. Absent values become JSON
# null explicitly — a missing cost is a fact worth recording, not a syntax error.
SESSION_ID="$(jq -r '.session_id // empty' "$TRACE.json" 2>/dev/null || true)"
COST="$(jq -r '.total_cost_usd // empty' "$TRACE.json" 2>/dev/null || true)"
[ -n "$COST" ] || COST=null
if [ -n "$SESSION_ID" ]; then SESSION_JSON="\"$SESSION_ID\""; else SESSION_JSON=null; fi
index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"finished\":\"$STAMP\",\"exit\":$STATUS,\"session_id\":$SESSION_JSON,\"cost_usd\":$COST}"

exit "$STATUS"
