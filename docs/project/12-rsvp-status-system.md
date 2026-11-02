# 12 — מערכת הסטטוסים של אישורי ההגעה

מסמך עיון: מה כל סטטוס של אורח ואיש קשר אומר, מי קובע כל ערך, מי קורא אותו ומה מחליטים לפיו. המטרה היא תמונה מדויקת של המצב הקיים לפני שמשנים בו משהו. המסמך מתאר, ואינו מציע פתרונות.

נכון ל‑2026‑11‑01. הופק מקריאת הקוד בענף `main`, ממעקב קריאות ב‑LSP, ומהגדרות הפונקציות במסד החי (`pg_get_functiondef`). מספרי השורות נכונים לתאריך הזה; אם קוד זז, שם הפונקציה הוא העוגן. פרטים על אופן ההפקה בסעיף 9.

מסמכים משלימים: `05-guests-and-public-rsvp.md` (דף האישור הציבורי והטוקנים), `06-campaigns-and-outreach.md` (מנוע ה‑outreach), `07-messaging-channels.md` (ערוצי ההודעות). שימו לב: מסמכים 06 ו‑08 נכתבו ב‑2026‑07‑02 ועדיין מתארים מודל חיוב ובקרות הסכמה שהוסרו מאז.

## 1. התמונה הכללית

לאורח ולאיש הקשר שלו יש **ארבעה צירי סטטוס נפרדים**, וכל אחד מהם נכתב בידי רכיבים אחרים:

| ציר | איפה | מה הוא אומר |
|---|---|---|
| תשובת האורח | `guests.status` | מגיע, לא מגיע, אולי, או עוד לא ענה |
| מצב יצירת קשר | `guests.contact_status` | שדה שהלקוח ממלא בעצמו |
| מצב תפעולי | `contacts.op_status` | מה קרה בפנייה האחרונה: נשלח, חויג, הושג |
| מצב הפנייה בקמפיין | `outreach_state.status` | אם המנוע ממשיך לפנות לאיש הקשר הזה |

לצדם יש עובדה נוספת: `billed_results`, שורה אחת לכל איש קשר באירוע שמשמעותה "הושג". אין במערכת בקשת הסרה: פניות אישור הגעה אינן שיווק (החלטת הבעלים, 01.11.2026; מיגרציה `20261101220710`).

**אין קשר מובנה בין הצירים.** הנקודה החשובה ביותר: מנוע השליחה מחליט אם להמשיך לפנות לפי `billed_results` בלבד (`stepGate`, סעיף 7), ולא לפי התשובה של האורח. אישור בדף האישור לא כותב ל‑`billed_results`, ולכן אורח שאישר בקישור ממשיך לקבל הודעות ושיחות.

איש קשר (`contacts`) הוא טלפון אחד באירוע; כמה אורחים יכולים לחלוק אותו. התשובה נשמרת ברמת האורח, וה"הושג" ברמת איש הקשר.

## 2. מילון הצירים

### 2.1 `guests.status` — תשובת האורח

enum `guest_status`. ברירת מחדל: `pending`.

| ערך | מי קובע |
|---|---|
| `pending` | ברירת המחדל של העמודה; עריכה של הלקוח (`updateGuest`, `src/lib/data/guests.ts:562`) |
| `attending` / `declined` / `maybe` | `submit_rsvp` במסד (ארבעת הערוצים בסעיף 6); עריכה של הלקוח, ישירות לטבלה |

`submit_rsvp` מקבל רק `attending`, `declined` או `maybe`, ולכן תשובה לא יכולה להחזיר אורח ל‑`pending`. רק עריכה של הלקוח יכולה.

מי קורא:

