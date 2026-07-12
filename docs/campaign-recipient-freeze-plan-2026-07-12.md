# תוכנית: קהל דינמי בתוך תקרה מאושרת (במקום רשימת נמענים קפואה)

תאריך: 2026-07-12 · סינתזה של 4 יועצים (רווח/יחידות, תשלומים/סיכון/רגולציה, מוצר/UX/אמון, שלמות-נתונים/אופס)
מקור טכני: [חקירה 2026-07-09](./campaign-recipient-freeze-investigation-2026-07-09.md) · משימה: [P0 task](./campaign-recipient-freeze-P0-task-2026-07-12.md)

## המסקנה בשורה אחת

**להקפיא את הכסף, לא את הרשימה.** התקרה + ה-J5 hold הם ההתחייבות הכספית וגבול
ההרשאה החוקי — נשארים קפואים. **רשימת הנמענים** צריכה לנשום עם רשימת האורחים החיה,
בתוך התקרה. הקפאת הרשימה היא החלק ההפסדי והשבור; הקפאת התקרה היא החלק המגן והחוקי.
עצם ה"הקפאה" כשלעצמה אינה שגויה — מה ששגוי הוא **מה** הוקפא.

## התיקון החשוב לאינטואיציה "הקפאה = הפסד"

- נכון לגבי **הרשימה**: בתוך התקרה, השמטת אורח שנוסף מאוחר = הפסד הכנסה ישיר
  (חיוב per-reached → כל אורח שמושג = ₪4) + פגיעת אמון (הלקוח שילם, האורח לא קיבל).
- שגוי לגבי **התקרה**: חיוב מעל ה-hold = חריגה מהרשאת האשראי → סיכון chargeback +
  חוק הגנת הצרכן. זה מה שההקפאה **צריכה** להגן עליו.
- **סייג מספרי לקמפיין הנוכחי:** ה-17 מקומות הלא-מושגים (₪68) **אינם קיבולת פנויה** —
  הם מוזמנים מורשים שעוד עשויים להשיב. `slack = floor(hold/price) − |set| = 38 − 38 = 0`.
  לכן: **תיקון טלפון של אורח קיים = חינם רק *לפני* exposure** (החלפה A→B, הגודל קבוע);
  **אורח חדש לגמרי מעבר ל-38 = דורש top-up** ל-hold (re-auth ב-SUMIT), אף פעם לא בשקט.
- **⚠️ תיקון מחייב (2026-07-12):** "תיקון טלפון = חינם" **נכון רק לפני exposure של A**.
  אחרי ש-A נחשף בכל צורה (ראה P0-1) זהו **replacement event**, לא swap — A נעוץ ו-B הוא
  recipient חדש הכפוף ל-`funded_cap`/top-up. הקריטריון לשחרור A הוא **exposure, לא billed_result**.

## מודל מוצע (2026-07-12): minimum + authorized ceiling + recipient ledger

