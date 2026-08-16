# סגירת הקצוות הפתוחים — תוכנית מאומתת

> נכתב 16.08.2026. כל מספר כאן נמדד מול ה‑DB החי או מול הקוד, לא הוסק.
> תגיות: **[נמדד]** = הרצתי ואימתתי · **[הסקה]** = נגזר מקריאת קוד · **[לא נבדק]**
>
> **ביקורת מלאה 16.08 אחה"צ** — כל סעיף נקרא שורה‑שורה ואומת מול הקוד וה‑DB
> החיים. סימוני מצב: `✅ בוצע ואומת` · `⏳ פתוח` · `❌ בוטל`.
>
> **ארבעה פגמים נמצאו בתוכנית עצמה** — לא בקוד — וכולם היו מייצרים יישום שבור
> אילו הועתקו כלשונם. מסומנים בגוף המסמך ב‑**⚠️ תוקן בביקורת**:
>
> | # | היכן | מה היה שגוי |
> |---|---|---|
> | 1 | A2 | הפניה לפונקציה בשם שאינו קיים (`runCallbackScheduleSweep`) |
> | 2 | **E** | `חיוב ותשלום` בטופס מול `גבייה` בתור — **לעולם לא יתאימו** |
> | 3 | G1 | השינוי המוצע שובר את `tsc` בקריאת ה‑Slack |
> | 4 | **H3** | הסינון מפיל את שורת הציות הקריטית, ומדליף `{{tokens}}` ללקוח |
>
> פגמים 2 ו‑4 הם מאותה משפחה של H5 שנמשך: מדידה נכונה, מסקנה שגויה, בגלל
> שלא נבדק מי **צורך** את הנתון.

---

## A. 14 שיחות חוזרות שנעלמו — באג חי, לקוחות אמיתיים

> ### ✅ A1 בוצע ואומת · ⏳ A2 פתוח
>
> **[נמדד 16.08 12:40]** השחרור רץ (`UPDATE … RETURNING` = 14 שורות), הסריקה
> יצרה אותן מחדש, וכל 14 הפגישות אומתו קיימות ב‑Graph (200, לא דגימה).
> מצב נוכחי: `ews_dead: 0` · `graph_new: 14` · `stranded_now: 0`.
> תיעוד מצב‑הלפני: `plans/a1-before-state.json` (commit `c85b888`).
>
> אלה גם **כתיבות ה‑Graph הראשונות שהצליחו בייצור** — מה שמאשר רטרואקטיבית
> את תיקון סדר‑הטעינה ב‑`worker/start.mjs`.
>
> **A2 (הגלאי) עדיין לא נכתב** — `countStrandedCallbacks` אינו קיים בקוד.

### האבחון

**[נמדד]** 14 שורות ב‑`callback_requests` נושאות `calendar_item_id` שאינו קיים.
בדיקה ישירה מול Graph על אחד מהם החזירה **404**. המזהים בפורמט EWS
(`AAMkADk5Mjk4…`, 152 תווים) — הם נוצרו מול IONOS לפני המעבר, ו‑Graph אינו
יכול לפתור אותם.

**[נמדד]** מועדיהם: 28.07 עד 13.08 — כולם בעבר.

שני מנגנונים אמורים לטפל בזה, ושניהם מדלגים:

| מנגנון | הקוד | למה מדלג |
|---|---|---|
| תזמון | `callback-scheduling.ts:215` | `if (request.calendar_item_id) return 'already_scheduled'` |
| ריפוי | `callback-scheduling.ts:342` | `.gte('scheduled_at', now − DAY_MS)` — כולן ישנות מזה |

*(שתי ההפניות אומתו בביקורת. 341 תוקן ל‑342; `reconcileCallbacksWithCalendar`
עצמה מתחילה ב‑332.)*

**[נמדד]** `in_heal_window: 0`, `past_window: 14`. אף אחת מהן אינה נראית לריפוי.

התוצאה: הפגישה לא בלוח, הבקשה לא בתור, ואין התראה. **הן פשוט נעלמו.**

### התיקון — שני חלקים, ולא רק אחד

**A1 — שחרור חד‑פעמי של 14 השורות.**
`update callback_requests set calendar_item_id = null, exchange_connection_id = null,
scheduled_at = null` על אותן 14 שורות בדיוק. הסריקה הקיימת תיצור אותן מחדש מול
Graph בריצה הבאה — **בלי קוד חדש**, כי היא כבר עושה זאת לכל שורה עם עמודה ריקה.

*למה לא למחוק את השורות:* הן בקשות אמיתיות של לקוחות. מחיקה מאבדת את הבקשה;
איפוס מחזיר אותה לתור.

**A2 — לסגור את החור שאפשר את זה.**
חלון הריפוי של יממה בוחר בין עלות שאילתה לבין כיסוי, וכרגע הוא מפספס בשקט.
שורה עם `calendar_item_id` מלא, `scheduled_at` בעבר, וסטטוס לא‑סופי היא
**נטושה בהגדרה** — מצב שניתן לזהות בשאילתה אחת.

הצעה: להרחיב את הריפוי כך שיכלול גם שורות כאלה, **או** — עדיף — להוסיף בדיקה
נפרדת שסופרת אותן ומתריעה ב‑Slack כשהמונה > 0. השנייה זולה יותר ומגלה גם
תקלות שהריפוי לא צפה.

### אימות

1. **לפני:** לספור את 14 השורות ולתעד את המזהים.
2. **אחרי השחרור:** `calendar_item_id is null` על אותן 14.
3. **אחרי ריצת סריקה אחת:** לספור כמה קיבלו מזהה **חדש** (בפורמט Graph, לא
   `AAMkADk5`), ולוודא שאחד מהם נפתר ב‑Graph ב‑200.
4. **בדיקת רגרסיה:** מקרה יחידה שמוודא ששורה עם `scheduled_at` בעבר ומזהה מת
   מזוהה כנטושה. זו הבדיקה שהייתה תופסת את הבאג מלכתחילה.

### סיכון

**נמוך אך לא אפס.** אם פגישה כן קיימת ביומן ואנחנו מאפסים — תיווצר כפילות.
מוקטן ע"י בדיקת כל 14 המזהים מול Graph לפני האיפוס, ולא רק דגימה.

---

## B. שאריות EWS — ניקוי · 🟡 שלב 1 בוצע · פירוק עצמו נדחה במכוון

### מה שבוצע — שלב 1: שהסכמה תוכל לומר את האמת

**[נמדד]** החסם שהסעיף תיאר היה אמיתי ואומת מול `pg_constraint`:
`auth_method` היה `CHECK IN ('ntlm','basic')`, ושלוש עמודות הסוד `NOT NULL`.
מיגרציה `20260816120134_ews_teardown_phase1_schema_honesty`:

| שינוי | מצב אחרי, מאומת חי |
|---|---|
| `auth_method` | `CHECK IN ('ntlm','basic','certificate')` |
| שלוש עמודות הסוד | `NOT NULL` הוסר; ה‑CHECK הפך ל‑`NULL או לא‑ריק` |
| `credential_all_or_none` | חדש — שלושתן יחד או אף אחת |
| `ExchangeAuthMethod` | קיבל `'certificate'`; `resolveMailboxPassword` מקבל שדות nullable |

**מה שבמכוון לא נעשה:** הסוד של השורה הקיימת **לא נמחק** ו‑`auth_method` נשאר
`ntlm`. הסוד הזה **הוא** החזרה לאחור — NTLM לא יכול לעבוד בלעדיו. מחיקתו הייתה
מבטלת את מתג החזרה תוך כדי שהיא מתחזה לשינוי סכמה.

### ✅ ממצא אבטחה שנסגר — מפתח פרטי חי ללא קורא

**[נמדד]** `app_settings` החזיקה מפתח RSA פרטי באורך **1704 תווים**
(`dkim_private_key`), עם `dkim_domain=kalfa.me` ו‑`dkim_selector=k1` — ו**אפס**
שורות קוד קראו אותן בשם. במקביל **[נמדד ב‑DNS]** `k1._domainkey.kalfa.me` עדיין
מפורסם, כלומר זוג המפתחות שלם ואמיתי.

**[נמדד]** `sender.ts:128` קובע במפורש שהנתיב הזה אינו חותם DKIM; הדואר היוצא
עובר ב‑Resend (`send.kalfa.me` → `include:amazonses.com`, DMARC `p=quarantine;
adkim=r`).

**[נמדד]** ארבעה אתרי קריאה עושים `select('*')` על `app_settings`
(`alerts-config`, `payments`, `outreach-config`, `voximplant-config`). כולם
`server-only` ובוררים שדות — כלומר המפתח **לא דלף ללקוח**, אבל נטען לזיכרון
השרת בכל קריאת תצורה, לחינם.

שלוש העמודות הוסרו. **החזרה לאחור: אין, במכוון** — מפתח חתימה שהוחלט לפרוש
אסור לשחזר; ההתאוששות הנכונה היא זוג מפתחות חדש ורשומת DNS מוחלפת.

> **⛔ נותר לבעלים:** רשומת ה‑DNS `k1._domainkey.kalfa.me` עדיין מפורסמת.
> מפתח ציבורי לבדו אינו מזיק, ושינויי DNS הם החלטתך — אבל הסלקטור הזה כבר לא
> משמש דבר וראוי להסירו.

### מה שנדחה, ולמה — הנתונים, לא תחושה

**[נמדד]** 15 כשלי Graph בלוג ה‑worker, **כולם ב‑16.08**, האחרון ב‑05:10 —
באג סדר‑הטעינה שתוקן באותו יום. אפס כשלים מאז. `callback_requests`:
`ews_format=0`, `graph_format=7`. `console_agent_calendar_presence`:
`last_error_code=null`.

זה נקי — אבל זה **כ‑10 שעות**. השער שהסעיף עצמו קבע הוא "מספר ימים של יציבות
מוכחת", ועשר שעות אינן זה. לכן `ews-impl.ts`, `xml-safe.ts`, `category-list.ts`,
החבילות ומתג `EXCHANGE_PROVIDER=ews` — **כולם נשארים**.

> **⚠️ תיקון להנחה שכמעט נכנסה לכאן.** נבנה כאן טיעון דחיפות על בסיס פרישת
> EWS של מיקרוסופט (**אוקטובר 2026** מתחיל, **אפריל 2027** מלא — מאומת מול
> `learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-ews-exchange-online`,
> נשלף 16.08.2026). **הוא אינו חל.** נתיב ה‑EWS שלנו מצביע על
> `exchange.ionos.com` (`ews-impl.ts:87`) — IONOS Hosted Exchange, לא Exchange
> Online. הפרישה של מיקרוסופט היא ל‑Exchange Online בלבד; אירוח/on‑prem שומר על
> EWS. כלומר **אין דדליין חיצוני על מתג החזרה** — אורך חייו נקבע ע"י כמה זמן
> חשבון ה‑IONOS פעיל, וזו עובדה של הבעלים.

### מה נדרש כדי לסגור את B סופית

1. מספר ימי יציבות על Graph (הראשון שבהם החל 16.08 05:10).
2. **הכרעת בעלים: האם חשבון ה‑IONOS נסגר?** כל עוד הוא חי, מתג החזרה שווה משהו.
3. אז: מחיקת `ews-impl`/`xml-safe`/`category-list` + החבילות, ניקוי הסוד של
   השורה הקיימת ל‑`certificate`, והסרת `EXCHANGE_EWS_ENCRYPTION_KEY`.