| קורא | מה הוא עושה | מיקום |
|---|---|---|
| שליחת הודעת תודה | שולח רק לאנשי קשר של אורחים `attending` | `sendCampaignWhatsApp`, `src/lib/data/outreach.ts:311` |
| ספירות | `guest_totals` במסד, דרך `getGuestTotals` | `src/lib/data/guests.ts:721`; משמש את עמוד האורחים ואת `event-stats.ts:182` |
| רשימת "מי מגיע" הציבורית | `attending` וגם `show_in_guest_list` | `get_event_attendees_public`, דרך `src/lib/data/rsvp.ts:147` |
| עמוד האורחים | סינון ותגית | `listGuests`, `guests.ts:299`; `guests/page.tsx:162` |
| סוכן הבעלים | ספירה לכל ערך | `src/lib/owner-agent/cores/rsvp.ts:103` |

מנוע השליחה לא קורא את הציר הזה.

### 2.2 `guests.contact_status` — מצב יצירת קשר

enum `contact_status`: `not_contacted`, `contacted`, `responded`, `wrong_number`, `unclear`, `unavailable`, `callback`. ברירת מחדל: `not_contacted`.

| ערך | מי קובע |
|---|---|
| `responded` | `submit_rsvp`, אוטומטית בכל תשובה שנרשמת |
| כל אחד משבעת הערכים | הלקוח: טופס האורח (`updateGuest`) ותא בטבלה (`updateContactStatus`, `guests.ts:653`, נקרא מ‑`guests-actions.ts:180`) |

מי קורא: רק המסך — סינון ותא בעמוד האורחים (`guests.ts:302`, `contact-status-cell.tsx`). אף החלטה במערכת לא נשענת עליו.

### 2.3 `contacts.op_status` — מצב תפעולי

enum `contact_op_status`, 8 ערכים (שבעה ערכים שאף אחד לא כתב הוסרו במיגרציה `20261101234811`). ברירת מחדל: `pending_contact`. כל הכתיבות עוברות דרך `setContactOpStatus` (`src/lib/data/interactions.ts:157`).

| ערך | מי קובע | מיקום |
|---|---|---|
| `pending_contact` | ברירת המחדל של העמודה | — |
| `whatsapp_sent` | שליחת שלב וואטסאפ שהתקבלה אצל Meta | `prepareAndSendStep`, `outreach-engine.ts:668` |
| `pending_call` | שלב שיחה שהועבר לחייגן | `prepareAndSendStep`, `outreach-engine.ts:690` |
| `call_dialed` | החיוג התחיל | `finishDialed`, `outreach-calls.ts:144` |
| `no_answer` | תוצאת שיחה `no_answer` או `no_response` | `processCallResult`, `call-result-processing.ts:188` (המיפוי `opFor`, `:165`) |
| `human_interaction_call` | שיחה שהיה בה אדם | `processCallResult`, `call-result-processing.ts:64` |
| `wrong_number` | Meta החזירה קוד 131026 | `processStatus`, `webhook-processing.ts:549` (`WRONG_NUMBER_CODES`, `:99`) |
| `reached_billed` | נרשם "הושג" | `recordReached`, `billing.ts:47` |

מי קורא: התגיות בעמוד האורחים ובעמוד אורח בודד (`guests/labels.ts`, `guests/page.tsx:61`, `guests/[guestId]/page.tsx:115`), וסטטיסטיקת המסירה של הקמפיין (`campaign-delivery.ts`). מנוע השליחה לא קורא את הציר הזה.

### 2.4 `outreach_state.status` — מצב הפנייה בקמפיין

עמודת `text` בלי אילוץ ערכים. שורה אחת לכל זוג קמפיין‑איש קשר. ברירת מחדל: `active`.

| ערך | מי קובע | מיקום |
|---|---|---|
| `active` | יצירת השורה | `seedOutreachState`, `outreach-engine.ts:97` |
| `reached` | "הושג" בשיחה; ה‑worker כשהשער מחזיר `reached` | `writeReach`, `outreach-engine.ts:467`, `:479`; `worker/main.ts:421`, `:441` |
| `stopped` | הקמפיין או האירוע נסגרו | `worker/main.ts:417`, `:437` |
| `exhausted` | אין יותר שלבים בתזמון | `ensureCurrentStep`, `outreach-engine.ts:717`, `:767`; `worker/main.ts:454` |

`stop_reason` נכתב לצד הסטטוס (`setOutreachStatus`; `resolve_outreach_step` במסד).

