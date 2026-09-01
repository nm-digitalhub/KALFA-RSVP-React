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
echo "## כללי תחביר לפקודות Bash (חובה — מבוסס מדידה)"
echo "מנגנון ההרשאות בודק את **מחרוזת הפקודה כולה**. צינור, הפניה, \`&&\`, \`;\`,"
echo "שורה חדשה או מרכאות מקוננות שוברים את ההתאמה והפקודה נדחית — **גם כשהיא"
echo "מורשית במפורש**. נמדד על 803 פעולות של הצי: 91% מכלל הדחיות נבעו מכך,"
echo "לא מחוסר הרשאה. לכן:"
echo "- פקודה אחת פשוטה בכל קריאה. בלי \`|\`, \`>\`, \`&&\`, \`;\`, בלי שורות חדשות."
echo "- לחיפוש וסינון — הכלים \`Grep\` / \`Glob\` / \`Read\`, לא \`grep\`/\`sed\`/\`head\` דרך צינור."
echo "- לכתיבת קובץ (summary, טיוטה) — הכלי \`Write\`. **לא** \`cat > file <<EOF\`:"
echo "  טקסט חופשי בשורת פקודה נחסם, ודוח שמזכיר שם של קובץ סוד נחסם בגלל השם."
echo "- \`.fleet-logs/runs/\` **תמיד קיימת** — run-role.sh יוצר אותה לפני שאתה עולה."
echo "  אל תריץ \`mkdir\`; הוא אינו מורשה ואינו נחוץ."
echo "- **הדוח שלך הוא ארגומנט של פקודה, וה-hook סורק את כל המחרוזת** — כולל"
echo "  תוכן --title/--body/--note/--summary/--query/--reason/--error/--evidence"
echo "  בעברית. מילים לטיניות מסוימות (למשל שם ספק-סליקה) חוסמות את **כל**"
echo "  הפקודה, לא רק את המילה. אם התוכן עלול להכיל מילה כזו: כתוב אותו לקובץ"
echo "  תחת \`.fleet-logs/\` (בכלי \`Write\`) ומסור את הנתיב דרך הדגל המקביל"
echo "  \`--body-file\`/\`--note-file\`/\`--summary-file\`/\`--query-file\`/"
echo "  \`--reason-file\`/\`--error-file\`/\`--evidence-file\`/\`--state-file\` —"
echo "  אלה קוראים את הקובץ במקום לסרוק את התוכן במחרוזת הפקודה. **שם הקובץ"
echo "  עצמו עדיין נסרק** — תן לו שם גנרי (תאריך/מונה), לא שם שמתאר את התוכן"
echo "  (\`sumit-recon.md\` עדיין ייחסם על שם הקובץ בלבד)."
echo "- זה חל גם כשאתה רק **מתאר מגבלה במילים**, לא מבקש לקרוא קובץ: אזכור"
echo "  מילולי של \`.env\`/\`.token.env\` בתוך --body חוסם, גם ב\"אין לי גישה"
echo "  ל-.env\". כתוב \"מפתחות סודיים\" או \"סודות\", לא את שם-הקובץ עצמו."
echo
echo "## הקשר ריצה"
echo "תאריך: $(TZ=Asia/Jerusalem date '+%Y-%m-%d %H:%M %Z')"
echo
echo "## פניות ותשובות (fleet_requests) של התפקיד שלך"
echo '```json'
node --env-file=.env.local "$REPO_DIR/dist/fleet-agent-cli.cjs" poll --role "$ROLE" 2>/dev/null || echo '{"error":"poll failed"}'
echo '```'
echo
echo "**inbox** — פניות שהבעלים פתח אליך מ-/admin/fleet. הן כוללות \`body\` מלא,"
echo "והן **המשימה הראשונה שלך בריצה**, לפני העבודה השגרתית. לכל פנייה ב-inbox:"
echo "1. קרא את ה-\`body\` במלואו. הוא ההוראה."
echo "2. יש לפנייה \`thread_context\` (לא-null)? **זו לא בקשה עצמאית — היא המשך"
echo "   לשיחה קודמת.** \`thread_context.title\`/\`.body\` הם הפנייה המקורית,"
echo "   ו-\`thread_context.answer\` היא התשובה שכבר ניתנה עליה (אם ניתנה). קרא"
echo "   אותם לפני שאתה פועל — ה-\`body\` הנוכחי לרוב מניח שאתה כבר יודע אותם"
echo "   (למשל \"בדוק גם את הנקודה השנייה\" בלי לחזור על מה שנשאל קודם)."
echo "3. בצע מה שנדרש — **בגבולות הדרגה שלך**. אם ההוראה חורגת מהם, אל תנסה"
echo "   לעקוף: זו לא תקלה, זו החסימה עושה את עבודתה."
echo "4. סגור: \`npm run fleet:agent -- complete --id <id> --summary \"<מה בוצע>\"\`."
echo "   ‏complete הוא גם התפיסה וגם ההתראה לבעלים — **אל תריץ ack על inbox**."
echo "5. לא ברור מה נדרש? \`request --role $ROLE --kind question\` עם השאלה."
echo "   נדרשת פעולה שחורגת מהרשאותיך? \`--kind approval\` עם הפקודה המדויקת."
echo "פנייה שנשארה pending בסוף ריצה = לא טיפלת בה. זה כשל."
echo
echo "**verdicts** — פניות ש**אתה** פתחת והבעלים ענה. לכל פנייה ב-verdicts:"
echo '1. קרא `npm run fleet:agent -- ack --id <id>` ולוודא claimed:true — פעם'
echo "   אחת בלבד, לפני שאתה פועל. אם claimed:false — מישהו אחר כבר טיפל; אל תפעל."
echo "   \`ack\` הוא גם התפיסה וגם ההתראה לבעלים שהתשובה נקלטה — בלעדיו הבעלים"
echo "   לעולם לא יידע שראית את התשובה שלו, והפנייה נשארת תקועה לצמיתות."
echo "2. פעל לפי התשובה — בגבולות הדרגה שלך."
echo "פנייה ב-verdicts שנשארה answered בסוף ריצה (בלי ack) = לא טיפלת בה. זה כשל,"
echo "בדיוק כמו inbox."
echo
echo "**open** — פניות ש**אתה** פתחת וטרם נענו. אין מה לעשות איתן."
echo "פנייה חדשה לבעלים: \`npm run fleet:agent -- request --role $ROLE ...\`."
echo
echo "**פנייה חדשה שקשורה לפנייה קודמת — השתמש ב-\`--related-to <id>\`.**"
echo "זה שונה מ-\`thread_context\` למעלה (שרשור שהבעלים התחיל דרך \"המשך שיחה\""
echo "ב-/admin/fleet): כאן **אתה** פותח פנייה חדשה **ביוזמתך** בגלל פנייה קודמת"
echo "(למשל: בקשת-אישור נדחתה עם הערה, ואתה פותח שאלת-המשך על סמך ההערה; או"
echo "תקרית שגורמת לך לשאול מה לעשות עם תוצאה שכבר דיווחת עליה). בלי הדגל הזה"
echo "הקשר הזה קיים רק כפרוזה חופשית בתוך --body — הבעלים לא יראה קישור ל-id"
echo "המקורי ב-/admin/fleet, וייאלץ לחפש אותו ידנית (תקרית 31.8: הבעלים נאלץ"
echo "לשלוף מה-DB בעצמו כדי למצוא בקשה שפנייה אחרת רק תיארה במילים). דוגמה:"
echo "\`npm run fleet:agent -- request --role $ROLE --kind question"
echo "--title \"...\" --body \"...\" --related-to <id-של-הבקשה-הקודמת>\`."

