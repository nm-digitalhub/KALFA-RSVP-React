#!/usr/bin/env bash
# SessionStart hook: surface fleet requests handed to the MAIN session
# (role='main' — created by `fleet-agent handoff --to main`). Prints one line
# per open/answered-unconsumed request so the main session starts every
# conversation knowing what awaits it. Fail-open by design: any missing
# prerequisite (bundle, env, DB) exits 0 silently — a broken inbox must never
# block session start.
cd /var/www/vhosts/kalfa.me/beta || exit 0
CLI=dist/fleet-agent-cli.cjs
[ -f "$CLI" ] || exit 0
out=$(timeout 15 node --env-file=.env.local "$CLI" poll --role main 2>/dev/null) || exit 0
lines=$(printf '%s' "$out" | jq -r '(.open + .verdicts)[]? | "- \(.title) [id: \(.id) | kind: \(.kind) | status: \(.status) | created: \(.created_at)]"' 2>/dev/null)
[ -n "$lines" ] || exit 0
printf 'תיבת main (fleet) — משימות שהועברו לסשן הראשי וטרם נסגרו:\n%s\nאחרי ביצוע סגור עם: npm run fleet:agent -- complete --id <id> --summary "<מה בוצע>"\n' "$lines"
exit 0