## 3. עובדות נוספות

**`billed_results` — "הושג".** מפתח ייחודי `(event_id, contact_id)`: איש קשר מושג פעם אחת לאירוע, בכל הערוצים יחד. נכתב רק דרך `try_record_billed_result` במסד, שנקרא מ‑`recordReached` (`billing.ts:33`), בשני מקרים:

- תשובה נכנסת בוואטסאפ (`processMessage`, `webhook-processing.ts:442`);
- שיחה שהיה בה אדם (`writeReach`, נקרא מ‑`call-result-processing.ts:112`).

`try_record_billed_result` מסרב כשהקמפיין לא פעיל או מחוץ לחלון, כשיום האירוע עבר, כשהאירוע לא פעיל, וכשאיש הקשר לא ברשימה המורשית (או, כש‑`billing_exposure_gate` דולק, לא נחשף). **אישור בדף האישור לא קורא לו.**

מי קורא: `isContactReached` (`outreach-engine.ts:183`), שמזין את `stepGate`; `pruneOrphanContact` (`contacts.ts:162`).

## 4. מספר המגיעים

שלושה שדות מחזיקים את המספר:

| שדה | מי כותב |
|---|---|
| `confirmed_adults`, `confirmed_kids` | `submit_rsvp`. וואטסאפ ושיחה עם הקשה שולחים 1+0; דף האישור והסוכן שולחים את המספרים האמיתיים |
| `confirmed_headcount` | `handleHeadcountReply` (`headcount.ts:133`); דף האישור, בכתיבה נפרדת אחרי `submit_rsvp` (`r/[token]/actions.ts:104`), עם תקרה של 10 |
| `expected_count` | הלקוח (כמה הוזמנו) |

`submit_rsvp` מאפס בכל תשובה חדשה את `confirmed_headcount`, `headcount_requested_at`, `headcount_answered_at` ו‑`headcount_attempts`.

**"המספר האפקטיבי" מחושב בשני מקומות:**

| מקום | הכלל |
|---|---|
| במסד: `guest_effective_attending` (משמש את `guest_totals`) | אם `attending`: `confirmed_headcount` אם הוא בין 1 ל‑10; אחרת מבוגרים+ילדים אם יותר מ‑0; אחרת `expected_count`; אחרת 1 |
| בקוד: `actualConfirmedCount` (`guests/page.tsx:86`, שורת האורח) | אותו הסדר, אבל בלי `expected_count` ובלי 1: אם אין כמויות, מחזיר "אין" |

**שאלת "כמה תגיעו" בוואטסאפ** (`src/lib/data/headcount.ts`):

- `requestHeadcount` (`:46`) שולח את השאלה ורושם `headcount_requested_at` ו‑`headcount_attempts` (`:69`). נקרא אחרי לחיצה על "מגיע", רק בעיבוד הראשון של ההודעה.
- `handleHeadcountReply` (`:79`) קורא מספר מטקסט חופשי. "0" שואל שוב עד `HEADCOUNT_MAX_ATTEMPTS`; מספר נשמר ב‑`confirmed_headcount` וב‑`confirmed_adults` (`:123`, `:133`).

שתי הפונקציות נקראות רק מעיבוד וואטסאפ נכנס (`webhook-processing.ts:502`, `:513`).

## 5. היסטוריה

| מה | מתי נכתב |
|---|---|
| `rsvp_responses` | שורה לכל תשובה שעוברת ב‑`submit_rsvp` ושונה מהקודמת. עריכה של הלקוח לא נרשמת כאן |
| `activity_log` `rsvp.from_whatsapp` | לחיצה בוואטסאפ ששינתה את התשובה (`recordRsvpFromWhatsapp`, `interactions.ts:206`) |
| `activity_log` `guest.updated` / `guest.contact_status_updated` | עריכה של הלקוח (`guests.ts`) |
| `activity_log` `outreach.step_resolved` | כל שלב שהמנוע סגר (`resolve_outreach_step`) |

## 6. הזרימה בכל ערוץ

### 6.1 דף האישור — `src/app/(public)/r/[token]/actions.ts`