# בדיקה שקטה. פוֹלבֶק שונה במכוון מזה של fleet_requests למעלה: שם
# `|| echo '{"error":"poll failed"}'` כי כשל בפוֹל של הבקשות הוא עצמו עובדה
# שהתפקיד צריך לדעת עליה. כאן זו תכונה תוספתית — אם goal-poll נכשל, עדיף
# שהריצה תתנהג כאילו אין מטרה due (התזמן ינסה שוב בטיק הבא) מאשר להטביע
# בפרומפט שגיאה על מנגנון שהתפקיד לרוב בכלל לא יודע שהוא קיים.
GOAL_JSON="$(node --env-file=.env.local "$REPO_DIR/dist/fleet-agent-cli.cjs" goal-poll --role "$ROLE" 2>/dev/null || echo '{"goals":[]}')"

# אימות-צורה לפני חילוץ — אחרת GOAL_COUNT היה נשאר "" ומפיל את [ ... -gt 0 ].
GOAL_COUNT=0
if printf '%s' "$GOAL_JSON" | jq -e . >/dev/null 2>&1; then
  GOAL_COUNT="$(printf '%s' "$GOAL_JSON" | jq '.goals | length')"
fi

# [ ... ] 2>/dev/null — הגנה שנייה: ערך לא-מספרי נכשל בשקט במקום לקרוס.
if [ "$GOAL_COUNT" -gt 0 ] 2>/dev/null; then
  # goal-poll ממיין created_at asc — אם יש יותר ממטרה due אחת לאותו תפקיד
  # (חריג ב-v1), רק הוותיקה ביותר מוצגת הריצה הזו. השאר יעלו FIFO בריצה הבאה.
  GOAL_ID="$(printf '%s' "$GOAL_JSON" | jq -r '.goals[0].id')"
  GOAL_TITLE="$(printf '%s' "$GOAL_JSON" | jq -r '.goals[0].title')"
  GOAL_BODY="$(printf '%s' "$GOAL_JSON" | jq -r '.goals[0].body')"
  GOAL_STATE="$(printf '%s' "$GOAL_JSON" | jq -c '.goals[0].state')"
  GOAL_STEP="$(printf '%s' "$GOAL_JSON" | jq -r '.goals[0].step_count')"
  GOAL_FAILS="$(printf '%s' "$GOAL_JSON" | jq -r '.goals[0].consecutive_failures')"

  echo
  echo "---"
  echo "## המטרה הפעילה שלך"
  echo "כותרת: $GOAL_TITLE"
  echo
  echo "תיאור (ההוראה של הבעלים, מלאה):"
  echo "$GOAL_BODY"
  echo
  echo "מזהה: \`$GOAL_ID\` · צעד נוכחי: \`$GOAL_STEP\` · כשלים רצופים: \`$GOAL_FAILS\`"
  echo
  echo "מה שנשמר מהריצה הקודמת (state):"
  echo '```json'
  echo "$GOAL_STATE"
  echo '```'
  echo
  echo "**יש לך פנייה ב-inbox (למעלה) שכותרתה מתחילה ב-\"בהמשך למטרה: $GOAL_TITLE\"?**"
  echo "זו תגובת הבעלים למטרה הזו הספציפית — אין קישור טכני בין השניים (אין"
  echo "\`goal_id\` בפנייה), רק ההתאמה המילולית בכותרת. טפל בה **לפני** שאתה"
  echo "ממשיך על המטרה, וקח בחשבון את מה שכתוב בה בהחלטה על הצעד הבא."
  echo
  echo "## מבנה ה-state (מוסכמה — לא נאכף במסד, אתה אחראי לשמור עליה)"
  echo "\`fleet_goals_state_object\` מאשרת רק שזה אובייקט — לא את המפתחות"
  echo "בתוכו. ארבעת אלה הם המוסכמה שהבעלים ואתה בריצה הבאה קוראים לפיה:"
  echo "- \`done\` (מערך מחרוזות) — מה שבוצע ואומת בפועל. **הוסף לסוף,"
  echo "  אל תשכתב** — זה יומן מצטבר, לא תמונת מצב."
  echo "- \`remaining\` (מערך מחרוזות) — מה שנשאר, כפי שאתה מבין עכשיו."
  echo "  **שכתב את כל המערך בכל ריצה** — התוכנית משתנה ככל שאתה לומד."
  echo "- \`next_action\` (מחרוזת יחידה) — משפט קצר: מה תעשה בריצה הבאה."
  echo "  **שכתב, אל תצרף.** זה מה שהבעלים רואה ב-/admin/fleet."
  echo "- \`findings\` (מערך מחרוזות) — עובדות שרלוונטיות להמשך ואינן"
  echo "  \"בוצע\" (למשל חסימה שנתקלת בה). **הוסף לסוף.**"
  echo "דוגמה — state שנקרא, ואז --state שאתה שולח אחרי שהתקדמת צעד אחד:"
  echo '```json'
  echo '{"done":["בדק הרשאות"],"remaining":["הרץ migration","וודא RLS"],'
  echo '"next_action":"הרץ migration","findings":[]}'
  echo '```'
  echo '```json'
  echo '{"done":["בדק הרשאות","הרץ migration"],"remaining":["וודא RLS"],'
  echo '"next_action":"וודא RLS ב-advisors",'
  echo '"findings":["migration רץ נקי, 0 שורות מושפעות"]}'
  echo '```'
  echo "מטרה חדשה (צעד 0)? ה-state שנקרא הוא \`{}\` — כל הארבעה מתחילים ריקים."
  echo
  echo "## חוזה המשך/סגירה (חובה)"
  echo "1. קרא את ה-state למעלה, החלט על הצעד הבא, ובצע אותו."
  echo "2. סיימת את הצעד? קרא בדיוק אחת משתי הפקודות הבאות — פקודה אחת,"
  echo "   בלי צינור ובלי שורה חדשה (ראה כללי התחביר למעלה):"
  echo "   - ממשיך: \`npm run fleet:agent -- goal-progress --id $GOAL_ID"
  echo "     --step $GOAL_STEP --state '<JSON מעודכן>'"
  echo "     --next-wake-at <ISO עם אזור-זמן, למשל 2026-07-30T08:00:00Z>\`"
  echo "   - הושלם/נכשל סופית: \`npm run fleet:agent -- goal-close --id $GOAL_ID"
  echo "     --step $GOAL_STEP --status completed|failed [--note \"<למה>\"]\`"
  echo "3. \`--step\` חייב להיות בדיוק \`$GOAL_STEP\` — המספר שקיבלת כאן, לא"
  echo "   מספר שחישבת. זהו ההגדר (CAS); מספר שגוי מחזיר \`stale_step\`."
  echo "4. ממשיך (goal-progress) בלי \`--next-wake-at\`? המסד יזרוק שגיאה —"
  echo "   מטרה active חייבת לשאת שעון מעורר. אם אין מתי לחזור, סגור אותה."
  echo "5. \`--next-wake-at\` **חייב לשאת אזור זמן מפורש** (סיומת \`Z\` או"
  echo "   \`+03:00\`). ערך כמו \`2026-07-30T08:00\` בלי אזור זמן יידחה."
  echo
  echo "**מטרה שנשארה \`active\` בסוף הריצה בלי goal-progress/goal-close = כשל,"
  echo "בדיוק כמו פנייה שנשארה pending (למעלה). דווח ב-summary אם לא סיימת.**"
  echo
  echo "## תוצאות שאינן advanced/closed — עצור, אל תנסה שוב"
  echo "| תוצאה | מה קרה | מה לעשות |"
  echo "|---|---|---|"
  echo "| \`stale_step\` | ריצה אחרת התקדמה על אותה מטרה | עצור, אל תקרא שוב |"
  echo "| \`not_active\` | הבעלים השהה/סגר תוך כדי הריצה | עצור, ההחלטה שלו גוברת |"
  echo "| \`not_found\` | המטרה אינה קיימת | עצור ודווח ב-summary |"
  echo "| \`already_closed\` | כבר נסגרה | עצור, אל תסגור שוב |"
  echo "| \`paused_on_failures\` | הכתיבה הצליחה אך זה הכשל השלישי — הושהתה | עצור ודווח מה נכשל |"
fi
