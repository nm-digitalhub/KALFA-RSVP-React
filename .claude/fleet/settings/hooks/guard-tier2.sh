#!/usr/bin/env bash
# Fleet PreToolUse guard — TIER-2 VARIANT (main-executor only).
#
# Derived from guard.sh with EXACTLY ONE carve-out: `supabase db query` is
# allowed (the main role's live-DB door — the owner's per-request verdict is
# the authorization). Every other protection is identical: SUMIT/billing,
# messaging/calling scripts, git history, infra, inline interpreters,
# secrets, raw egress. Registered ONLY in tier2.settings.json.

set -u

INPUT="$(cat 2>/dev/null || true)"
if [ -z "$INPUT" ]; then
  echo "fleet-guard: empty hook input — blocking (fail-closed)" >&2
  exit 2
fi

CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
if [ -z "$CMD" ]; then
  # Not a Bash command payload (or unparsable) — nothing for this guard to
  # inspect. Non-Bash tools are governed by the settings allow/deny rules.
  exit 0
fi

block() {
  echo "fleet-guard: blocked — $1" >&2
  exit 2
}

# Normalize whitespace for matching (keep original for the log).
C="$(printf '%s' "$CMD" | tr '\n' ' ')"

# --- Database: Tier-2 door — ONLY `supabase db query` (runs as postgres on
# the LIVE project; the owner per-request verdict is the authorization).
# Every other supabase subcommand (push/reset/migration/link/gen/...) stays
# blocked, as does psql.
if echo "$C" | grep -Eiq '(^|[;&| ])supabase([ ]|$)'; then
  echo "$C" | grep -Eq '(^|[;&| ])supabase[ ]+db[ ]+query([ ]|$)' \
    || block "only 'supabase db query' is allowed at Tier-2 (no push/reset/migration)"
fi
echo "$C" | grep -Eiq '(^|[;&| ])psql([ ]|$)' && block "psql is Tier-2 (prod DB)"
# Read-only SQL door: the fleet CLI 'sql' subcommand enforces read-only at the
# connection level; any OTHER attempt to smuggle SQL mutations through it is
# still caught server-side. Nothing to regex here beyond the CLI itself.

# --- Customer-facing / money scripts (Tier-2 by definition) -----------------
echo "$C" | grep -Eiq 'send-one-invite|send-email-file|bridge-call|whatsapp-send|deploy-.*-template' \
  && block "customer messaging / calling scripts are Tier-2"
echo "$C" | grep -Eiq 'sumit' && block "SUMIT / billing scripts are Tier-2"

# --- Git history / merge / release protections ------------------------------
echo "$C" | grep -Eq 'git[ ]+push[^;&|]*(--force|-f([ ]|$)|\+[a-zA-Z])' && block "force-push is forbidden"
echo "$C" | grep -Eq 'git[ ]+push[^;&|]*[ ]origin[ ]+main([ ]|$)' && block "direct push to main is forbidden (PR only)"
echo "$C" | grep -Eq 'gh[ ]+pr[ ]+merge' && block "PR merge is owner-only"
echo "$C" | grep -Eq 'gh[ ]+(issue|repo)[ ]+delete' && block "gh delete is forbidden"
echo "$C" | grep -Eq 'git[ ]+(branch[ ]+-D|push[^;&|]*--delete)' && block "branch deletion is owner-only"

# --- Process / infra mutations ----------------------------------------------
echo "$C" | grep -Eq 'pm2[ ]+(delete|kill|save|resurrect|unstartup|startup)' && block "pm2 lifecycle mutations are owner-only"
echo "$C" | grep -Eq 'pm2[ ]+restart([ ]+|$)' && { echo "$C" | grep -Eq 'pm2[ ]+restart[ ]+kalfa-beta([ ]|$)' || block "pm2 restart is allowed only for kalfa-beta"; }
echo "$C" | grep -Eiq '(^|[;&| ])(nginx|systemctl|service|plesk|iptables|ufw|shutdown|reboot|mount|useradd|usermod|chown[ ]+root)([ ]|$)' \
  && block "system administration is owner-only"
echo "$C" | grep -Eq 'rm[ ]+-[a-zA-Z]*r[a-zA-Z]*f|rm[ ]+-[a-zA-Z]*f[a-zA-Z]*r' && block "recursive force delete is forbidden"
echo "$C" | grep -Eiq '(^|[;&| ])crontab([ ]|$)' && block "crontab is unavailable to the fleet"

# --- Inline interpreters (would bypass every path rule) ---------------------
echo "$C" | grep -Eq '(^|[;&| ])node[ ]+(-e|--eval|-p([ ]|$))' && block "inline node is forbidden"
echo "$C" | grep -Eq '(^|[;&| ])(bash|sh|zsh)[ ]+-c([ ]|$)' && block "inline shell -c is forbidden"
echo "$C" | grep -Eq '(^|[;&| ])(python3?|perl|ruby)([ ]|$)' && block "generic interpreters are forbidden"
echo "$C" | grep -Eq '(^|[;&| ])(eval|source)([ ]|$)' && block "shell eval/source is forbidden"

# --- Secrets / sensitive files ----------------------------------------------
echo "$C" | grep -Eq '\.env(\.|[ ]|$)|\.token\.env|vox_ci_credentials' && block "secret files are off-limits"
echo "$C" | grep -Eq 'agent_configs/' && block "agent_configs is managed only via the documented ElevenLabs workflow"

# --- Network egress beyond the allowed CLIs ---------------------------------
echo "$C" | grep -Eiq '(^|[;&| ])(curl|wget|nc|ncat|telnet|ftp)([ ]|$)' && block "raw network egress is forbidden"

exit 0