> **⚠️ שינוי מודל חיוב מפורש.** זה חורג מ-`campaign-rework-constraint` ("שמר J5/per-reached/ceiling,
> אל תשנה תנאי חיוב") — **בכוונה**, כהחלטה אסטרטגית של הבעלים. דורש עדכון להסכם החתום + גילוי §14ג
> (המינימום חייב להיות מגולה ומאושר מראש). לא לממש לפני sign-off עסקי.

**הרעיון:** במקום להקפיא כמות contacts ברגע J5, מקפיאים **מסגרת כספית** (מינימום + תקרה),
ומשאירים את רשימת הנמענים **חיה עד סגירת האירוע**. השאלה עוברת מ"כמה contacts היו בהקפאה?"
ל"כמה recipients קיבלו outcome תקף עד הסגירה?".

**הנוסחה (גרסה ב׳ — מומלצת):**
```
final_charge = min(authorized_ceiling, max(minimum_charge, reached_count × price))
funded_cap   = floor(authorized_ceiling / price)      -- נגזר מכסף, לא ממספר contacts ב-J5
```
דוגמה (price ₪4, min ₪200, ceiling ₪400): reached×4=₪148→גובים ₪200 · =₪276→₪276 ·
=₪460→עד ₪400 + השאר דורש הרחבה. `funded_cap = floor(400/4) = 100 recipients`.

**גרסה א׳ (מינימום בלבד, ללא תקרה) נדחית** — reached שמעל ההרשאה יוצר חוב/dispute/גבייה ידנית.

**מה משתנה מבנית:**
- `max_contacts` מפסיק להיות "contacts ב-J5" → הופך ל-`funded_cap` נגזר-כסף.
- `campaign_authorized_contacts` מפסיק להיות **האמת העסקית של מי-ניתן-לחייב** → לכל היותר
  **תור eligibility זמני**. האמת העסקית = **recipient/exposure ledger** (מי קיבל outcome תקף).
- אורח שנוסף אחרי פרסום → נכנס אוטומטית לשליחה כל עוד `projected_charge ≤ ceiling`; נספר לחיוב
  רק אם reached. פותר את האורח שהושמט בלי snapshot/re-snapshot.

**תנאים קריטיים (אחרת חוזרים לבעיית ההרשאה):**
1. **ה-J5 hold בגובה `authorized_ceiling`, לא `minimum_charge`.** המינימום = רצפת חיוב; התקרה =
   תקרת ההרשאה. אחרת `reached×price` יכול לעבור את ה-hold.
2. **תוקף ה-hold מול capture-at-close.** הרשאות J5 ב-SUMIT פגות (`auth_expires_at`); אם התפיסה
   24ש+ אחרי האירוע — לוודא שה-hold בתוקף בזמן ה-capture, אחרת re-auth. הסיכון התפעולי החדש.
3. **exposure ledger עדיין נדרש** — המינימום פותר "כמה הובטח", לא "מי קיבל שירות". כלל
   exposed-or-billed (P0-1) נשאר במלואו.
4. **מינימום מגולה + מאושר (§14ג)** — floor fee חייב הסכמה מפורשת בהסכם.

**מפה מתוקנת תחת המודל הזה:**
- **P0-1 (correctness):** עצירת באג orphan/repoint — **לא לחייב contact ללא ראיית exposure תקפה**,
  לא להסתמך רק על `campaign_authorized_contacts`. (כלל exposed-or-billed להלן — ללא שינוי.)
- **P0-2 (שקיפות):** UI = סה״כ אורחים / recipients שנשלחו / reached / **חיוב צפוי / מינימום / תקרה**.
- **P1:** מעבר מ-frozen authorized set → **dynamic recipient ledger** (הרשימה חיה, cap ב-`funded_cap`).
- **P2:** top-up אוטומטי/ידני בקרבה לתקרה + capture-at-close (24ש) + טיפול בתוקף hold.

## דירוג הבעיות (לפי חומרה פיננסית+חוקית)

1. **P0 קריטי — repoint/מחיקת טלפון משאיר contact ישן/מחוק בסט → חיוב על מספר שגוי.**
   חריגה מהרשאה + חיוב על שירות שלא ניתן + `evidence` מצביע על מספר מחוק → **מפסידים
   כל chargeback** ואין הגנה ל-audit. landmine חוקי פעיל. (יועץ התשלומים דירג #1.)
2. **P0 — אורח/טלפון שנוסף אחרי ההקפאה מושמט בשקט.** הפסד הכנסה + אמון, אבל אין
   חיוב-יתר → לא הפרה רגולטורית. (הבעיה שהציף האירוע האמיתי — האורח שהושמט.)

## התוכנית (לפי סדר ביצוע)

### P0-1 — ריצוי הסט (correctness, השבוע, תנאי-סף) 🔴

> ## ⛔ BLOCKER מחייב לפני כל קוד של P0-1
>
> **אין ליישם את ה-RPC לפי כלל `billed-only`.** הכלל הקודם ("הסר את A אם אין לו עדיין
> שורת `billed_results`") **שגוי ומסוכן**: billing/webhooks/provider-callbacks יכולים
> להגיע **באיחור**, ולכן היעדר `billed_result` **אינו מוכיח** שהמספר הישן A לא קיבל שירות
> או שלא יוליד חיוב לגיטימי. `billed_result` הוא **מאוחר מדי** כקריטריון יחיד.
>
> **הקריטריון הנכון הוא `exposure`, לא `billed`.** הכלל: **exposed-or-billed pinned,
> NOT billed-only pinned.**
>
> טרם כתיבת ה-RPC — עדכן את ה-spec לכלל exposure להלן. אין refactor רחב, אין שינוי
> billing policy, אין dynamic admission מלא. רק spec מתוקן שמונע: (1) חיוב על contact
> יתום/שגוי, (2) מחיקת recipient שכבר קיבל exposure, (3) הכנסת B מעבר ל-`funded_cap` ללא top-up.

**הגדרת `exposed(A)`** — TRUE אם ל-A יש **כל** אחד מאלה (לכל האירוע, לא רק לצעד הנוכחי):
- outbound `contact_interaction` (ניסיון שליחה כלשהו)
- provider attempt / `provider_ref` / `provider_id` / עדות ל-queued/dispatched send
- call request (`call_request_count > 0` / `callback_requested`)
- inbound RSVP / reply / interaction (`direction='in'`)
- reached evidence (`op_status='reached_billed'` / `outreach_state.reached_at`)
- `billed_result`

`funded_cap = min(max_contacts, floor(hold/price))` — **לא** `max_contacts` לבדו (אם ה-hold
הונמך, `covered < full` וההסתמכות על max_contacts תדליף כסף).

RPC `reconcile_authorized_set` שרץ **תחת אותו `campaigns ... FOR UPDATE`** שה-billing RPC
לוקח (סריאליזציה של add/remove/bill לכל קמפיין), נקרא מ-`linkGuestContact`/`deleteGuest`:

- **add:** הכנס רק אם `|S| < funded_cap`; דלג על `removal_requested`; idempotent על dup.
- **repoint A→B:**
  - אם `NOT exposed(A)` → **swap חינמי**: הסר A, הוסף B, הגודל קבוע.
  - אם `exposed(A)` → **replacement event, לא swap**:
    - A **נעוץ** — נשמר כ-recipient היסטורי/מסחרי (לא נמחק מהמשמעות המסחרית שלו).
    - A **לא יקבל שליחות עתידיות** אם אין guest חי שמצביע אליו (send-gate + היעדר קישור).
    - A **לא יחויב שוב**; חיוב עתידי שיגיע מ-callback מאוחר על A נשאר לגיטימי ומגובה-audit.
    - B הוא **recipient חדש** — נכנס **רק** אם יש capacity בתוך `funded_cap`, אחרת אחרי top-up מפורש.
- **delete:** אם ל-contact אין exposure ואינו מקושר לאף guest חי → הסר מהסט. אם `exposed`/billed → **נעוץ**.
- **cap קשיח:** כל add/repoint-in נחסם ב-`|S| ≤ funded_cap`. הסרה חופשית פרט לנעיצת exposed/billed.

**audit מינימלי — עולה ל-P0-1 (לא P2).** נדרש להגנת chargeback, מניעת race, והוכחה **למה A
נשמר/שוחרר**. append-only, שורה לכל שינוי סט: `campaign_id, contact_id, action∈{in,out,kept_exposed},
reason∈{add,repoint,delete}, prev_contact_id, actor, at, resulting_size`. בלי זה אי-אפשר להוכיח
בדיעבד למה contact נעוץ נשאר בסט — ולכן זה חלק מ-P0-1/P0-B, לא חיזוק עתידי.

### P0-2 — נראות במקום שקט (השבוע) 🟠
- **באנר "רשימה נעולה"** במסך המוזמנים כשקיים קמפיין OPERATIONAL:
  > הקמפיין פעיל. אורחים או טלפונים שנוספו/תוקנו מעכשיו **לא ייכללו בשליחה הנוכחית** עד עדכון הרשימה. [רענן רשימת נמענים]
- **מונה פער** — הצג 4 מספרים נפרדים (היום מבולבלים, ולכן הכשל בלתי-נראה):
  `סה״כ אורחים · ייכללו בשליחה (סט מורשה) · כבר נוצר קשר · תקרה`. פער בין הראשונים = אזור אזהרה.
  **(זה גם התיקון הנכון ל"פער" במסך הסטטיסטיקות — במקום כיתוב, הפרדה ויזואלית של 4 המספרים.)**
- אופציונלי: פעולת **"רענן רשימת נמענים"** ידנית שעושה re-snapshot בתוך התקרה — נותן ללקוח לתקן היום.

### P1 — דינמי בתוך תקרה (התיקון האמיתי) 🟡
adds/fixes/deletes עוקבים אחרי רשימת האורחים החיה אוטומטית, cap ב-`funded_cap`, שמירת
`reached ⊆ set ≤ funded_cap`. add מעבר ל-cap → **זרימת top-up** מפורשת:
> נוספו {N} אורחים מעבר לתכנית שאישרת. כדי שגם הם יקבלו הזמנה, צריך לאשר הרחבה של {N} אנשי קשר ({N}×₪4 = ₪{sum}). החיוב רק על מי שבאמת נוצר איתו קשר. [אשר הרחבה] [לא עכשיו]

### P2 — observability מורחב 🟢
ה-audit המינימלי כבר ב-P0-1 (append-only על שינויי הסט — נדרש להגנת chargeback + הוכחת נעיצה).
P2 = הרחבה: משחזר-סט בזמן (point-in-time), correlation ל-`billed_results`, ופאנל 4-המספרים
המלא במסך הסטטיסטיקות (P0-2 כבר מתחיל אותו).

## אינווריאנטים בל-יעברו (לפני כל shipping של דינמי)

1. `reached ⊆ set ≤ funded_cap = min(max_contacts, floor(hold/price))` — ה-cap הוא **הכמות
   הממומנת**, לא max_contacts.
2. כל שינוי סט תחת `campaigns FOR UPDATE` (סריאליזציה עם billing) — סוגר את מרוץ החיוב-על-מספר-שגוי.
3. חברי **exposed-or-billed נעוצים** — לעולם לא מוסרים מהסט (העבר בלתי-משתנה). `billed_result`
   לבדו הוא קריטריון מאוחר מדי (callbacks מאחרים); הקריטריון הוא **exposure** (ראה P0-1).
4. top-up = **תנאי-סף** לפני seed/send/bill, לא מעקב-אחרי. decline → האורח נשאר בחוץ.
5. audit על כל כניסה/יציאה.
6. send-gate (`prepareAndSendStep`) בודק חברות בסט מחדש (fail-closed) — הסרה תוך-כדי עוצרת שליחה.
7. התקרה/hold נשארים קפואים; רק הסט גמיש, ורק בתוך `funded_cap`. הגדלת התקרה = הרשאה חדשה, לעולם לא בשקט.

## למה הסדר הזה

P0-1 חייב לקדום ל-P1: פתיחת הסט לדינמיות **על גבי** באג ה-repoint רק מגדילה את שטח
הפגיעה של החיוב-על-מספר-שגוי. correctness → נראות (השבוע) → דינמי+top-up (התיקון המלא).
