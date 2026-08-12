# מצבת KALFA — רשימת משימות (TODO)

עודכן: 2026-07-23. סטטוס: תשתית + גל תפעולי ראשון חיים; מצבת קרייאטיב בנויה וחסומה.

## ✅ הושלם ואומת

- תשתית הרצה: מתזמן `kalfa-fleet` (pm2, שורד ריסטארט+reboot), `run-role.sh`,
  `run-context.sh`, KILLSWITCH, flock גלובלי.
- אכיפת הרשאות 3 שכבות (dontAsk + allow/deny בצורת Edit + guard hook) —
  מוכחת בבדיקה אדברסרית 9/9.
- טוקן headless (`.token.env`, מנוי) — נטען ומוכח בריצה אמיתית.
- אזור פניות באפליקציה: טבלת `fleet_requests` (+trigger מכונת-מצבים, RPCs),
  עמוד `/admin/fleet` + עמוד פירוט, web push, מראה Slack, שרשור בת'רד.
- לולאה אוטונומית: `fleet-agent-cli` (request/poll/verdicts/ack/expire/digest)
  + צופה-תשובות שקולט מענים לבד תוך דקה.
- גל תפעולי ראשון חי: **ops-monitor** (07:30), **chief-of-staff** (17:30).
- מצבת קרייאטיב בנויה (כבויה): brand-director, content-seo-strategist,
  social-manager, creative-producer (ElevenLabs), lifecycle-copywriter (שער מלא).
- BRAND.md v0.1 נזרע. שער תאימות משפטי אוכלס ואומת.

## ⏳ בתהליך

- [ ] סוכן העו"ד: מחקר מעמיק על 3 השאלות החוסמות → `docs/marketing/lifecycle-legal-brief.md`
      (מעוגן במבנה העסקי האמיתי של KALFA).

## 🟡 דורש החלטת בעלים (אשאל)

- [ ] **אישור BRAND.md** — 6 שדות ⚑ (tagline, מחיר, אווטאר 2/צ'מפיון, צבעים/לוגו,
      הוכחות חברתיות). פותח את 4 סוכני הקרייאטיב הבטוחים.
- [ ] **אישור שער התאימות** של lifecycle + 3 שאלות ליועמ"ש אנושי.
- [ ] **איזה גל תפעולי הבא להפעיל**: event-health-watcher / support-drafter / business-ops.
- [ ] **worktree `beta-fleet`** (`git worktree add`) — שינוי מבנה ריפו, לצורך qa-runner + dev-engineer (Tier-1).

## ⚪ מתוכנן (בונה בלי אישור — נשאר כבוי)

- [ ] קבצי תפקידים חסרים (2): marketing-content, dev-engineer — ב-fleet.json אך בלי
      `roles/*.md`. שניהם `enabled:false`, ולכן run-role.sh מסמן אותם `skipped:disabled`
      לפני שהיעדר הפרומפט בכלל נבדק. (אומת 29.07: event-health-watcher, support-drafter,
      business-ops ו-qa-runner נכתבו מאז ופועלים — הרשימה כאן מנתה אותם בטעות.)
- [ ] קטגוריית Slack ייעודית `fleet` + toggle ב-/admin/alerts (כרגע רוכב על `errors`).
- [ ] בדיקות (tests) ל-fleet_requests RPCs ול-fleet-agent-cli.

## 🔵 עתידי / הרחבות

- [ ] Telegram כערוץ פנייה משני (אופציונלי).
- [ ] גל קרייאטיב מלא + Paid Media & Growth (התפקיד ה-6 שלא נבחר לגל הראשון).
- [ ] הפעלת lifecycle-copywriter (רק אחרי תשובת עו"ד אנושי + מנגנון opt-in ערוצי).