1. הגבלת קצב לפי טביעת הטוקן וה‑IP.
2. בדיקת הקלט ב‑Zod.
3. `submit_rsvp` עם כל הפרטים: סטטוס, מבוגרים, ילדים, תפריט, הערה, תשובות לשאלות, הופעה ברשימה (`:94`).
4. אם `attending`: כתיבה נפרדת של `confirmed_headcount` ו‑`headcount_answered_at` (`:104`). שגיאה כאן נבלעת.

לא נרשם "הושג".

### 6.2 תשובה נכנסת בוואטסאפ — `processMessage`, `src/lib/data/webhook-processing.ts:348`

עובר ב‑worker, אחרי שה‑webhook נשמר ב‑`webhook_inbox` (`handleWebhook`, `worker/main.ts:568`).

1. סיווג ההודעה (`:415`); הודעה לא רלוונטית לחיוב יוצאת כאן.
2. איתור איש הקשר לפי ההודעה שעליה ענו, או לפי הטלפון.
3. שורת אינטראקציה, שמחזירה `fresh` — האם זה העיבוד הראשון (`:429`).
4. רישום "הושג" (`:442`).
5. אם זו לחיצה על כפתור תשובה ויש בדיוק אורח אחד מאחורי איש הקשר: `submit_rsvp` עם 1+0 (`:490`); אם התשובה השתנתה, `rsvp.from_whatsapp` (`:496`).
6. אם `fresh` והתשובה `attending`: `requestHeadcount` (`:502`).
7. אם זה טקסט חופשי ו‑`fresh`: `handleHeadcountReply` (`:513`).

### 6.3 סטטוס מסירה מ‑Meta — `processStatus`, `webhook-processing.ts:522`

עדכון סטטוס המסירה של ההודעה. בקוד 131026: `op_status = wrong_number`.

### 6.4 שיחה עם הקשת מקשים — `processCallResult`, `src/lib/data/call-result-processing.ts:38`

מגיע דרך `webhook_inbox` (`processWebhookEvent`, `webhook-processing.ts:182`).

1. רישום תוצאת השיחה ו‑`op_status` (`:64`, `:188`).
2. שיחה שהיה בה אדם: `writeReach`, כלומר "הושג" ו‑`outreach_state = reached` (`:112`).
3. הקשה 1 או 2: `submit_rsvp` עם `attending` + 1+0 או `declined` (`:146`).

### 6.5 סוכן AI בשיחה — `processCallRsvp`, `call-result-processing.ts:221`

נקרא מ‑`src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts:116`, ובניסיון חוזר מהתור דרך `processCallRsvpRow` (`:347`). `submit_rsvp` עם הסטטוס, המבוגרים והילדים שהסוכן אסף (`:257`).

### 6.6 עריכה של הלקוח — `updateGuest`, `src/lib/data/guests.ts:549`

נקרא מ‑`guests-actions.ts:126`. כותב `status` ו‑`contact_status` ישירות לטבלה, בלי `submit_rsvp`: אין שורה ב‑`rsvp_responses` ואין איפוס של שדות מספר המגיעים. נרשם `guest.updated`.

### 6.7 ה‑worker, בכל שלב של קמפיין — `handleStep`, `worker/main.ts:404`

1. `stepGate` (`outreach-engine.ts:218`): קמפיין קיים ופעיל, החלון פתוח, יום האירוע לא עבר, האירוע פעיל, מתג השליחה הראשי דולק, ואין שורה ב‑`billed_results`.
2. `prepareAndSendStep` (`outreach-engine.ts:598`): אורח חי מאחורי איש הקשר, ואז שליחה או העברה לחייגן, ו‑`op_status`.
3. `resolveStep` (`outreach-engine.ts:537`): קידום השלב או סיום עם סיבה.

## 7. מי מחליט לפי מה