**[נמדד]** `crypto.ts` **אינו** נמחק בשלב 3 בלי בדיקה — `encryptCredential`
עדיין מיובא ב‑`exchange-connections.ts`. `xml-safe` ו‑`category-list` מיובאים
**רק** ע"י `ews-impl` (מאומת), כך שהם נופלים איתו.

**[נמדד]** `connectExchangeMailbox` הוא **נקודת כניסה מתה** — אפס הפניות בכל
`src/`, `scripts/`, `worker/`. היא עדיין אוספת ומצפינה סיסמת תיבה.

---

## C. commit · ✅ בוצע ואומת

~~**[נמדד]** 62 קבצים בעץ העבודה.~~ **בוצע 16.08** — עץ העבודה נקי (0 קבצים),
עשרה commits, וכולם **פרוסים ומאומתים חי** (`.deploy-id: msvmptw7`,
`.next` 12:57:25):

| sha | מה |
|---|---|
| `37a431b` | תלויות — Graph + Resend |
| `aaf5287` | M365: יומן ל‑Graph, דואר ל‑Resend |
| `94c005a` | עמוד FAQ ציבורי מנוהל‑אדמין |
| `cfc2959` | איכות התשובה — H1/H2/H4/H6 |
| `bca68b9` · `a6ae5ae` · `79f63c4` · `c85b888` | תיעוד ותוכניות |
| `a46779a` | proxy — חסימת בדיקות Server Action פגומות |
| `77dc57b` | ניתוק Graph מסוד ה‑EWS |

---

## סדר מומלץ

1. **C — commit.** לפני כל שינוי נוסף. הכי זול, מונע את הנזק הגדול ביותר.
2. **A1 — שחרור 14 השורות.** באג חי שפוגע בלקוחות אמיתיים.
3. **A2 — סגירת החור.** כדי שלא יחזור בשקט.
4. **B — ניקוי EWS.** אחרי כמה ימי יציבות.

---

## שערי אימות לכל שלב

`npx tsc --noEmit` · `npm run lint` · `npx vitest run` · `npm run build`

ובנוסף, ספציפית ל‑A: אימות מול ה‑DB החי **לפני ואחרי**, ובדיקת יחידה שמכסה את
מצב "שורה נטושה" כדי שהרגרסיה תיתפס בעתיד.

---

# חלק שני — הפניות

## D. תגובה חוזרת של לקוח — נופלת בין הכיסאות

### האבחון

**[נמדד]** `contact_messages` מחזיקה `message` יחיד ו‑`sent_reply` יחיד. אין
`thread_id`, ואין מזהה להודעה **היוצאת** שלנו.

**[נמדד]** `sender.ts` שולח עם `replyTo` בלבד — אין `In-Reply-To` ואין
`References`. לכן התשובה שלנו נפתחת אצל הלקוח כשרשור **חדש**, וכשהוא לוחץ "השב"
אין בתגובתו שום סימן שמקשר אותה לפנייה המקורית.

**[נמדד]** הקליטה כבר מושכת `conversationId` ו‑`internetMessageId` מ‑Graph
(`microsoft/mail.ts:53-54`) — אבל שומרת רק את השני, ואת הראשון זורקת.

### המלכודת שאסור ליפול בה

**[נמדד]** הטריגר של הצי הוא:
`status = 'new' AND draft_reply IS NULL` (`scheduler.mjs:197`)

בפנייה שכבר נענתה, `draft_reply` **מלא**. לכן החזרת הסטטוס ל‑`new` תגרום לכך
ש**הסוכן לא יתעורר כלל** — הפנייה תוצג כחדשה במוני הניווט
(`nav-counts.ts:36`), ואיש לא ינסח לה תשובה. **תקיעה שקטה**, בדיוק כמו 14
השיחות בחלק A.

### התיקון — שלושה חלקים

**D1 — כותרות שרשור ביציאה.** `In-Reply-To` ו‑`References` עם ה‑Message‑ID של
הפנייה. **הכרחי בכל מקרה**: בלעדיו אין למה לקשר, כי התגובה נפתחת כשרשור נפרד.

**D2 — לשמור את מזהה ההודעה היוצאת** על השורה. תגובת הלקוח תישא `In-Reply-To`
שמצביע עליו, וזו התאמה ישירה. `conversationId` של Graph הוא הגיבוי.

**D3 — סטטוס `reopened`, לא `new`.**

| | `new` | `reopened` |
|---|---|---|
| משמעות | פנייה ראשונה | חילופי דברים נמשכים |
| מה הסוכן צריך לקרוא | ההודעה בלבד | **את כל השרשור** |
| `draft_reply` | ריק | תפוס — צריך טיוטה חדשה |

מחייב עדכון בשלושה מקומות: הטריגר בצי, הסוכן, ומוני הניווט.

### מה שזה חושף — טבלת הודעות

שדה `draft_reply` יחיד נדרס בטיוטה שנייה, ואובד תיעוד מה כבר נאמר. המבנה הנכון
הוא `inquiry_messages` — שרשור אחד, כמה הודעות, כל אחת עם כיוון. זה גם מה
שיאפשר לסוכן לקרוא הקשר לפני שהוא מנסח.

> ~~**החלטה: לא בשלב הראשון.** D1+D2 נותנים את הקישור; טבלת ההודעות היא שלב שני.~~
>
> **בוטל 16.08 — ר' חלק חמישי (I5).** ההכרעה הזו נכתבה בלי לבדוק את הממשק.
> המדידה מראה ש‑`sent_reply` היא עמודה אחת (מענה שני **דורס** את הראשון) ושתיבת
> המענה חסומה על `replied_at` (טיוטה חדשה **לא תוצג לעולם**). D3 בלי טבלת
> ההודעות מוחק נתונים ותוקע בשקט. הטבלה עולה לשלב הראשון, **לפני** D3.

### אימות

1. לשלוח תשובה ולקרוא בכותרות הנמסרות ש‑`In-Reply-To` קיים ותקין.
2. להשיב עליה מהתיבה, ולוודא שהקליטה מזהה את השרשור.
3. לוודא שהסטטוס עבר ל‑`reopened` ולא ל‑`new`.
4. **הבדיקה שהכי חשובה:** לוודא ש‑`support-drafter` באמת התעורר — כלומר
   שהטריגר החדש עובד. בלעדיה נחזור בדיוק לתקיעה השקטה.

---

## E. `topic` חופשי מול `console_queues` — כפילות אמיתית · ✅ בוצע ואומת 16.08

### ⚠️ תוקן בביקורת — הטבלה כאן הייתה שגויה, והיישום היה מנתב שגוי בשקט

הגרסה הקודמת הציגה `billing` מול **`חיוב ותשלום`** כאילו הם תואמים. **הם לא.**
`console_queues.name_he` של `billing` הוא **`גבייה`**. מדידה חוזרת:

| `console_queues` (`key` · `name_he` · priority) | `INQUIRY_TOPICS` | תואם? |
|---|---|---|
| `sales` · **מכירות** · 10 | מכירות | ✅ |
| `support` · **תמיכה** · 20 | תמיכה | ✅ |
| `events` · **אירועים** · 30 | — (אינו בטופס) | — |
| `billing` · **גבייה** · 40 | **חיוב ותשלום** | ❌ **לעולם לא** |
| — | אחר | ❌ (אינו תור, במכוון) |

`INQUIRY_TOPICS = ['מכירות', 'תמיכה', 'חיוב ותשלום', 'אחר']`
(`src/lib/validation/inquiries.ts:9`).

**מה זה היה עושה:** ה‑`UPDATE` החד‑פעמי וגם המיפוי בזמן יצירה — שניהם ממופים
ב‑`q.name_he = c.topic` — היו **מדלגים על כל פנייה בנושא חיוב**, שהיא בדיוק
הקטגוריה שהכי לא כדאי לאבד. בלי שגיאה, בלי לוג. `queue_id` היה נשאר `null`
והפנייה הייתה נראית "לא מסווגת" לנצח.

**זו אותה משפחת טעות של H5:** הספירה "4 מ‑6 תואמות" הייתה נכונה כמדידה, אבל
נבדקה רק על הנתונים שקיימים במקרה — ולא על **אוצר המילים** שהטופס מסוגל לייצר.
אף לקוח לא בחר "חיוב ותשלום" עדיין, ולכן הפער לא הופיע בספירה.

**[נמדד מחדש 16.08]** 7 פניות בסך הכול · 5 יתאימו · 2 לא (שתי פניות הדואר עם
`'פנייה בדואר'`). הספירה הישנה "4 מ‑6" התיישנה.

### התיקון הנכון — מפה מפורשת, לא התאמת מחרוזות

שתי הטקסונומיות **אמורות** להיות עצמאיות — זו בדיוק ההכרעה שהסעיף עצמו ממליץ
עליה ("המלצה: מפה"). התאמה לפי `name_he` סותרת אותה: היא הופכת כל שינוי ניסוח
בתור לשינוי ניתוב שקט.

```ts
// src/lib/data/inquiries.ts — לצד INQUIRY_TOPICS
//
// The customer-facing vocabulary and the operational one are deliberately
// separate: the form says "חיוב ותשלום" because that is what a customer calls
// it, the queue is keyed `billing` and displays "גבייה" because that is what
// the desk calls it. Matching them by Hebrew NAME looked like it worked and
// silently did not — measured 16.08: `name_he` for billing is "גבייה", so
// every billing inquiry would have failed to route, with no error.
//
// Keyed by the queue `key`, never by `name_he`: renaming a queue in
// /admin/voice/queues is a display change and must never re-route anything.
const TOPIC_TO_QUEUE_KEY: Record<string, string> = {
  'מכירות': 'sales',
  'תמיכה': 'support',
  'חיוב ותשלום': 'billing',
  // 'אחר' is deliberately absent — an unrouted inquiry is visible and
  // triageable; a wrongly-routed one is not.
};
```

**בדיקה שחייבת להתלוות** (אחרת אותו פער יחזור כשמישהו יוסיף נושא):

```ts
it('every INQUIRY_TOPIC except אחר maps to a real, active queue key', async () => {
  const keys = new Set((await activeQueueKeys()).map((q) => q.key));
  for (const topic of INQUIRY_TOPICS) {
    if (topic === 'אחר') continue;
    expect(keys, `topic ${topic}`).toContain(TOPIC_TO_QUEUE_KEY[topic]);
  }
});
```

**[נמדד]** אין CHECK על `topic`, ואין על `status` — הקוד כבר כותב `'cancelled'`
שאינו במרחב המתועד (`admin/contacts.ts:92`).

### התיקון

לקשר את הפנייה ל‑`console_queues` במקום להסתמך על מחרוזת. זה נותן **מיד**:
תעדוף אמיתי, שיוך לסוכן, וניהול מהמסך הקיים ב‑`/admin/voice/queues` —
**בלי לבנות דבר**.

והוא פותר גם את `'פנייה בדואר'`: קליטת דואר תשויך ל‑`support` או תישאר ללא
תור עד סיווג, במקום להמציא ערך חדש.

### סיכון והכרעה פתוחה

