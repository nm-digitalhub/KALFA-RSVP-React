# סגירת הקצוות הפתוחים — תוכנית מאומתת

> נכתב 16.08.2026. כל מספר כאן נמדד מול ה‑DB החי או מול הקוד, לא הוסק.
> תגיות: **[נמדד]** = הרצתי ואימתתי · **[הסקה]** = נגזר מקריאת קוד · **[לא נבדק]**

---

## A. 14 שיחות חוזרות שנעלמו — באג חי, לקוחות אמיתיים

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
| ריפוי | `callback-scheduling.ts:341` | `.gte('scheduled_at', now − 1 day)` — כולן ישנות מזה |

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

## B. שאריות EWS — ניקוי, לא תיקון

**[נמדד]** קיימים עדיין: `ews-impl.ts`, `xml-safe.ts` + מבחן, `category-list.ts`
+ מבחן, `crypto.ts` + מבחן. `package.json` מכיל 2 אזכורים ל‑`ews-javascript-api`.

**[נמדד]** `app_settings` מחזיקה `dkim_domain`, `dkim_selector`,
`dkim_private_key` — אף שורת קוד אינה קוראת אותן.

**החלטה: לא עכשיו, ובמכוון.** `EXCHANGE_PROVIDER=ews` הוא מתג החזרה לאחור,
ומחיקת המימוש מבטלת אותו. לחכות מספר ימים של יציבות מוכחת על Graph.

מה שכן אפשר מיד: `crypto.ts` מצפין סיסמאות תיבה, ואימות‑תעודה אינו קורא סיסמאות
כלל **[הסקה]** — אבל הוא עדיין בשימוש בנתיב ה‑EWS. נשאר.

---

## C. commit

**[נמדד]** 62 קבצים בעץ העבודה. עבודת לילה שלמה שאינה שמורה בשום מקום.

לפי כלל הפרויקט — תיקונים קטנים ל‑main, עבודה מהותית לענף. כאן יש שני גושים
נפרדים שראוי להם commit נפרד: המעבר ל‑M365/Resend, ועמוד ה‑FAQ.

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

## E. `topic` חופשי מול `console_queues` — כפילות אמיתית

### האבחון

**[נמדד]** שתי טקסונומיות לאותו מושג:

| `console_queues` — טבלה, עם עדיפות ושיוך סוכנים | `INQUIRY_TOPICS` — מחרוזת |
|---|---|
| `sales` · priority 10 | מכירות |
| `support` · priority 20 | תמיכה |
| `events` · priority 30 | — |
| `billing` · priority 40 | חיוב ותשלום |

**[נמדד]** 4 מ‑6 הפניות כבר תואמות תור **בשם מדויק**. שתיים לא — ואלה
בדיוק אלה שנוצרו ע"י קליטת הדואר עם `topic = 'פנייה בדואר'`, ערך שהמצאתי
ואינו תואם דבר.

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

## G2. שתי פניות הבדיקה — להשאיר, וזו הכרעה ולא עצלות

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

וב‑`runCallbackScheduleSweep`, מיד אחרי `const healed = await reconcile…`:

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

ובקריאת ה‑upsert, `topic: MAIL_TOPIC` נשאר כפי שהוא — הוא כבר nullable בסכמה.

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

`src/lib/data/admin/nav-counts.ts:36`:

```ts
    .in('status', ['new', 'reopened']);
```

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

## H1+H2+H4 · תבנית המייל — **בוצע ואומת**

`src/lib/email/templates.ts` · `templates.test.ts` — 16 בדיקות, כולן עוברות.

**קישורים.** תחביר `[טקסט](/נתיב)` הופך לעוגן. **נתיב בלבד, אף פעם לא URL מלא** —
סכימה אינה מתקבלת כלל, ולכן `javascript:`/`data:` אינם ניתנים לביטוי מלכתחילה,
ולא נחסמים ברשימה שחורה. `(?!\/)` דוחה `//host`. זו אותה מדיניות ש‑
`resolveInternalTarget` (`src/lib/url.ts`) אוכפת לקישורי האפליקציה.

**קישור > URL גולמי, והסיבה אינה אסתטית:** URL באותיות לטיניות בתוך פסקה עברית
נשבר ב‑bidi — סימני פיסוק קופצים לצד הלא נכון. עוגן בעברית מסלק את הבעיה.

**זרוע הטקסט חובה.** בלעדיה הלקוח מקבל `[הרשמה](/auth/signup)` — מקור markdown
בתיבה שלו. מומר ל‑`הרשמה: https://…`.

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

**התיקון:** פועל `faq` ב‑`scripts/fleet-agent-cli.ts`, במראה מדויקת ל‑
`business-facts` — read‑only, ללא PII, מחזיר את המפורסמים בלבד. זו אותה נקודה
שהוכחה ב‑H0 כמשפיעה בפועל.

