# Outlook → KALFA: חיבור מקצה לקצה, ומה שהוא *לא* דורש

> נכתב 2026-08-16 מתוך קריאת קוד בפועל. כל טענה כאן אומתה מול הקבצים או מול
> הטננט החי; מה שלא אומת מסומן במפורש.

## 1. הממצא שקובע את כל השאר

ההצעה נפתחה במילים "שכבת Microsoft 365 **עבור הסוכנים**". לכן השאלה הראשונה
היא לא איזה API לקרוא, אלא **מה סוכן צי מורשה להריץ בכלל**.

שלושת קובצי ה‑tier (`.claude/fleet/settings/tier{0,1,2}.settings.json`) נבדקו
ישירות. כולם `defaultMode: "dontAsk"` — fail‑closed, מה שלא הותר במפורש נחסם —
ובכולם חסומים:

| נחסם בכל הדרגות | משמעות |
|---|---|
| `WebFetch`, `WebSearch` | אין קריאת HTTP מהסוכן |
| `Bash(curl:*)`, `Bash(wget:*)` | אין קריאת HTTP מה‑shell |
| `Bash(node -e:*)`, `bash -c`, `python` | אין מפרשן inline |
| `Read(.env*)`, `.token.env`, `.secrets/**` | הסוכן לא רואה את `MS_GRAPH_*` |
| `Bash(npx:*)` | אין הרצת כלים אקראיים |

ההיתר היחיד שנוגע ברשת בכל הצי הוא `Bash(git fetch:*)` ב‑Tier 1.

**מסקנה: אף role בצי לא יכול לקרוא ל‑Microsoft Graph, בשום דרגה.** לא בגלל
פער, אלא בגלל שזה בדיוק מה שמודל ההרשאות נבנה למנוע. כל "שכבת כלים לסוכנים"
שמניחה קריאת Graph ישירה מהסוכן — לא ניתנת למימוש בלי לפרוץ את המודל הזה.

## 2. התפר היחיד

מתוך כל רשימת ההיתרים של Tier 0, שורה אחת מריצה קוד שמסוגל להגיע למשהו מורשה:

```
Bash(node --env-file=.env.local dist/fleet-agent-cli.cjs:*)
```

הסוכן **אינו יכול לקרוא** את `.env.local`, אבל **כן יכול להריץ** תוכנית שטוענת
אותו. הסוד נכנס לתהליך ה‑CLI ולעולם לא להקשר של הסוכן. זו הדלת המבוקרת
היחידה, וכך הצי כבר מגיע ל‑DB, ל‑Slack ולטיוטות.

לכן: **יכולת M365 חדשה נחשפת לצי כפקודת CLI, לא כגישת Graph.**

## 3. מה כבר קיים — הלולאה סגורה חוץ מרגל אחת

| שלב | מצב | ראיה |
|---|---|---|
| שורת פנייה נכנסת | ✅ | `contact_messages` — `src/lib/data/inquiries.ts:29` |
| טריגר תגובתי | ✅ | `contact_messages_new`, `scheduler.mjs:195-198` |
| הסוכן שמנסח | ✅ | `support-drafter` — Tier 0, `enabled:true`, מחווט לטריגר |
| כתיבת הטיוטה | ✅ | `fleet-agent-cli draft-reply --id --body` → `draft_reply` |
| אישור אנושי + שליחה | ✅ | `sendInquiryReply()` — `admin/contacts.ts:118` |
| המוביל היוצא | ✅ | `getEmailSender()` → Resend |
| **קליטת דואר נכנס מ‑Outlook** | ❌ | **הרגל היחידה החסרה** |

הכל בין "פנייה נוצרה" ל"תשובה נשלחה" בנוי, חי, ומגודר. מה שחסר הוא רק
להכניס מייל נכנס אל הטבלה הזו.

## 4. התוכנית — ארבעה רכיבים