הטופס הציבורי מציג ללקוח ארבע אפשרויות. `events` אינו אחד מהם, ו‑`אחר` אינו
תור. **צריך להכריע:** האם הטופס עובר להציג את התורים, או שנשמרת מפה בין
מה שהלקוח בוחר לבין התור. אני נוטה לשני — ניסוח פונה ללקוח וניסוח תפעולי אינם
חייבים להיות זהים.

### אימות

1. כל פנייה קיימת מקבלת תור, או מסומנת מפורשות כחסרת תור.
2. הטופס הציבורי ממשיך לעבוד ללא שינוי גלוי ללקוח.
3. `/admin/contacts` מציג את התור ואת העדיפות.

---

## F. דחיפות לפי אירוע קרוב

**[נמדד]** ניתן לגזירה בזמן קריאה דרך `events.event_date` ו‑`campaigns.status`
דרך `owner_id` — אותו join שכבר קיים ב‑`resolveCandidateEvents`.

**בלי עמודה חדשה** — היא תתיישן ברגע שהאירוע נגמר.

**[נמדד]** רלוונטי במיוחד ללקוחות פרטיים: אירוע בעוד שלושה ימים הוא החתונה של
מישהו, ושאלה עליו אינה יכולה להמתין לצד שאלת מחיר כללית.

**מגבלה שחייבים לתעד:** `profiles` מחזיקה `phone` אך **לא אימייל**. התאמה לפי
טלפון ישירה וממופתחת; לפי אימייל עוברת דרך `listUsers` עם תקרה של 200
משתמשים. טלפון הוא מפתח ההתאמה הראשי.

**ואזהרה:** אימייל וטלפון מטופס ציבורי **אינם הוכחת זהות**. רמז לתעדוף בלבד,
לעולם לא מפתח לנתוני חשבון.

---

## סדר מעודכן

1. **C — commit**
2. **A1 — 14 השיחות** · באג חי
3. **D1+D2 — כותרות שרשור** · הכרחי לכל השאר
4. **E — קישור לתורים** · ערך גבוה, בנוי כבר
5. **A2 + D3 — סגירת החורים השקטים**
6. **F — דחיפות** · אחרי שיש תורים
7. **B — ניקוי EWS** · אחרי ימי יציבות

---

# חלק שלישי — מה שאני יצרתי הלילה

לא לשלול, לבחון. שלושה דברים שהוספתי דורשים הכרעה.

## G1. `topic = 'פנייה בדואר'` — ערך שהמצאתי

**[נמדד]** קליטת הדואר כותבת `topic = 'פנייה בדואר'`. הערך **אינו תואם אף תור**
ואינו ב‑`INQUIRY_TOPICS`. שתי הפניות היחידות מהדואר נושאות אותו.

**למה כתבתי אותו כך:** `INQUIRY_TOPICS` הוא אוצר סגור בגבול הטופס אך טקסט חופשי
בעמודה, וזרמים שרתיים כבר כותבים ערכים תיאוריים (`callback_requests` מכילה
`'שיחה נכנסת ללא נציג זמין'`). הלכתי לפי התקדים.

**למה זה עדיין לא נכון:** התקדים ההוא מתאר **אירוע** שקרה, לא **נושא** של פנייה.
`'פנייה בדואר'` מתאר את **הערוץ** — ולערוץ כבר יש עמודה משלו, `source`.
כלומר שכפלתי מידע שכבר קיים, במקום לענות על השאלה שהעמודה שואלת.

**התיקון:** `topic` יתאר את הנושא ולא את הערוץ. עד שיוכרע E (קישור לתורים),
פנייה מדואר תישאר **ללא נושא** (`null`) במקום לשאת ערך שגוי — כי "לא ידוע"
הוא מידע אמיתי, ו‑`'פנייה בדואר'` הוא מידע כוזב. `source='outlook'` כבר אומר
את מה שניסיתי לומר.

**אימות:** שתי השורות הקיימות מתוקנות; קליטה חדשה אינה כותבת את הערך.

---

## G2. שתי פניות הבדיקה — להשאיר · ✅ בוצע ואומת 16.08

**[נמדד]** שתי שורות `source='outlook'` הן פניות שאני יצרתי בשם "דנה" ושלחתי
לעצמנו. הן נענו, נסגרו, ו‑`distill-corrections` הפך אותן ל‑**2 מתוך 3** הדוגמאות
בקובץ הלמידה של `support-drafter`.

**האינסטינקט הראשון היה למחוק. הוא היה שגוי.**

**[נמדד]** קריאת הדוגמה מראה שהטיוטה בה מכילה בדיוק את השגיאה שתיקנו הלילה:
*"מכיוון שמדובר ב‑150 אורחים, מספר זה נכלל במלואו במכסה הכלולה (200 אנשי קשר)"* —
קריאת אורחים כאנשי קשר. וההודעה שנשלחה בפועל היא הגרסה המתוקנת.

זהו בדיוק מה ש‑`distill-corrections` נבנה ללכוד: מה הסוכן כתב, ומה אדם שינה.
וזו **התיקון בעל הערך הגבוה ביותר במערכת** — הבלבול בין אורח, איש קשר ונענה,
שבמספרים גדולים היה מפחיד לקוח במחיר שלא נגבה.

**החלטה: להשאיר את שתיהן.** אבל שני דברים כן לתקן:

1. **הטקסט מכיל `intake-1786846057899`** — חותמת בדיקה חסרת משמעות שהסוכן עלול
   לחקות. לנקות מגוף ההודעה.
2. **לסמן שהן סינתטיות.** הן נראות כלקוחה אמיתית בשם דנה, ואינן. סימון מונע
   מאדם עתידי להסיק מהן על התנהגות לקוחות אמיתית.

**מה שהיה נכון לעשות מלכתחילה:** לבדוק בתיבה נפרדת, או לסמן את השורה כבדיקה
בזמן היצירה. הפקת לקח, לא רק תיקון.

### ✅ בוצע 16.08 — ותפס עוד חותמת שלא ידעתי עליה

שני החלקים הוחלו: החותמות הוסרו מ‑`contact_messages` **ומ‑`inquiry_messages`**,
ושתי השורות סומנו `[בדיקה]` בשם — כך שקורא עתידי רואה מיד שאינן לקוחה אמיתית.

**מה שכמעט פספסתי:** ה‑`UPDATE` הראשון קודד את ערך החותמת כליטרל
(`intake-1786846057899`), ובפועל היו **שתיים** — `intake-1786846690771` ישבה
בשורה השנייה ושרדה. אימות רחב (`~ 'intake-\d+'`) חשף אותה; ליטרל שני היה
מסתיר אותה. התיקון עבר להתאמת **תבנית**. אימות סופי: `contacts_left: 0`,
`thread_left: 0`.

**הלקוח החוזר של היום:** לתקן לפי ערך שראית, ולאמת לפי הדפוס שקיים.

---

## G3. תיקיית `KALFA-Intake` והודעות הבדיקה בתיבה

**[נמדד]** יצרתי תיקייה בתיבה החיה, ובתוכה שתי הודעות בדיקה. בנוסף נשלחו
מספר מיילי בדיקה לתיבה ולכתובת החיצונית.

**החלטה: התיקייה נשארת** — היא תשתית הקליטה ולא פסולת. **הודעות הבדיקה** ניתנות
למחיקה, אבל הן גם התיעוד היחיד שהזרימה עבדה מקצה לקצה. להשאיר עד שתהיה קליטה
אמיתית ראשונה, ואז לנקות.

---

# נספח מימוש — הקוד עצמו

כל שלב כאן מוכן להעתקה. אין מחקר בזמן ביצוע.

---

## A1 · שחרור 14 השיחות

### שלב 1 — אימות מקדים (חובה, לא דילוג)

הסיכון היחיד הוא שפגישה כן קיימת ואנחנו מאפסים. לכן בודקים את **כולן**, לא דגימה:

```bash
node --env-file=.env.local -e "
const {ClientCertificateCredential}=require('@azure/identity');
const {createClient}=require('@supabase/supabase-js');
const c=new ClientCertificateCredential(process.env.MS_GRAPH_TENANT_ID,process.env.MS_GRAPH_CLIENT_ID,{certificatePath:process.env.MS_GRAPH_CERT_PATH});
(async()=>{
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from('callback_requests').select('id,calendar_item_id')
    .not('calendar_item_id','is',null).not('status','in','(completed,cancelled)');
  const t=(await c.getToken('https://graph.microsoft.com/.default')).token;
  const alive=[],dead=[];
  for (const r of data) {
    const res=await fetch('https://graph.microsoft.com/v1.0/users/'+process.env.MS_GRAPH_PRIMARY_MAILBOX+'/events/'+encodeURIComponent(r.calendar_item_id),{headers:{Authorization:'Bearer '+t}});
    (res.status===404?dead:alive).push(r.id);
  }
  console.log('מתות:',dead.length,'| חיות:',alive.length);
  if (alive.length) console.log('⛔ עצור — יש פגישות חיות:',alive);
  else console.log(JSON.stringify(dead));
})()"
```

**שער:** אם `alive.length > 0` — **לעצור**. איפוס שורה עם פגישה חיה ייצור כפילות
ביומן. להמשיך רק כשכולן 404.

### שלב 2 — השחרור

```sql
update public.callback_requests
set calendar_item_id = null,
    exchange_connection_id = null,
    scheduled_at = null
where calendar_item_id is not null
  and status not in ('completed','cancelled')
  and scheduled_at < now() - interval '1 day';
```

התנאי השלישי הוא הגנה: הוא מגביל בדיוק לחלון שהריפוי מפספס, כך שהפקודה אינה
יכולה לגעת בשורה שהריפוי הרגיל כן מטפל בה.

### שלב 3 — אימות אחרי

```sql
-- חייב להחזיר 0
select count(*) from callback_requests
where calendar_item_id is not null and status not in ('completed','cancelled')
  and scheduled_at < now() - interval '1 day';
```

ואז, אחרי ריצת סריקה אחת (עד דקה):

```sql
-- כמה קיבלו מזהה חדש, ובאיזה פורמט
select count(*) filter (where calendar_item_id like 'AAMkADk5%') as old_dead,
       count(*) filter (where calendar_item_id is not null
                        and calendar_item_id not like 'AAMkADk5%') as new_graph
from callback_requests where status not in ('completed','cancelled');
```

`old_dead` חייב להיות 0. `new_graph` הוא מספר השורות ששוחזרו.

---

## A2 · סגירת החור — התראה, לא הרחבת חלון

**למה לא להרחיב את החלון:** הוא קיים כדי לתחום עלות שאילתה. הרחבה מטפלת במקרה
הזה ולא במקרים שטרם ראינו. **גילוי** עדיף על **תיקון‑עיוור**.

הוסף ל‑`src/lib/data/callback-scheduling.ts`, אחרי `reconcileCallbacksWithCalendar`:

