#!/usr/bin/env bash
# Per-run context trailer appended to the role prompt: today's date and the
# role's fleet_requests state (owner verdicts to act on + still-open asks).
# The verdict-handling contract lives HERE so every role gets it verbatim.

set -uo pipefail

FLEET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$FLEET_DIR/../.." && pwd)"
ROLE="${1:-}"
[ -z "$ROLE" ] && exit 0

echo
echo "---"
echo "## הוראת ביצוע (חובה)"
echo "זו ריצה אוטומטית ללא משתמש אינטראקטיבי — **אין למי לשאול**. בצע את כל"
echo "משימת התפקיד עכשיו, מקצה לקצה, בלי לבקש אישור ובלי לשאול 'להתחיל?'."
echo "הפעולה האחרונה שלך חייבת להיות כתיבת קובץ ה-summary. אם אין ממצאים —"
echo "כתוב summary שאומר זאת. אל תסיים בלי לבצע בפועל."
echo
echo "## הקשר ריצה"
echo "תאריך: $(TZ=Asia/Jerusalem date '+%Y-%m-%d %H:%M %Z')"
echo
echo "## פניות ותשובות (fleet_requests) של התפקיד שלך"
echo '```json'
node --env-file=.env.local "$REPO_DIR/dist/fleet-agent-cli.cjs" poll --role "$ROLE" 2>/dev/null || echo '{"error":"poll failed"}'
echo '```'
echo
echo "חוקי טיפול בתשובות (verdicts): לפני שאתה פועל על תשובה, חובה לקרוא"
echo '`npm run fleet:agent -- ack --id <id>` ולוודא claimed:true — ack לפני פעולה,'
echo "פעם אחת בלבד. אם claimed:false — מישהו אחר כבר טיפל; אל תפעל."
echo "פנייה חדשה לבעלים: \`npm run fleet:agent -- request --role $ROLE ...\`."