### 4.1 מנוי Graph על התיבה
`POST /subscriptions` עם `resource: /users/{mailbox}/mailFolders/inbox/messages`,
‏`changeType: created`, ‏`notificationUrl` שלנו, ו‑`clientState` סודי.
תוקף מנוי דואר ≤ 4230 דקות (~3 ימים) — ולכן נדרש חידוש (4.4).

### 4.2 `src/app/api/webhooks/microsoft-graph/route.ts`
משכפל בדיוק את הצורה של `src/app/api/webhooks/whatsapp/route.ts`:
1. handshake — אם יש `validationToken` בשאילתה, להחזיר אותו כ‑`text/plain` מיד
2. לאמת `clientState` בכל התראה; לא תואם → לזרוק בשקט
3. `insertWebhookEvents` עם `provider: 'graph'`
4. להחזיר 200 מהר; **לא** לעבד בתוך הבקשה

`webhook_inbox.provider` הוא `text not null default 'whatsapp'` **בלי CHECK**
(`supabase/migrations/202606290035_webhook_inbox.sql:8`), ומפתח הייחוד הוא
`(provider, dedupe_key)` — לכן `provider='graph'` נכנס היום **בלי מיגרציה**.

### 4.3 פונקציית worker ב‑`worker/main.ts`
לצד `runThankyouSweep` ו‑`runCallbackSweep` הקיימות. ההתראה של Graph נושאת
מזהה משאב בלבד ולעולם לא תוכן — לכן ה‑worker:
1. מושך את ההודעה המלאה דרך Graph
2. **מנרמל אותה לשורת `contact_messages`** — וזה הרכיב שדורש הכי הרבה מחשבה
3. מפעיל את אותו `sendSlackAlert` עם `source` מתאים

### 4.4 חידוש מנויים
עבודה מתוזמנת ב‑`worker/main.ts` שמאריכה כל מנוי לפני תפוגתו, ומשתמשת ב‑delta
query כדי להשלים התראות שהוחמצו. **לא** תיקיית `src/jobs/` — היא לא קיימת
בפרויקט; עבודות רקע הן פונקציות ב‑`worker/main.ts`.

## 5. ההחלטה היחידה שחייבים להכריע לפני כתיבת קוד

עמודות `contact_messages` בפועל:

```
id name email phone message created_at status topic user_id
handled_at internal_note draft_reply draft_created_at replied_at sent_reply
```

**אין עמודת מקור ואין מזהה הודעת מקור.** משמעות כפולה:

1. אי‑אפשר להבחין בין פנייה מטופס לבין פנייה מ‑Outlook. `inquiries.ts:55`
   מעביר `source: 'contact_form'` ל‑Slack בלבד — זה שדה בהתראה, לא עמודה.
2. **אין דדופ.** Graph שולח התראות כפולות ביודעין. ה‑`(provider, dedupe_key)`
   של `webhook_inbox` מגן על רגל ה‑webhook בלבד — לא על ה‑`insert` שה‑worker
   מבצע אחריה. בלי `source_message_id` ייחודי, התראה כפולה = שתי פניות
   כפולות = שתי טיוטות = אולי שתי תשובות ללקוח.

שתי דרכים, וצריך לבחור במפורש:

**א. מיגרציה** — להוסיף `source text` ו‑`source_message_id text` עם
`unique (source, source_message_id)`. ה‑`insert` הופך ל‑upsert‑by‑source.
נקי, ופותר גם את הדיווח ("כמה פניות הגיעו במייל").

**ב. בלי מיגרציה** — לגזור דדופ מ‑`webhook_inbox` בלבד, כלומר ה‑worker חייב
להיות אידמפוטנטי ביחס ל‑`dedupe_key` של האירוע. אפשרי, אבל מסתמך על כך
שאף אחד לעולם לא יעבד מחדש שורת inbox ידנית.

**ההמלצה: א.** הדדופ כאן מגן על שליחת דואר ללקוח, וזה לא המקום להסתמך על
משמעת תפעולית.