```ts
/**
 * A request holding a calendar_item_id whose slot has already passed, still not
 * terminal, is STRANDED by definition: the sweep skips it (the id is set, so it
 * returns 'already_scheduled') and the reconciler cannot see it (its window is
 * one day). It exists in neither the calendar nor the queue.
 *
 * Measured 2026-08-16: 14 such rows accumulated silently across the EWS→Graph
 * migration, the oldest from 28.07. Nobody noticed because neither mechanism
 * reports on what it skips.
 *
 * Deliberately a DETECTOR, not a fixer. Releasing automatically would double-book
 * any row whose appointment does still exist; a human deciding beats a heuristic
 * guessing. Cheap: one indexed count, no calendar read.
 */
export async function countStrandedCallbacks(
  opts: { nowMs?: number } = {},
): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('callback_requests')
    .select('id', { count: 'exact', head: true })
    .not('calendar_item_id', 'is', null)
    .not('status', 'in', '(completed,cancelled)')
    .lt('scheduled_at', new Date(nowMs - DAY_MS).toISOString());
  if (error) return 0; // A failed read must never masquerade as "all clear".
  return count ?? 0;
}
```

### ⚠️ תוקן בביקורת — שם הפונקציה היה שגוי

הגרסה הקודמת כאן אמרה **`runCallbackScheduleSweep`**. אין פונקציה כזו. השם
האמיתי הוא **`runCallbackSchedulingSweep`** (`callback-scheduling.ts:464`) —
`Scheduling`, לא `Schedule`. העתקה כלשונה הייתה נכשלת מיד.

מה שכן אומת ותקין: `sendSlackAlert` ו‑`createAdminClient` **כבר מיובאים** בקובץ
(שורות 19 ו‑42), ו‑`SlackAlertInput` מקבל בדיוק את חמשת השדות שבקטע
(`level`, `title`, `source`, `fields`, `category`). אין ייבוא חדש להוסיף.

ב‑`runCallbackSchedulingSweep` (שורה 464), מיד אחרי
`const healed = await reconcileCallbacksWithCalendar({ nowMs: opts.nowMs });`
(שורה 471):

```ts
  const stranded = await countStrandedCallbacks({ nowMs: opts.nowMs });
  if (stranded > 0) {
    void sendSlackAlert({
      category: 'errors',
      level: 'warn',
      title: 'בקשות שיחה חוזרת נטושות — פגישה שאינה קיימת ומועד שחלף',
      source: 'callback-sweep',
      fields: { count: stranded },
    });
  }
```

**למה דווקא שם, ולא בסוף הפונקציה:** לפונקציה יש יציאה מוקדמת בשורה 509
(`return { scheduled: 0, skipped: 0, released: healed.released, … }`) כשאין מה
לשבץ. הצבה מיד אחרי `healed` מבטיחה שהגלאי רץ **בשני המסלולים** — וזה בדיוק
המסלול השקט שבו 14 השורות הצטברו.

### A2ב · הסריקה המתוזמנת שותקת — **נמדד 16.08 בזמן אמת**

השחרור של 14 השורות רץ בפועל, יצר 14 פגישות ב-Graph, ו**לא הותיר שורה אחת
בלוג**. חיפוש ב-`kalfa-worker-out.log` בין 12:40 ל-12:52 מחזיר ריק. את ההצלחה
אפשר היה לאמת רק מול ה-DB.

הסיבה בקוד: מסלול ה-LISTEN מתעד את התוצאה, ומסביר במפורש למה —
*"a push-triggered sweep is otherwise invisible: the notification line proves
the announcement arrived, not that the work ran or what it decided"*
(`worker/main.ts:506-512`). מסלול ה-cron קורא לאותה פונקציה בדיוק
ו**משליך את הערך המוחזר**:

```ts
    guardedWorker(QUEUES.callbackScheduleSweep, async () => {
      await runCallbackSchedulingSweep();     // ← התוצאה נזרקת
    }),
```

זו אותה עיוורון שאיפשר ל-14 השורות להצטבר מלכתחילה. ההערה הקיימת כבר מנמקת את
התיקון; היא פשוט לא הוחלה על המסלול השני.

**התיקון** (`worker/main.ts`, ברישום `QUEUES.callbackScheduleSweep`):

```ts
    guardedWorker(QUEUES.callbackScheduleSweep, async () => {
      // Same reason the LISTEN path above logs: a sweep that reports nothing
      // cannot be distinguished from a sweep that did nothing. MEASURED 16.08 —
      // the run that re-created 14 stranded customer callbacks left no trace at
      // all, and only a DB query could confirm it had happened.
      const r = await runCallbackSchedulingSweep();
      // Quiet ticks are the normal case, so only speak when something moved —
      // otherwise this prints every ten minutes forever and becomes the noise
      // it is meant to cut through.
      if (r.scheduled || r.released || r.repaired) {
        console.log(
          `[callback-cron] sweep — שובצו ${r.scheduled}, נדחו ${r.skipped}, שוחררו ${r.released}, תוקנו ${r.repaired}`,
        );
      }
    }),
```

תג נפרד (`[callback-cron]` מול `[callback-listen]`) כדי שיהיה אפשר להבחין איזה
מסלול פעל — היום שניהם היו נראים זהים.

### בדיקה (הבדיקה שהייתה תופסת את הבאג)

`src/lib/data/callback-scheduling.test.ts`:

```ts
describe('countStrandedCallbacks', () => {
  // Regression for a measured incident: 14 rows accumulated invisibly because
  // the sweep skips rows that HAVE an id and the reconciler only looks one day
  // back. Neither reported what it skipped.
  it('counts a row whose slot has passed and whose appointment id is dead', async () => { /* … */ });
  it('does NOT count a row still inside the reconciler window', async () => { /* … */ });
  it('does NOT count a terminal row', async () => { /* … */ });
  it('returns 0 — never a false all-clear — when the read fails', async () => { /* … */ });
});
```

---

## G1 · הסרת ה‑`topic` שהמצאתי

ב‑`src/lib/data/inquiry-mail-intake.ts`, להחליף את הקבוע ואת השימוש בו:

```ts
// An emailed inquiry arrives with no topic — nobody picked one from a list.
// The earlier value here, 'פנייה בדואר', described the CHANNEL, and the channel
// already has its own column (`source`). Writing it into `topic` duplicated
// known data while answering the wrong question, and produced a value matching
// no console_queues row.
//
// NULL is the honest value: "not yet classified" is real information, and a
// wrong label is worse than an absent one. `source='outlook'` already says
// where it came from.
const MAIL_TOPIC: string | null = null;
```

ובקריאת ה‑upsert (שורה 83), `topic: MAIL_TOPIC` נשאר כפי שהוא — הוא כבר
nullable בסכמה.

### ⚠️ תוקן בביקורת — השינוי הזה שובר את `tsc`, והמסמך לא אמר זאת

`MAIL_TOPIC` מופיע ב**שלושה** מקומות, לא בשניים. השלישי הוא שורה **109**:

```ts
  void sendSlackAlert({
    category: 'customer_inquiry',
    ...
    fields: { contactMessageId: created, topic: MAIL_TOPIC },   // ← כאן
  });
```

`SlackAlertInput.fields` מוקלד `Record<string, string | number>`
(`src/lib/alerts/slack.ts:54`). **`null` אינו מתקבל שם.** הפיכת הקבוע ל‑
`string | null` מפילה את `npx tsc --noEmit` מיד.

**התיקון:** להסיר את השדה לגמרי מההתראה. הוא מיותר מרגע שהערך הוא `null`, ו‑
`source: 'outlook'` שכבר יושב שם אומר בדיוק את מה שהוא ניסה לומר:

```ts
  // `source` already carries the channel; `topic` is deliberately unset for
  // mail intake (see MAIL_TOPIC above), so sending it here would be a null.
  fields: { contactMessageId: created },
```

**ולתקן גם את ההערה בשורות 102‑103** — היא אומרת *"only the row id and the
closed-vocabulary topic reach Slack"*, ומרגע השינוי אין topic כלל.

### תיקון שתי השורות הקיימות

```sql
update public.contact_messages set topic = null
where source = 'outlook' and topic = 'פנייה בדואר';
```

### בדיקה

ב‑`src/lib/data/inquiry-mail-intake.test.ts`, להחליף את הטענה על `topic`:

```ts
it('leaves topic unset — the channel is not a topic', async () => {
  // 'פנייה בדואר' described the channel, which `source` already carries.
  expect(captured[0].row.topic).toBeNull();
  expect(captured[0].row.source).toBe('outlook');
});
```

ולעדכן את בדיקת ההתראה, ששולחת `topic` ב‑fields.

---

## D1 · כותרות שרשור ביציאה

### שינוי 1 — הממשק

`src/lib/email/sender.ts`, בהגדרת `EmailSender`:

```ts
export interface EmailSender {
  send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    attachments?: EmailAttachment[];
    /**
     * RFC 5322 Message-ID of the message being replied to, angle brackets and
     * all. Sets In-Reply-To and References so the recipient's client threads
     * the reply under their original — and, crucially, so THEIR next reply
     * carries the chain back to us. Without it every reply opens a new thread
     * and there is nothing to correlate on.
     */
    inReplyTo?: string;
  }): Promise<void>;
}
```

### שינוי 2 — נתיב Resend

```ts
    async send({ to, subject, html, text, attachments, inReplyTo }) {
      const { error } = await client.emails.send({
        from,
        to,
        replyTo: from,
        subject,
        html,
        // References carries the whole chain per RFC 5322; a client replying to
        // this message appends to it, so our original id survives in their reply.
        ...(inReplyTo
          ? { headers: { 'In-Reply-To': inReplyTo, References: inReplyTo } }
          : {}),
        ...(text ? { text } : {}),
```

### שינוי 3 — נתיב SMTP (nodemailer מקבל אותן כשדות עליונים)

```ts
    async send({ to, subject, html, text, attachments, inReplyTo }) {
      try {
        await transporter.sendMail({
          from, to, replyTo: from, subject, html, text,
          ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
```

### שינוי 4 — המקור לערך

`src/lib/data/admin/contacts.ts`, ב‑`sendInquiryReply`, להוסיף לשליפה:

```ts
    .select('email, name, source_message_id')
```

ובקריאה לשליחה:

```ts
    await sender.send({
      to: msg.email, subject, html, text,
      // Only mail-sourced inquiries have one; a web-form inquiry has no thread
      // to attach to, and passing undefined is the correct no-op.
      inReplyTo: msg.source_message_id ?? undefined,
    });
```

### אימות

לשלוח תשובה לפנייה מדואר, ולקרוא את הכותרות שהתקבלו בפועל:

```bash
# In-Reply-To חייב להופיע ולהכיל את ה-Message-ID של הפנייה המקורית
```

---

## D2 · זיהוי התגובה החוזרת

**Graph נותן את זה חינם.** `conversationId` יציב לאורך השרשור — הודעה חוזרת
נושאת את אותו ערך. אין צורך לנתח `References`.

### מיגרציה

```bash
npx supabase migration new inquiry_thread_id
```

```sql
-- Graph's conversationId groups a mail thread natively and stays stable across
-- replies. Storing it on first intake is what lets a later message in the same
-- thread attach to the existing inquiry instead of opening a second one.
--
-- Nullable: web-form inquiries have no thread, and that is not a defect.
alter table public.contact_messages
  add column if not exists thread_id text;

create index if not exists contact_messages_thread_idx
  on public.contact_messages (thread_id) where thread_id is not null;
```

### קוד

`src/lib/data/inquiry-mail-intake.ts` — לשמור בעת הקליטה:

```ts
        thread_id: mail.conversationId,
```

ולפני ה‑upsert, לבדוק אם השרשור מוכר:

```ts
  // A message in a thread we already hold is a REPLY, not a new inquiry.
  if (mail.conversationId) {
    const { data: existing } = await admin
      .from('contact_messages')
      .select('id, status')
      .eq('thread_id', mail.conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return attachReplyToInquiry(existing.id, mail);
    }
  }
```

---

## D3 · סטטוס `reopened` — והמלכודת

**[נמדד]** הטריגר בצי: `status = 'new' AND draft_reply IS NULL`
(`.claude/fleet/bin/scheduler.mjs:197`). בפנייה שנענתה `draft_reply` תפוס,
ולכן `new` לא יעיר את הסוכן.

### שינוי 1 — הטריגר

`.claude/fleet/bin/scheduler.mjs`, ב‑`TRIGGERS.contact_messages_new`:

```js
    query:
      "select count(*)::int as n from contact_messages " +
      "where (status = 'new' and draft_reply is null) " +
      "   or (status = 'reopened' and reply_needed_at > coalesce(draft_created_at, 'epoch'))",
```

התנאי השני משווה **זמנים** ולא NULL: טיוטה ישנה משאירה את השורה זכאית עד
שתיכתב טיוטה חדשה **אחרי** התגובה. זה מה שמונע את התקיעה.

### שינוי 2 — עמודה לזמן התגובה

באותה מיגרציה של D2:

```sql
-- When the customer last wrote back. Compared against draft_created_at so a
-- stale draft from the previous round does not make the row look handled.
alter table public.contact_messages
  add column if not exists reply_needed_at timestamptz;
```

### שינוי 3 — מוני הניווט

`src/lib/data/admin/nav-counts.ts:36`, בתוך `countNewContacts`:

```ts
    .in('status', ['new', 'reopened']);
```

**[אומת בביקורת]** שורה 36 מדויקת, ו**רק** היא — שורה 44 היא `.eq('status','new')`
על `callback_requests`, טבלה אחרת, ואסור לגעת בה.

**מה שקריאה מלאה חשפה והמסמך לא אמר:** ההערה בשורות 28‑30 קובעת שדשבורד
`/admin` (`dashboard.ts`) **משתמש חוזר באותם שני מונים בדיוק**, "so that card
and this sidebar badge can never show two different numbers". כלומר השינוי הזה
מעדכן **שני משטחים גלויים**, לא אחד — וזו התנהגות רצויה, אבל צריכה להופיע
באימות: לוודא ששניהם עלו במקביל.

### שינוי 4 — הצירוף

```ts
async function attachReplyToInquiry(id: string, mail: InboundMail) {
  const admin = createAdminClient();
  await admin.from('contact_messages').update({
    // Appended, never overwritten: what was said before is the context the
    // drafter needs, and losing it makes the next reply repeat itself.
    message: `${existingMessage}\n\n--- תגובת הלקוח ${mail.receivedAt} ---\n\n${flattenForDrafter(mail)}`,
    status: 'reopened',
    reply_needed_at: mail.receivedAt,
    handled_at: null,
  }).eq('id', id);
}
```

### בדיקות

```ts
it('attaches a reply to the existing inquiry, not a new row', …);
it('sets reopened — never new — so the fleet trigger still fires', …);
it('keeps the earlier text; a reply appends', …);
it('leaves an unrelated thread alone', …);
```

**ובדיקה חיה שאין לדלג עליה:** להשיב למייל שנשלח, ולוודא ש‑`support-drafter`
**באמת התעורר** — לא רק שהסטטוס השתנה. זו הבדיקה שמפרידה בין "עובד" ל"נראה
עובד".

---

## E · קישור לתורים

### מיגרציה

```bash
npx supabase migration new inquiry_queue_link
```

```sql
-- `topic` was free text describing what the customer picked. `console_queues`
-- is the real routing table — it carries priority and agent assignment and is
-- already managed at /admin/voice/queues. Two vocabularies for one concept:
-- measured, 4 of 6 inquiries already matched a queue by name exactly.
--
-- `topic` is KEPT: it is what the customer chose, in their words. queue_id is
-- where it routes. They are not the same fact.
alter table public.contact_messages
  add column if not exists queue_id uuid references public.console_queues(id);

create index if not exists contact_messages_queue_idx
  on public.contact_messages (queue_id) where queue_id is not null;
```

### מיפוי חד‑פעמי של הקיים

```sql
update public.contact_messages c
set queue_id = q.id
from public.console_queues q
where q.name_he = c.topic and c.queue_id is null;
```

**[נמדד]** יתאים 4 מ‑6. השאר יישארו `null` — וזה נכון.

### מיפוי בזמן יצירה

`src/lib/data/inquiries.ts`, ב‑`createContactMessage`:

```ts
  // The customer's chosen topic maps to a routing queue by its Hebrew name.
  // No match is a legitimate outcome ('אחר' is not a queue) — an unrouted
  // inquiry is visible and triageable; a wrongly-routed one is not.
  const { data: queue } = await supabase
    .from('console_queues')
    .select('id').eq('name_he', input.topic).eq('is_active', true).maybeSingle();
```

### הכרעה פתוחה — לבעלים

הטופס הציבורי מציג `מכירות · תמיכה · חיוב ותשלום · אחר`. התורים הם
`sales · support · events · billing`. **`אחר` אינו תור, ו‑`events` אינו בטופס.**

שתי אפשרויות: לשנות את הטופס להציג את התורים, או לשמור מפה. **המלצה: מפה** —
ניסוח פונה ללקוח וניסוח תפעולי אינם חייבים להיות זהים, ושינוי הטופס משנה חוויה
ציבורית עבור נוחות פנימית.

---

## F · דחיפות לפי אירוע קרוב

ב‑`listContactMessages`, שאילתת batch אחת ולא N+1:

```ts
// Urgency is DERIVED, never stored: a stored flag goes stale the moment an
// event passes. For private customers this is the only urgency axis that
// exists — an event in three days is somebody's wedding.
//
// Phone is the primary match key: profiles.phone is a real indexed column,
// while email matching must go through GoTrue's listUsers with a 200-user
// ceiling (see admin/support.ts:342). Phone first, email as fallback.
//
// NOT proof of identity. A phone typed into a public form is a priority hint
// and must never gate access to account data.
```

---

## שערי אימות — לכל שלב, בלי יוצא מן הכלל

```
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

ולשלבים שנוגעים ל‑DB, בנוסף: ספירה לפני, ספירה אחרי, ובדיקת רגרסיה שמכסה את
המצב שנשבר.

---

# חלק רביעי — איכות התשובה עצמה

> נוסף 16.08 אחרי בחינת הטיוטה החיה `6a594a9f`. חלקים A–G עוסקים בכך שפנייה
> **תגיע** ותיענה. חלק H עוסק בכך שמה שנשלח **ייקרא כמו שאדם מקצועי כתב אותו**.

## H0. הראיה — טיוטה חיה, לא היפותזה

**[נמדד]** פנייה `6a594a9f-0c99-4ed6-a274-6e292f6b7dea` (16.08, 06:05, `מכירות`):
*"רציתי לדעת מה כוללת החבילה ומה המחיר ל‑150 אורחים"*. הטיוטה נכתבה 06:06.

**מה עבד:** הטיוטה הבחינה נכון בין אורח, איש קשר ונענה — בדיוק התיקון בעל הערך
הגבוה ביותר מ‑G2. הנוסח מופיע כמעט מילה במילה מ‑`billing_unit_he`.

**ולכן ההסקה החשובה:** מה שמלמד את הסוכן בפועל הוא **קובץ הגרונדינג בקוד**
(`src/lib/fleet/business-facts.ts`), שאני רשאי לערוך. זו הנקודה שבה שינוי
משפיע על כל תשובה עתידית בבת אחת.

> **[לא נבדק]** האם קורפוס `distill-corrections` תרם גם הוא. הקורפוס נכתב 06:40,
> אחרי הטיוטה. לא לייחס לו את הקרדיט בלי מדידה.

**מה לא עבד — ארבעה ליקויים:**

| # | הליקוי | שורש |
|---|---|---|
| H1 | ברכה כפולה — הטיוטה פותחת `שלום,` והתבנית מוסיפה `שלום {שם},` | הוראה בקובץ הרול |
| H2 | חתימה כפולה — `— צוות KALFA` בגוף, ועוד אחת בפוטר | הוראה בקובץ הרול |
| H3 | `[נציג יפרט תכונות נוספות]` — placeholder בעוד 12 תשובות FAQ מפורסמות | אין לסוכן גישה ל‑FAQ |
| H4 | אין קישור להמשך — הלקוח קורא ולא יודע מה לעשות | לתבנית לא הייתה תמיכה בקישור |

---

## H1+H2+H4 · תבנית המייל — ✅ בוצע ואומת · commit `cfc2959`

`src/lib/email/templates.ts` · `templates.test.ts` — **21 בדיקות**, כולן עוברות
(המסמך אמר 16; נוספו מקרי הקצה המנוונים ובדיקת הפיסוק אחרי הכתיבה המקורית).
פרוס וחי מ‑12:57.

**קישורים.** תחביר `[טקסט](/נתיב)` הופך לעוגן. **נתיב בלבד, אף פעם לא URL מלא** —
סכימה אינה מתקבלת כלל, ולכן `javascript:`/`data:` אינם ניתנים לביטוי מלכתחילה,
ולא נחסמים ברשימה שחורה. `(?!\/)` דוחה `//host`. זו אותה מדיניות ש‑
`resolveInternalTarget` (`src/lib/url.ts`) אוכפת לקישורי האפליקציה.

**קישור > URL גולמי, והסיבה אינה אסתטית:** URL באותיות לטיניות בתוך פסקה עברית
נשבר ב‑bidi — סימני פיסוק קופצים לצד הלא נכון. עוגן בעברית מסלק את הבעיה.

**זרוע הטקסט חובה.** בלעדיה הלקוח מקבל `[הרשמה](/auth/signup)` — מקור markdown
בתיבה שלו.

> **⚠️ תוקן בביקורת — הצורה שתועדה כאן אינה הצורה שנשלחת.** המסמך אמר
> `הרשמה: https://…` (נקודתיים). הקוד בפועל (`templates.ts:109`) מייצר
> **`הרשמה (https://…)`** — בסוגריים. השינוי נעשה אחרי כתיבת הסעיף, משתי סיבות
> שנמדדו ברינדור אמיתי: נקודתיים חותכות משפט עברי באמצע כשהקישור יושב בתוך
> פסקה, ו‑URL שמסיים משפט **בולע את הנקודה** לתוך הקישור האוטומטי שרוב לקוחות
> הדואר בונים. סוגריים נסגרות לפני הפיסוק, ושתי הבעיות נעלמות.

**ברכה כפולה** — `LEADING_GREETING` מסיר שורת פתיחה עצמאית בלבד (דורש מעבר שורה
אחריה), כך שמשפט שרק *מתחיל* במילה "שלום" נשאר שלם.

**`dir="rtl"` על `<body>` וגם `<html>`** — תיעוד react-email: חלק מלקוחות הדואר
מסירים אחד מהתגים. עם התכונה על `<html>` בלבד, לקוח כזה מפיל את כל ההודעה ל‑LTR.

### למה לא ספרייה — **נמדד, לא הוסק**

`@react-email/markdown` (של צוות Resend, שה‑SDK שלו כבר הטרנספורט שלנו) הוא
הזרימה המתבקשת. הורדתי את הטארבול המפורסם 0.0.18 והרצתי דרכו:

```
קלט : שלום <script>alert(1)</script> ו-<img src=x onerror=alert(2)>
פלט : <p>שלום <script>alert(1)</script> ו-<img src=x onerror=alert(2)></p>
```

`dangerouslySetInnerHTML` על `marked.parse()`, `sanitize` — אפס התאמות בבנייה.
גוף התשובה שלנו נכתב ע"י סוכן AI, שהוא בדיוק מחלקת הקלט שאסור לה להגיע לנתיב
לא‑מסונן. escape‑first + שתי המרות צרות **מחמיר יותר** מהספרייה, לא עצל ממנה.

**מה כן לאמץ ממנה, בנפרד:** `render(node, {plainText:true})` מייצר את גרסת
הטקסט מה‑HTML במקום שנתחזק שתיהן ביד. דורש המרת התבניות ל‑JSX — הצעה נפרדת.

### `typedRoutes` — נבחן ונדחה למטרה הזו

**[נמדד]** יציב ב‑Next 16 (לא `experimental`), **לא מופעל**. `tsconfig.include`
כבר כולל `.next/types/**` — התשתית מוכנה. אבל הוא מטפס רק על ליטרלים ועל
`next/link`; הנתיב כאן מגיע כמחרוזת ריצה מטקסט של סוכן, ולכן **לא ניתן לבדיקה**
בדרך זו. 66 אתרי קריאה. נרשם כממצא, נשאר כבוי.

---

## H3 · הפער שנותר פתוח — הסוכן אינו רואה את ה‑FAQ

**[נמדד]** 12 פריטי FAQ מפורסמים עונים על *"מה כוללת החבילה"*: ערוצים ואופן
תגובה, לוח הזמנים המלא, ייבוא אורחים, סוגי אירועים, אופן התשלום, ביטול.
הסוכן כתב `[נציג יפרט תכונות נוספות]` כי אין לו פועל שקורא אותם.

### ⚠️ תוקן בביקורת — הגרסה הקודמת של הקטע הזה הייתה שגויה בשלוש דרכים

הקטע שהיה כאן שאל את **העמודות הגולמיות** וסינן `.not('answer','eq','')`.
קריאה מלאה של `src/lib/faq/page-model.ts` מראה ששלושתן שגויות:

| # | מה הקטע הישן עשה | למה זה שבור |
|---|---|---|
| 1 | `.not('answer','eq','')` | **מפיל בדיוק את שורת הציות הקריטית.** ההערה שם אף הפנתה ל‑H5 — ממצא שנמשך. `pricing_no_response` ריק **בכוונה**; התשובה מורכבת בקוד |
| 2 | שאילתת עמודות גולמיות | **מפספס 2 שאלות שאינן שורות DB כלל** — כרטיס המחיר ו‑*"מה ההבדל בין אורח, איש קשר ונענה"* (`page-model.ts:9-14`). השנייה היא התיקון בעל הערך הגבוה ביותר מ‑G2 |
| 3 | ללא `substituteFaqTokens` | **[נמדד]** 2 שורות מפורסמות מכילות `{{channels_list}}` מילולית. הסוכן היה מדביק `ב־{{channels_list}}` **לתוך מייל ללקוח** |

**התיקון: לא לשאול את ה‑DB — לבנות את אותו מודל שהעמוד הציבורי בונה.**
`buildFaqPageModel()` כבר עושה את שלושת הדברים: מרכיב את המשפט המחייב
(`page-model.ts:111-116`), מוסיף את שתי השאלות הקוד‑מוכוונות, ומריץ
`substituteFaqTokens` על כל שאלה ותשובה (`page-model.ts:89-94`).
`flattenFaqEntries()` (שורה 149) מחזיר בדיוק את מה שהלקוח רואה.

**[נמדד] בטיחות‑באנדל אומתה:** `page-model.ts`, `tokens.ts`,
`substitute-tokens.ts`, `agreements/template.ts` ו‑`business-facts.ts` —
**אף אחד מהם אינו מייבא `server-only`**, כך שכולם נכנסים ל‑esbuild bundle.

**מה שאסור:** `getPublishedFaqItems()` (`src/lib/data/faq.ts:18`) — הוא
`server-only` ומשתמש ב‑`createClient()` מבוסס‑עוגייה. ב‑CLI אין session,
ו‑`next/headers` ממילא ממופה ל‑`empty.js` בבאנדל. חייבים `createAdminClient()`
עם אותו `select` בדיוק.

```ts
// Stage-2 grounding, mirroring cmdBusinessFacts above. The PUBLISHED FAQ is
// already the answer to "what does the package include" — written, reviewed
// and live. Without it the drafter emits `[נציג יפרט…]` while twelve approved
// answers sit one query away.
//
// This builds the SAME model the public page renders (buildFaqPageModel +
// flattenFaqEntries) instead of selecting raw columns, and that is the whole
// point rather than a nicety:
//   - two of the answers are code-owned and are NOT rows at all (the price
//     card, and the guest/contact/reached explainer that G2 identified as the
//     highest-value correction in the system);
//   - `pricing_no_response` has an intentionally EMPTY answer column — its
//     mandatory §2 sentence is composed from live facts, so a raw select
//     returns nothing for the single most compliance-sensitive question;
//   - answers carry {{channels_list}} tokens. MEASURED: two published rows do.
//     Handing those to the drafter raw would put `ב־{{channels_list}}` into a
//     customer's inbox.
// The drafter must see exactly what the customer sees. One composition.
async function cmdFaq(): Promise<void> {
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from('faq_items')
    .select('item_key, category, question, answer, sort_order')
    .eq('published', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) fail(`faq read failed: ${error.message}`);

  // The same package + gate read cmdBusinessFacts performs — the FAQ's live
  // numbers and the drafter's quoted price must come from one source.
  const facts = await loadBusinessFacts();

  const model = buildFaqPageModel((rows ?? []) as FaqItemRow[], facts);
  console.log(JSON.stringify({ items: flattenFaqEntries(model) }, null, 2));
}
```

**ריפקטור נדרש קודם:** לחלץ מ‑`cmdBusinessFacts` את גוף הקריאה ל‑
`loadBusinessFacts(): Promise<BusinessFacts>` (הגייט + שורת ה‑package +
`buildBusinessFacts`), ולקרוא לו משני הפעלים. אחרת שתי הקריאות יכולות להיפרד.

ייבואים להוסיף בראש `scripts/fleet-agent-cli.ts`:

```ts
import { buildFaqPageModel, flattenFaqEntries, type FaqItemRow } from '@/lib/faq/page-model';
```

לרשום ב‑`case 'faq': return cmdFaq();` ובמחרוזת ה‑usage (שורה 2547).

**אימות:** הפלט חייב להכיל **14 פריטים** — 12 מפורסמים + כרטיס המחיר + מסביר
היחידות — ו**אפס** מופעי `{{`. שאילתה גולמית הייתה מחזירה 11 ומדליפה 2 טוקנים.

---

## H5 · ~~פריט FAQ מפורסם עם תשובה ריקה~~ — **ממצא שגוי, נמשך 16.08**

**מה טענתי:** `answer` ריק (`len: 0`) בשורה *"אם אף אחד לא יענה, האם עדיין אני
משלם?"* ⇒ שאלה מפורסמת בלי תשובה בעמוד הציבורי.

**מה שבדיקה בפועל מראה — הריקנות היא בכוונת המתכנן.** `curl` על
`https://beta.kalfa.me/faq`, **אחרי הסרת כל בלוקי ה‑JSON‑LD** כדי לוודא שמדובר
בגוף הנראה ולא רק בסכמה למנועי חיפוש:

```
אם אף אחד לא יענה, האם עדיין אני משלם? כן. דמי הפעלה ₪200 — עבור הפעלת
השירות והפצת הפניות בערוצים — … ואינם מותנים בתוצאה …
```

`buildProtectedPricingMandatorySentence()` (`src/lib/faq/page-model.ts:75`) מרכיב
את התשובה מ‑`summary_he` **החי**, וגוזר את ה"כן"/"לא" מ‑`facts.model`. עמודת
`answer` היא **תוספת אופציונלית** בלבד — כך כתוב ב‑`admin/faq.ts:25`
(*"the optional supplement"*) וב‑`page-model.ts:16`. ריקה = אין תוספת = תקין.

זה גם המבנה **הנכון** לשורה הזו: הגילוי לפי §2 חייב לעקוב אחרי המחיר החי, ולכן
אסור לו לשבת בעמודה שאדמין ערך פעם והיא מתיישנת.

### ⚠️ ה"תיקון" שהצעתי כאן היה שובר את הייצור

```sql
check (not published or length(btrim(answer)) > 0)   -- ❌ אל תיישם
```

השורה המוגנת נכשלת ב‑CHECK הזה. **המיגרציה עצמה הייתה נופלת ב‑apply**, ואילו
הייתה עוברת — היא הייתה חוסמת את העריכה הלגיטימית היחידה של השורה.

**הלקח, וזו הסיבה שהסעיף נשאר בתוכנית במקום להימחק:** ספרתי עמודה בלי לקרוא מי
מרנדר אותה. `len: 0` היה מדידה נכונה ומסקנה שגויה. הבדיקה שהייתה מונעת זאת היא
זו שסגרה את זה בסוף — לבקש את **העמוד החי**, לא את העמודה.

---

## H6 · ניסוח שגוי שכתבתי, והגיע ללקוח — **תוקן**

**[נמדד]** `billing_unit_he` הכיל *"לא יכולים לענות יותר אנשים **מכמה** שיש
ברשימה"* — עברית מדוברת בתוך הסבר מחיר. הטיוטה החיה שיכתבה אותו.
תוקן ל‑*"לא ייתכן שיענו יותר אנשים ממספר הטלפונים שברשימה"*.

---

## H7 · הוראת התחביר לסוכן — **owner‑only, מוכן להחלה**

`.claude/fleet/roles/**` נערך ע"י הבעלים דרך `!` בלבד. הרחבת התבנית אינה משנה
מה הסוכן כותב — בלי ההוראה, הפנייה הבאה תחזור ל‑URL גולמי ולברכה כפולה.

**שלוש הוראות להחלה בקובץ `support-drafter.md`:**

1. שורה **74** — `פתיח ניטרלי ("שלום, תודה שפנית אלינו")` → **להסיר**. התבנית
   כבר מרנדרת כותרת *"תודה שפנית אלינו"* וגם `שלום {שם},`. ההוראה הנוכחית
   **מייצרת** את הכפילות. הנחיה חלופית:
   *"פתח ישירות בעניין — המעטפת מוסיפה ברכה ופתיח."*
   *(המסמך אמר 75; ההוראה מתחילה ב‑74 ונמשכת ל‑75.)*
2. שורה **91** — `סיום מקצועי ("נשמח לעזור… — צוות KALFA")` → **להסיר** מאותה
   סיבה. *(אומת — 91 מדויק.)*