| החלטה | לפי מה | מיקום |
|---|---|---|
| להמשיך לשלוח ולחייג לאיש הקשר | `billed_results` בלבד (בנוסף למצב הקמפיין, האירוע והמתג) | `stepGate` → `isContactReached`, `outreach-engine.ts:218`, `:183` |
| לשלוח הודעת תודה | `guests.status = 'attending'` | `outreach.ts:311` |
| לספור מגיעים | `guests.status` ו‑`guest_effective_attending` | `guest_totals` |
| להציג ברשימה הציבורית | `attending` ו‑`show_in_guest_list` | `get_event_attendees_public` |
| למחוק איש קשר יתום | אם יש שורה ב‑`billed_results` | `pruneOrphanContact`, `contacts.ts:162` |
| לשאול "כמה תגיעו" | לחיצה על "מגיע", רק בעיבוד הראשון | `webhook-processing.ts:502` |

## 8. פערים ידועים

מתועדים כאן כפי שהם, בלי פתרון:

1. **אורח שענה ממשיך לקבל פניות.** העצירה תלויה ב‑`billed_results`, ואישור בדף האישור לא כותב אליו.
2. **ערוץ אוטומטי מוחק פרטים.** וואטסאפ והקשה בשיחה שולחים 1+0, ו‑`submit_rsvp` כותב מחדש את כל השדות: תפריט, הערה, הופעה ברשימה וכמויות שמולאו בדף נמחקים. גם לחיצה ישנה שמעובדת מאוחר דורסת תשובה חדשה יותר.
3. **עריכה של הלקוח עוקפת את `submit_rsvp`:** אין היסטוריה ואין איפוס של מספר המגיעים.
4. **מספר המגיעים נכתב משלושה מקומות** (`submit_rsvp`, `headcount.ts`, דף האישור), והכתיבה של הדף נעשית אחרי ה‑RPC ולא באותה פעולה.
5. **הכלל של "המספר האפקטיבי" כתוב פעמיים, בשתי גרסאות שונות** (סעיף 4).
6. **`contact_status` משמש לשני דברים:** שדה ידני של הלקוח, ש‑`submit_rsvp` דורס ל‑`responded`.
7. **"כמה תגיעו":** לחיצה נוספת על "מגיע" שואלת שוב ומאפסת את מונה הניסיונות; תשובה נזרקת כש‑Meta לא החזירה תשובה ברורה על שליחת השאלה; אחרי קריסה של ה‑worker באמצע, השאלה או המספר הולכים לאיבוד. כל אחד מהם מתועד בבדיקה `it.fails` ב‑`headcount.local-it.test.ts` / `webhook-message.local-it.test.ts`.
8. **לחיצה שנעלמת:** כשבאירוע יש שאלה מותאמת חובה, לחיצה על "מגיע" בוואטסאפ נרשמת כ"הושג" אבל התשובה לא נשמרת (`webhook-message.local-it.test.ts`, בדיקת characterization).

## 9. איך המסמך הופק

- **מבנה המסד:** ערכי ה‑enum, ברירות המחדל, האילוצים והגדרות `submit_rsvp`, `try_record_billed_result`, `resolve_outreach_step`, `guest_totals` ו‑`guest_effective_attending` נקראו מהמסד החי ב‑2026‑11‑01.
- **מי קורא למי:** `incomingCalls` ו‑`findReferences` של LSP (typescript-language-server) על `submitRsvp`, `recordReached`, `setContactOpStatus`, `updateGuest`, `updateContactStatus`, `requestHeadcount`, `handleHeadcountReply`, `stepGate`, `resolveStep`, `writeReach`, `processCallResult`, `processCallRsvp`.
- **כתיבות לעמודות:** LSP לא רואה שמות עמודות שכתובים כמחרוזות של Supabase, ולכן הכתיבות ל‑`guests`, `contacts` ו‑`outreach_state` אותרו בחיפוש של `.from('<table>').update|insert|upsert`, וקריאות ה‑RPC בחיפוש של `rpc('<name>')`.
- **ערכים שאף אחד לא קובע:** חיפוש של כל ערך כמחרוזת בקוד ובגוף הפונקציות במסד.

כשהקוד משתנה, יש לבדוק מחדש את הסעיפים 2, 6 ו‑7 לפי שמות הפונקציות.