```ts
// Stage-2 grounding, mirroring cmdBusinessFacts: the PUBLISHED public FAQ is
// the answer to "what does the package include" — already written, already
// reviewed, already live. Without this the drafter emits a placeholder while
// twelve approved answers sit one query away. Published rows only: a draft FAQ
// answer must never reach a customer through the side door.
async function cmdFaq(): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('faq_items')
    .select('question, answer')
    .eq('published', true)
    .not('answer', 'eq', '')      // ר' H5 — פריט מפורסם עם תשובה ריקה קיים בפועל
    .order('sort_order');
  if (error) fail(`faq read failed: ${error.message}`);
  console.log(JSON.stringify({ items: data ?? [] }, null, 2));
}
```

לרשום ב‑`case 'faq': return cmdFaq();` ובמחרוזת ה‑usage.

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

1. שורה 75 — `פתיח ניטרלי ("שלום, תודה שפנית אלינו")` → **להסיר**. התבנית כבר
   מרנדרת כותרת *"תודה שפנית אלינו"* וגם `שלום {שם},`. ההוראה הנוכחית **מייצרת**
   את הכפילות. הנחיה חלופית: *"פתח ישירות בעניין — המעטפת מוסיפה ברכה ופתיח."*
2. שורה 91 — `סיום מקצועי ("נשמח לעזור… — צוות KALFA")` → **להסיר** מאותה סיבה.
3. **להוסיף** תחת "מה לעשות בכל ריצה":
   > **קישורים:** כשיש צעד המשך, כתוב אותו כקישור בתחביר `[טקסט](/נתיב)` —
   > נתיב פנימי בלבד, לעולם לא כתובת מלאה. לדוגמה: `[פתיחת חשבון](/auth/signup)`,
   > `[שאלות נפוצות](/faq)`. אל תדביק URL גולמי: הוא נשבר ויזואלית בעברית.

**הערה:** התבנית מנקה ברכה וחתימה כפולות גם בלי ההוראות (הגנה בעומק), אבל
המקור צריך להיתקן — ניקוי בפלט אינו תחליף להוראה נכונה.

---

# חלק חמישי — הממשק. מה ש‑D שכח

> D תכנן את שכבת **הנתונים** לשרשור ולא שורה אחת על המסך. הממשק היום בנוי
> לפנייה→תגובה בלבד, ולכן **D3 כפי שנכתב גורם נזק**. הסעיף הזה מכריע את D מחדש.

## I0. האבחון — ארבעה שדות חד‑ערכיים

`/admin/contacts/page.tsx` מרנדר כל שדה **פעם אחת**:
`message` (57) · `draft_reply` (72/81) · `sent_reply` (59‑67) · `replied_at` (63).
`CONTACT_COLUMNS` (`admin/contacts.ts:42`) הוא select שטוח — וההערה שם קובעת
במפורש: *"The select string IS the contract"*.

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

## סדר סופי

| # | שלב | למה כאן |
|---|---|---|
| 1 | **C** commit | הזול ביותר, מונע את הנזק הגדול ביותר |
| 2 | **A1** 14 השיחות | באג חי, לקוחות אמיתיים ממתינים |
| 3 | **G1** ה‑topic שהמצאתי | זול, ועוצר הצטברות נתונים שגויים |
| 4 | ~~**H5** FAQ ריק~~ | **בוטל** — ממצא שגוי, ר' H5. אין פעולה |
| 5 | **A2** גלאי נטושות | כדי שזה לא יחזור בשקט |
| 6 | **H3** פועל `faq` | מסיר placeholder מכל תשובה עתידית |
| 7 | **H7** הוראות לסוכן | owner דרך `!`; בלעדיו H1/H2/H4 אינם משנים התנהגות |
| 8 | **D1** כותרות שרשור | תנאי מוקדם לכל השאר, ועצמאי מהשאר |
| 9 | **I5–I7** טבלת שרשור + מיון + תווית | **חייב לקדום ל‑D3** — ר' למטה |
| 10 | **I8–I10** תצוגת שרשור + שער הטיוטה | בלעדיהם D3 תוקע בשקט (I2) |
| 11 | **D2+D3** זיהוי תגובה + סטטוס | רק עכשיו יש לאן לכתוב ומה להציג |
| 12 | **E** תורים | ערך גבוה, תשתית בנויה |
| 13 | **F** דחיפות | דורש את E |
| 14 | **G2** ניקוי חותמות | קוסמטי |
| 15 | **B + G3** ניקוי EWS | רק אחרי ימי יציבות על Graph |

**שינוי סדר מהותי מול הגרסה הקודמת.** D2+D3 היו במקום 6 ולפני הממשק. המדידות
ב‑I הראו ש‑D3 בסדר ההוא **מוחק היסטוריה** (I1) ו**תוקע בשקט** (I2). שכבת
השרשור והממשק שלה הן כעת **תנאי מוקדם ל‑D3**, לא המשך לו.

**בוצע כבר:** H1 · H2 · H4 · H6 — קוד + 16 בדיקות, `tsc`/lint/טסטים ירוקים.

**החלטות פתוחות לבעלים:** E (טופס מול תורים) · H7 (עריכת קובץ הרול דרך `!`).