3. **להוסיף** תחת "מה לעשות בכל ריצה" — **שורה אחת, שלעולם לא תצטרך שינוי:**
   > **לפני הניסוח, הרץ תמיד:**
   > ```
   > npm run fleet:agent -- faq      # התשובות המאושרות — במקום [נציג יפרט…]
   > npm run fleet:agent -- style    # כללי הפיסוק והמבנה בעברית
   > ```
   > `style` מחזיר את כללי האקדמיה ללשון (פסיק · נקודה · נקודתיים ·
   > נקודה־ופסיק · ירידת שורה), כללי טיפוגרפיה (גרשיים ״ ולא "), ורשימת
   > הטעויות שנמדדו בטיוטות אמיתיות. **צייתו להם.**
   >
   > **קישורים:** כשיש צעד המשך, כתוב אותו כקישור בתחביר `[טקסט](/נתיב)` —
   > נתיב פנימי בלבד, לעולם לא כתובת מלאה. לדוגמה: `[פתיחת חשבון](/auth/signup)`,
   > `[שאלות נפוצות](/faq)`. אל תדביק URL גולמי: הוא נשבר ויזואלית בעברית.

### למה ההוראה מפנה לפועל ולא מכילה את הכללים

**זו הנקודה שמכריעה את כל H7.** קובץ הרול הוא owner‑only, ולכן כל שינוי בו
דורש פעולה ידנית שלך. כללי פיסוק **מתעדכנים** — בכל פעם שמתגלה כשל ניסוח חדש.

לכן הכללים יושבים ב‑`src/lib/fleet/hebrew-style.ts` ונחשפים דרך `style`, בדיוק
כפי ש‑`business-facts` עושה למספרים. **[נמדד 16.08]** עריכת `business-facts.ts`
שינתה את נוסח הטיוטה הבאה תוך 19 דקות מהפריסה, בלי שום פעולה שלך — בעוד
שהברכה והחתימה הכפולות, שיושבות בקובץ הרול, **לא השתנו כלל**.

התוצאה: אתה מחיל את שלוש ההוראות **פעם אחת**, ומכאן כל שיפור בכללי הכתיבה הוא
commit רגיל.

**הערה:** התבנית מנקה ברכה וחתימה כפולות גם בלי ההוראות (הגנה בעומק), אבל
המקור צריך להיתקן — ניקוי בפלט אינו תחליף להוראה נכונה.

---

## H8 · כללי הפיסוק כגרונדינג — ✅ בוצע ואומת

`src/lib/fleet/hebrew-style.ts` · פועל `style` · 6 בדיקות.

**[נמדד]** הסוכן מעתיק את מחרוזות הגרונדינג כמעט מילה במילה, ולכן הפיסוק שלהן
הוא הפיסוק שהלקוח קורא. סריקה של כל הטקסט הפונה ללקוח מצאה שלוש הפרות, ושתיים
מהן **הגיעו ללקוח דרך הסוכן**:

| קובץ | ההפרה | הכלל |
|---|---|---|
| `business-facts.ts` | `ללא דמי מנוי; מחיר סופי` | נקודה־ופסיק בין צירופים שמניים |
| `business-facts.ts` | `מע"מ` | גרש ישר במקום גרשיים ״ |
| `business-facts.ts` | `לא לפי X, ולא לפי Y` | פסיק לפני ו״ו החיבור |
| `agreements/template.ts:239` | `מחיר סופי; לא נגבה מע״מ` | ⏳ אותו כלל, טרם תוקן |
| `terms/page.tsx:86` | `ניתן כפי שהוא; אחריות KALFA` | ⏳ אותו כלל, טרם תוקן |

שלוש הראשונות תוקנו. **שתיים נותרו** — שתיהן בטקסט משפטי, ולכן שינוי ניסוח בהן
נוגע ב‑§2 ובהסכם החתום. אינן תיקון פיסוק גרידא, וצריכות לעבור עם
`israeli-compliance-advisor` לפני נגיעה.

---

# חלק חמישי — הממשק. מה ש‑D שכח

> D תכנן את שכבת **הנתונים** לשרשור ולא שורה אחת על המסך. הממשק היום בנוי
> לפנייה→תגובה בלבד, ולכן **D3 כפי שנכתב גורם נזק**. הסעיף הזה מכריע את D מחדש.

## I0. האבחון — ארבעה שדות חד‑ערכיים

`/admin/contacts/page.tsx` מרנדר כל שדה **פעם אחת**:
`message` (57) · `draft_reply` (72/81) · `sent_reply` (59‑67) · `replied_at` (63).
`CONTACT_COLUMNS` (`admin/contacts.ts:41`, הערך ב‑42) הוא select שטוח — וההערה
שם קובעת במפורש: *"The select string IS the contract"*.

*(כל ההפניות ב‑I0 אומתו בביקורת. רק `contacts.ts:42` תוקן ל‑41.)*

| # | ממצא | הראיה | מה קורה עם D3 |
|---|---|---|---|
| I1 | `sent_reply` היא עמודה אחת | `contacts.ts:42` | מענה שני **דורס** את הראשון. ההיסטוריה שהתוכנית אומרת שנחוצה — נמחקת ברגע שנוצר שרשור |
| I2 | `defaultReply={msg.replied_at ? undefined : …}` | `page.tsx:72` | אחרי מענה ראשון `replied_at` מלא **לתמיד**. טיוטה חדשה תיכתב ל‑DB ו**לא תוצג**. האדם רואה תיבה ריקה |
| I3 | `callbackStatusLabel` נופל למחרוזת גולמית | `labels.ts:30` | `reopened` יוצג כמילה אנגלית בממשק עברי RTL |
| I4 | `.order('created_at', desc)` | `contacts.ts:56` | פנייה מיולי שהלקוח השיב לה היום **שוקעת לתחתית** — בדיוק ההפך מהדחיפות |

**I2 הוא הממצא הקריטי.** התוכנית מקדישה סעיף שלם ("המלכודת שאסור ליפול בה")
למניעת תקיעה שקטה **בטריגר של הצי** — ואז הממשק מחזיר את אותה תקיעה בדיוק,
שלב אחד אחרי. הסוכן יתעורר, יכתוב טיוטה, ואיש לא יראה אותה.

## I5. ההכרעה — `inquiry_messages` עולה לשלב הראשון

**התוכנית קבעה** (סעיף D): *"טבלת ההודעות היא שלב שני"*. **המדידות מבטלות את
ההכרעה הזו.** הנימוק המקורי היה "D1+D2 נותנים את הקישור" — נכון לקישור, אבל
I1 מראה ש‑D3 **מוחק נתונים**, ו‑I2 שהוא **תוקע בשקט**. לשלוח D3 בלי מבנה
שרשור גרוע מלא לשלוח אותו.

**שתי דרכים, וההמלצה חד‑משמעית:**

| | הטלאה — עמודות שטוחות | `inquiry_messages` |
|---|---|---|
| I1 היסטוריה | לצרף טקסט ל‑`sent_reply` | שורה להודעה |
| I2 טיוטה | להשוות `draft_created_at > replied_at` | נגזר ממילא |
| כיוון הודעה | אין | `direction` |
| הקשר לסוכן | פרסור טקסט חופשי | שאילתה |
| עבודה נזרקת | **כולה**, כשתיבנה הטבלה | — |

הטלאה עולה כמעט כמו הפתרון ונזרקת. **בונים את הטבלה.**

### מיגרציה

> `npx supabase migration new inquiry_messages` — **לעולם לא קובץ מיגרציה בכתיבה
> ידנית.**

```sql
-- One inquiry, many messages. `contact_messages` keeps identity + workflow
-- (who, status, queue); the conversation itself moves here.
--
-- WHY NOW and not "phase two": measured 16.08 on the live admin UI —
-- `sent_reply` is a single column, so a second reply OVERWRITES the first, and
-- the reply composer is gated on `replied_at` being null, so a re-drafted reply
-- is never shown. Reopening a thread without this table loses data and stalls
-- silently.
create table if not exists public.inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.contact_messages(id) on delete cascade,
  -- inbound  = the customer wrote to us
  -- outbound = we sent (a human pressed send; drafts are NOT messages)
  -- draft    = the support-drafter proposed; never delivered, never customer-visible
  direction text not null check (direction in ('inbound', 'outbound', 'draft')),
  body text not null check (length(btrim(body)) > 0),
  -- RFC 5322 Message-ID of THIS message, when it has one. Lets an incoming
  -- reply attach by In-Reply-To without re-reading the mailbox.
  message_id text,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- The thread view reads one inquiry in order; this is the only access path.
create index if not exists inquiry_messages_thread_idx
  on public.inquiry_messages (inquiry_id, created_at);

create index if not exists inquiry_messages_message_id_idx
  on public.inquiry_messages (message_id) where message_id is not null;

alter table public.inquiry_messages enable row level security;

-- No policy for anon/authenticated ON PURPOSE. Every read goes through the
-- server DAL behind requirePlatformPermission('view_customer_data'), exactly as
-- contact_messages does; RLS here is the deny-by-default backstop.

-- Backfill: the existing single-valued columns become the first messages, so
-- the thread view is correct for history and not only for new inquiries.
insert into public.inquiry_messages (inquiry_id, direction, body, created_at)
select id, 'inbound', message, created_at
from public.contact_messages
where length(btrim(message)) > 0;

insert into public.inquiry_messages (inquiry_id, direction, body, created_at)
select id, 'outbound', sent_reply, coalesce(replied_at, created_at)
from public.contact_messages
where sent_reply is not null and length(btrim(sent_reply)) > 0;

-- Drafts are carried over ONLY when they were never sent — a draft already
-- superseded by a sent reply is noise in a conversation view.
insert into public.inquiry_messages (inquiry_id, direction, body, created_at)
select id, 'draft', draft_reply, coalesce(draft_created_at, created_at)
from public.contact_messages
where draft_reply is not null and length(btrim(draft_reply)) > 0
  and sent_reply is null;
```

### תנאים מוקדמים לגיבוי — **נמדדו 16.08, ולבדוק שוב לפני ההרצה**

| בדיקה | למה | נמדד |
|---|---|---|
| `count(*) where created_at is null` | `set not null` על `last_activity_at` ייפול אם קיימת | **0** |
| `count(*) where sent_reply is not null and replied_at is null` | `coalesce(replied_at, created_at)` היה ממקם מענה **לפני** ההודעה שהוא עונה לה — הפוך כרונולוגית ב‑`InquiryThread` | **0** |
| `count(*) where draft_reply is not null and draft_created_at is null` | אותו היפוך בטיוטות | **0** |
| `count(*) where btrim(sent_reply) = ''` | ה‑CHECK על `body` ידחה | **0** |

סה"כ 7 שורות. **שער:** אם אחת מהספירות אינה 0 בזמן ההרצה — לעצור. אף אחת מהן
אינה נאכפת סכמתית היום, כלומר הן יכולות להשתנות בין עכשיו לביצוע.

**העמודות הישנות נשארות בשלב הזה** — הן הקריאה של `distill-corrections`
(`draft_reply`↔`sent_reply`) ושל הטריגר בצי. הסרתן היא שלב נפרד, אחרי שהצרכנים
עברו. אין ברירת‑מחדל כפולה: הכתיבה החדשה הולכת לשתיהן עד המעבר.

### I6 · תיקון המיון — הפנייה החוזרת חייבת לעלות

`src/lib/data/admin/contacts.ts`, במקום `.order('created_at')`:

```ts
// A reopened inquiry is MORE urgent than a new one — the customer already
// waited once. Ordering by created_at buried it at its original date, so a
// July thread the customer answered today sank below everything.
// last_activity_at is maintained on write (intake, send) rather than computed,
// so the list stays a single indexed query.
  .order('last_activity_at', { ascending: false })
```

באותה מיגרציה:

```sql
alter table public.contact_messages
  add column if not exists last_activity_at timestamptz;

update public.contact_messages
set last_activity_at = greatest(created_at, coalesce(replied_at, created_at));

alter table public.contact_messages
  alter column last_activity_at set default now(),
  alter column last_activity_at set not null;

create index if not exists contact_messages_activity_idx
  on public.contact_messages (last_activity_at desc);
```

### I7 · תווית `reopened`

`src/lib/data/admin/labels.ts` — ל‑`CALLBACK_STATUS_LABELS`:

```ts
  reopened: 'נפתחה מחדש',
```

בלי זה `labels.ts:30` מציג `reopened` כמילה אנגלית בממשק עברי.

### I8 · תצוגת השרשור

`page.tsx` — במקום `<p>{msg.message}</p>` היחיד (57) ותיבת `sent_reply` (59‑67),
רכיב אחד שמרנדר את השרשור לפי כיוון:

```tsx
// A conversation, not two text fields. Direction drives alignment and colour so
// "who said this" is readable at a glance — the flat rendering merged the
// customer's new reply, our earlier answer, and the original question into one
// undifferentiated grey block with no chronology.
function InquiryThread({ messages }: { messages: InquiryMessage[] }) {
  return (
    <ol className="space-y-2">
      {messages.map((m) => (
        <li
          key={m.id}
          className={
            m.direction === 'inbound'
              ? 'rounded-md border border-border bg-muted/40 p-3'
              : m.direction === 'outbound'
                ? 'rounded-md border border-success/40 bg-success/10 p-3 ms-6'
                : 'rounded-md border border-dashed border-border p-3 ms-6'
          }
        >
          <p className="text-xs font-semibold text-muted-foreground">
            {m.direction === 'inbound'
              ? 'הלקוח'
              : m.direction === 'outbound'
                ? 'נשלח ללקוח'
                : 'טיוטת סוכן — לא נשלחה'}
            {' · '}
            {formatDateTime(m.created_at)}
          </p>
          <p className="whitespace-pre-wrap text-sm">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
```

**RTL:** ההיסט הוא `ms-6` (לוגי) ולא `ml-6` — ב‑RTL הוא נופל לצד הנכון מעצמו.

### I9 · תיקון שער הטיוטה — הבאג שגורם לתקיעה השקטה

`page.tsx:72`, במקום `defaultReply={msg.replied_at ? undefined : msg.draft_reply}`:

```tsx
// A draft written AFTER the last reply is a new proposal for a reopened
// thread and must be offered. The old gate (`replied_at ? undefined : …`)
// compared against "was there ever a reply", so once answered the composer
// never pre-filled again — the drafter would keep writing into a field nobody
// could see. Compare TIMES, exactly as the fleet trigger does.
defaultReply={
  msg.draft_created_at &&
  (!msg.replied_at || msg.draft_created_at > msg.replied_at)
    ? msg.draft_reply
    : undefined
}
```

ולהוסיף `draft_created_at` ל‑`CONTACT_COLUMNS` — הוא אינו נשלף היום.

### I10 · כתיבת המענה גם לשרשור

`src/lib/data/admin/contacts.ts`, ב‑`sendInquiryReply` אחרי שליחה מוצלחת:

```ts
  // The thread is the record; the flat column stays only until
  // distill-corrections and the fleet trigger move off it.
  await admin.from('inquiry_messages').insert({
    inquiry_id: id,
    direction: 'outbound',
    body: reply,
    message_id: sentMessageId ?? null,
    author_id: actorId,
  });
  await admin.from('contact_messages')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', id);
```

### אימות

1. **backfill:** `count(*)` ב‑`inquiry_messages` = פניות עם `message` + עם
   `sent_reply` + טיוטות שלא נשלחו. לספור לפני ואחרי.
2. **I2 — הבדיקה שהכי חשובה:** לפנייה שכבר נענתה, לכתוב `draft_reply` חדש עם
   `draft_created_at > replied_at`, ולוודא שהתיבה **מתמלאת**. זו הבדיקה שמפרידה
   בין "הסוכן התעורר" ל"מישהו ראה את זה".
3. **I1:** לשלוח שני מענים ולוודא ש**שניהם** נראים.
4. **I4:** להשיב לפנייה ישנה ולוודא שהיא עולה לראש.
5. **RTL:** צילום ב‑390 וב‑1280, אין גלישה אופקית.
6. שערים: `tsc` · `lint` · `vitest` · `build`.

---

## סדר סופי — מאומת בביקורת 16.08

### ✅ נסגר, פרוס ואומת חי

| שלב | commit | הראיה |
|---|---|---|
| **C** commit | 10 commits | עץ נקי · `.deploy-id msvmptw7` |
| **A1** 14 השיחות | `c85b888` | `ews_dead 0` · `graph_new 14` · 14/14 מאומתות ב‑Graph |
| **H1·H2·H4** תבנית המייל | `cfc2959` | 21 בדיקות ירוקות |
| **H6** ניסוח `billing_unit_he` | `cfc2959` | — |
| ~~**H5** FAQ ריק~~ | — | ❌ **בוטל** — ממצא שגוי. הריקנות מכוונת |

### ⏳ מה שנותר — נכון ל‑16.08 בסיום היישום

| # | שלב | תלוי ב־ | מוכנות | למה כאן |
|---|---|---|---|---|
| 1 | **H7** הוראות לסוכן | — | ⚠️ **owner בלבד** | בלעדיו H1/H2/H4 אינם משנים התנהגות. **המעטפת מסתירה זאת** — המייל ייראה תקין גם אם הסוכן לא למד |
| 2 | **H3** פועל `faq` | ריפקטור `loadBusinessFacts` | ✅ קוד מלא בתוכנית | מסיר `[נציג יפרט…]` מכל תשובה עתידית. **הקטע תוקן בביקורת** |
| 3 | **G1** ה‑topic שהמצאתי | — | ✅ קוד מלא | זול, עוצר הצטברות נתונים שגויים. **תוקן: כולל תיקון ה‑`tsc`** |
| 4 | **A2 + A2ב** גלאי + לוג | — | ✅ קוד מלא | כדי שזה לא יחזור בשקט. **תוקן: שם הפונקציה** |
| 5 | **D1** כותרות שרשור | — | ✅ קוד מלא | עצמאי לגמרי, תנאי מוקדם לכל שרשור |
| 6 | **I5–I7** טבלה + מיון + תווית | מיגרציה | ✅ קוד מלא | **חייב לקדום ל‑D3** |
| 7 | **I8–I10** תצוגה + שער הטיוטה | I5 | ✅ קוד מלא | בלעדיהם D3 תוקע בשקט (I2) |
| 8 | **D2+D3** זיהוי + סטטוס | I5–I10 | ✅ קוד מלא | רק עכשיו יש לאן לכתוב ומה להציג |
| 9 | **E** תורים | הכרעת בעלים | ⚠️ **תוקן — היה שבור** | `חיוב ותשלום` ≠ `גבייה` |
| 10 | **F** דחיפות | E | קוד חלקי | דורש את E |
| 11 | **G2** ניקוי חותמות | — | ✅ | קוסמטי |
| 12 | **B + G3** ניקוי EWS | יציבות Graph | חסום מבנית | סכמת `exchange_connections` דורשת מיגרציה |

### תלויות קשיחות

```
I5 (טבלה) ──> I8–I10 (ממשק) ──> D2+D3 (סטטוס)
E (תורים) ──> F (דחיפות)
H3 ──> ריפקטור loadBusinessFacts (מ‑cmdBusinessFacts)
```

`H7` · `G1` · `A2` · `D1` **אינם תלויים בכלום** — אפשר לבצע אותם בכל סדר, היום.

**שינוי סדר מהותי מול הגרסה הקודמת.** D2+D3 היו במקום 6 ולפני הממשק. המדידות
ב‑I הראו ש‑D3 בסדר ההוא **מוחק היסטוריה** (I1) ו**תוקע בשקט** (I2). שכבת
השרשור והממשק שלה הן כעת **תנאי מוקדם ל‑D3**, לא המשך לו.

**החלטות פתוחות לבעלים:** E (טופס מול תורים) · H7 (עריכת קובץ הרול דרך `!`).

---

# מצב סופי — 16.08.2026, בסיום היישום

| סעיף | מצב |
|---|---|
| **A1** 14 השיחות | ✅ שוחררו, 14/14 אומתו קיימות ב‑Graph |
| **A2 + A2ב** גלאי נטושות + לוג cron | ✅ + 5 בדיקות |
| **C** commit | ✅ 16 commits, פרוסים |
| **D1** כותרות שרשור | ✅ |
| **D2 + D3** תגובה חוזרת + `reopened` | ✅ + 4 בדיקות |
| **E** ניתוב לתורים | ✅ מפה מפורשת + 6 בדיקות שומר |
| **F** דחיפות | ✅ נגזרת, + 5 בדיקות |
| **G1** ה‑topic שהמצאתי | ✅ קוד + נתונים |
| **G2** חותמות בדיקה | ✅ שתיהן, אחרי שהראשונה פספסה אחת |
| **G3** תיקיית Intake | ✅ נשארת — היא תשתית |
| **H1–H6** איכות התשובה | ✅ + 21 בדיקות |
| **H7** הוראות לסוכן | ✅ **הוחל ואומת חי — 5/5 סמנים** |
| **I0–I10** הממשק | ✅ טבלה, מיון, תווית, תצוגה, שער הטיוטה, כתיבה |
| **H5** FAQ ריק | ❌ ממצא שגוי — נמשך, ונשמר כלקח |
| **B** ניקוי EWS | ⏸️ **נדחה במכוון**, לא "לא בוצע" |

## למה B אינו פריט פתוח

זו הכרעה של התוכנית עצמה, לא עבודה שנשמטה: `EXCHANGE_PROVIDER=ews` הוא מתג
החזרה לאחור, ומחיקת המימוש מבטלת אותו. בנוסף התברר שהחסם עמוק מניקוי קוד —
`exchange_connections` בנויה כך ש**חיבור אינו יכול להתקיים בלי סוד ש‑Graph לא
קורא** (`auth_method CHECK IN ('ntlm','basic')` בלי ערך ל"תעודה", ושלוש עמודות
סוד `NOT NULL`). זה דורש מיגרציה משלו, ולפי התוכנית — רק אחרי ימי יציבות
מוכחים על Graph.

## שלושת הלקחים שחוזרים בכל הסעיפים

1. **מדידה נכונה, מסקנה שגויה.** H5 (עמודה ריקה שהיא תקינה), E ("4 מ‑6 תואמות"
   שנבדק על נתונים קיימים ולא על אוצר המילים), G2 (תיקון לפי ליטרל כשהיו שניים).
   בכל שלושתם המספר היה נכון והפרשנות לא.
2. **"אתרי הקריאה עברו" ≠ "התלות עברה."** ארבעה מודולים עברו ל‑`calendar-provider`
   והמשיכו לפענח סוד EWS — נתיב Graph שתלוי במפתח שאינו קורא.
3. **שקט אינו הצלחה.** הסריקה, ה‑819 אזהרות, ו‑14 השיחות — כולם "עבדו" בשקט.