## 6. אילוץ שמעצב את 4.2, וכדאי לקרוא לו בשמו

`support-drafter` הוא **Tier 0**. הוא לא יכול לקרוא את התיבה, לא לראות קבצים
מצורפים, ולא לעקוב אחרי שרשור. **כל מה שהוא צריך כדי לנסח — חייב כבר להיות
בשורה שה‑worker כתב.** זה לא מגבלה להתנצל עליה; זו הסיבה שהארכיטקטורה
מחזיקה: הסוכן רואה טקסט מנורמל, לא תיבת דואר.

בפועל זה אומר שצעד הנרמול ב‑4.3 צריך להכריע: האם לשטח שרשור לתוך `message`?
מה עושים עם קובץ מצורף שהסוכן לעולם לא יראה? מה ממפים ל‑`topic`, שהוא אוצר
מילים סגור? אלה שאלות עיצוב אמיתיות, ולא פרטי מימוש.

## 7. מה שההצעה ביקשה ולא נדרש

| ההצעה | הכרעה |
|---|---|
| `src/lib/microsoft-graph/{10 קבצים}` | `src/lib/` מאורגן לפי **תחום** ולא לפי ספק. `graph-impl.ts:53-67` כבר בונה credential + client |
| `graphRequest` ידני מעל `fetch` | נסיגה — יאבד את טיפול ה‑429 של ה‑SDK ואת אימות ה‑host ב‑`followPages` (`graph-impl.ts:364-380`) |
| `src/jobs/` | לא קיים בפרויקט; `worker/main.ts` הוא הדפוס |
| שכבת 11 כלים לסוכנים | **לא ניתנת למימוש** — ר' §1 |
| מטריצת אישורים + טבלת ביקורת | האישור כבר קיים (`sendInquiryReply` מגודר); הביקורת — ר' הערה למטה |
| מעבר היומן מ‑EWS ל‑Graph | **כבר בוצע.** `graph-impl.ts` מלא ועובר את מקרי הקצה מול התיבה החיה |
| OneDrive לחוזים | היעד הלא נכון — כבר ב‑Supabase Storage תחת RLS |

**הערת ביקורת:** `logActivity` קורא `requireUser()` וכותב דרך לקוח העוגיות
(`inquiries.ts:18-20` מתעד זאת מפורשות). הוא **לא שמיש מה‑worker**. לכן אם
רוצים עקבות לפעולות ה‑worker — צריך וריאנט worker‑safe. זו החלטה פתוחה.

## 8. שאריות מעבר EWS — נפרד מהתוכנית הזו

- `package.json:10` עדיין נושא `--external:ews-javascript-api --external:@ewsjs/xhr`
- `crypto.ts` והעמודות `password`/`authMethod` ב‑`exchange_connections` מתות תחת אימות‑תעודה
- `_panels.tsx:647-661` עדיין מתאר את EWS/IONOS כנתיב החי בזמן שברירת המחדל היא `graph`
- `ews-impl.ts`, `xml-safe.ts`, `category-list.ts` — מועמדים למחיקה

## 9. הערכת שלמות הביקורת הקודמת

ממצאי צד ה‑`src/` של הסוכן עמדו בשלוש בדיקות מדגם שהרצתי: קיום צינור
`draft_reply`/`sendInquiryReply`, תלות `logActivity` ב‑`requireUser`, והיעדר
CHECK על `webhook_inbox.provider`. הם מדויקים.

**הפער היה בהיקף, לא באיכות:** הוא מעולם לא פתח את `.claude/fleet/` — ושם ישב
האילוץ הנושא. בלי §1, כל §7 היה נראה כמו העדפת סגנון; איתו, "שכבת הכלים
לסוכנים" היא פשוט לא‑ניתנת‑למימוש. ביקורת שקוראת רק `src/` תפספס את זה תמיד,
כי מודל ההרשאות של הצי לא יושב בקוד האפליקציה.
