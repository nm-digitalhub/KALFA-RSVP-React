#!/usr/bin/env bash
# Fleet PreToolUse guard — the hook-layer wall of the tier system.
#
# Registered ONLY in the fleet tier settings files (tier0/tier1.settings.json),
# so it never affects the owner's interactive sessions. Runs before permission
# evaluation; exit 2 BLOCKS the tool call and no allow rule can override it.
# Fail-closed: unparsable input blocks.
#
# Blocks Tier-2 surfaces even if a future allowlist edit accidentally opens
# them: prod-DB mutations, customer messaging / charging / calling scripts,
# repo-history and infra mutations, inline interpreters, and voice-agent
# config edits.

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

# --- Database: no Supabase CLI, no psql, no migration/DDL paths -------------
# Allow only the harmless local CLI version check.
if echo "$C" | grep -Eiq '(^|[;&| ])([^ ]*/)?supabase[ ]+--version([ ]|$)'; then
  :
elif echo "$C" | grep -Eiq '(^|[;&| ])([^ ]*/)?supabase([ ]|$)'; then
  block "supabase CLI is Tier-2 (prod DB)"
fi
echo "$C" | grep -Eiq '(^|[;&| ])psql([ ]|$)' && block "psql is Tier-2 (prod DB)"
# Read-only SQL door: the fleet CLI 'sql' subcommand enforces read-only at the
# connection level; any OTHER attempt to smuggle SQL mutations through it is
# still caught server-side. Nothing to regex here beyond the CLI itself.

# --- Customer-facing / money scripts (Tier-2 by definition) -----------------
# `send-email` (not `send-email-file`) is deliberate: matched as a substring,
# it still catches send-email-file, but also any FUTURE CLI verb shaped like
# send-email/send-mail/email-send/sendmail. Before this, the pattern matched
# only the literal script name — a new verb such as
# `npm run fleet:agent -- send-email --to x` would have passed this hook
# untouched (Bash(npm run fleet:agent:*) is allowed at every tier) and opened
# external send to all enabled roles with no permission file edited. Not a
# measured breach (no such verb exists in fleet-agent-cli.ts today) — closed
# pre-emptively because adding the verb IS the permission decision, exactly
# like `git worktree add` below (tier1.settings.json's own $comment).
echo "$C" | grep -Eiq 'send-one-invite|send-email|send-mail|email-send|sendmail|bridge-call|whatsapp-send|deploy-.*-template' \
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
# The fleet CLI invocation that tier0 and tier1 EXPLICITLY allow —
# `node --env-file=.env.local dist/fleet-agent-cli.cjs …` — carries `.env.` in
# its own command string, so this scan blocked a command the allow list grants.
# The rule could therefore never fire: measured 18 denials (chief-of-staff 9,
# ops-monitor 9) before this line existed. Strip that ONE exact token pair
# before scanning; it is not a hole, verified against bypass attempts —
# `… fleet-agent-cli.cjs poll; cat .env.local` and
# `cat --env-file=.env.local dist/fleet-agent-cli.cjs .env.local` both still
# block, because what remains after the strip still contains `.env.`.
# The character class is deliberately BROAD: the old `\.env(\.|[ ]|$)` matched
# `.env.local` and a bare `.env`, but NOT `.env*` or `.env"` — so `cat .env*`,
# `head .env*`, `grep -r KEY .env*` and `find . -name "*.env"` all walked
# straight through (measured 2026-07-29). That was survivable only while no
# read utility was allowed; it became a live hole the moment cat/head/grep/find
# were granted below, which is why the two changes landed together.
C_SECRET="${C//--env-file=.env.local dist\/fleet-agent-cli.cjs/}"
echo "$C_SECRET" | grep -Eq '\.env($|[^A-Za-z0-9_-])|\.token\.env|vox_ci_credentials|\.secrets/' && block "secret files are off-limits"
echo "$C" | grep -Eq 'agent_configs/' && block "agent_configs is managed only via the documented ElevenLabs workflow"

# --- Network egress beyond the allowed CLIs ---------------------------------
echo "$C" | grep -Eiq '(^|[;&| ])(curl|wget|nc|ncat|telnet|ftp)([ ]|$)' && block "raw network egress is forbidden"

exit 0
