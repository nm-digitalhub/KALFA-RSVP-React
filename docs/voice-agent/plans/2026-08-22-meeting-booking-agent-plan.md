# תוכנית: סוכן קולי לתיאום/אישור פגישות (Meeting-Booking Agent)

**סטטוס:** טיוטת תכנון בלבד — אין קוד, אין שינויי קונפיג, אין פריסה. ממתין לאישור בעלים על תרשים המצבים (סעיף 3) + סקירות (סעיף 12) + תיאום עם שני סוכני התכנון המקבילים (inbound-answering, sales-closing).

**עדכון 2026-08-22 — החלטת בעלים:** אופציה **(ב)** אושרה כ-scope הבסיס (שיחת אישור/הזזה יוצאת לסלוט קיים בלבד). אופציה (א) (חזית קולית לטריאז' על כל ליד טרי) נשארת מתועדת כהרחבת Phase 2, לא בהיקף הנוכחי. **בנוסף, הבעלים הוסיף דרישה חדשה: כיוון נכנס (inbound)** — כשלקוח **מתקשר** לקלפה (לא הסוכן מתקשר החוצה) ומזוהה כמי שיש לו כבר שורת `callback_requests` עם `scheduled_at` עתידי, הסוכן שעונה לו צריך לספר לו על הפגישה הקיימת ולתת לו להזיז אותה בשיחה עצמה. **זה לא סוכן/מנגנון שלישי נפרד** — זה sub-flow בתוך ה-inbound-answering agent (סוכן מקביל, `planner-inbound-agent`), שמשתמש **באותו חוזה reschedule** שסעיף 4 כאן כבר מגדיר. ראו סעיף 4א (חדש) וסעיף 10 המעודכן.

---

## 0. מה קיים היום — התשתית האמיתית (נקרא קוד, לא הונח)

`callback_requests` הוא תור הלידים/פניות **של קלפה עצמה** (טופס "התקשרו אליי" ב-`/contact`), **לא** לוח זמנים של אורחי אירוע. כל שיחה שתתוכנן כאן היא בין ליד/לקוח לבין בעל/ת קלפה (מכירות/תמיכה/חיוב), לא בין אורח לאירוע.

מה שכבר בנוי ועובד, ללא שום קול:

1. **`src/app/(customer)/app/contact` (טופס ציבורי) → `createCallbackRequest`** (`src/lib/data/inquiries.ts:112`) — יוצר שורה עם `topic`, `note` חופשי, ו-`requested_at`/`requested_rank` שמקורם ברשימה סגורה (`asap`/`morning`/`afternoon`/`evening`/`exact`), לא טקסט חופשי.
2. **טריאז' (`claim_callback_triage()`, מיגרציית `20260728155249`)** — שלב async (לא נקרא כאן קוד המימוש, רק ה-RPC והעמודות) שקורא את `note` החופשי ומפיק `not_before_min`/`not_after_min`/`excluded_dates` — בדיוק הצורה של `CallerConstraints` ב-`schedule-policy.ts`.
3. **`findCallbackSlot` (`src/lib/callbacks/schedule-policy.ts`)** — מנוע חיפוש סלוט אמיתי: משלב שעות עבודה (`DEFAULT_CALLBACK_POLICY`: א׳–ה׳ 09:00–18:00, ו׳ 09:00–13:00, שבת סגור, נוטיס מינימלי שעתיים, אופק 14 יום, משך 15 דקות, תקרה 8/יום), לוח שבת/חג (`buildJewishCalendar`), ומגבלות המתקשר — **תמיד בחיתוך, לעולם לא באיחוד**: "caller constraints can only ever narrow the search."
4. **`scheduleCallbackAppointment` (`src/lib/data/callback-scheduling.ts`)** — קורא ל-Exchange/Graph (`calendarProvider`, חיבור עסקי יחיד מאומת — `loadBusinessConnection` **מסרב** אם יש יותר מחיבור מאומת אחד), בונה `AppointmentDraft` דרך `buildCallbackDraft`/`buildCallbackBody` — **כל שדה בגוף האירוע מורכב מעמודות DB, אף פעם לא ממחרוזת שסיפק מודל או מתקשר** (owner ruling 27.07 23:44, "The deterministic-gateway rule").
5. **`rescheduleCallbackRequest(id, exactIso)`** — הנתיב הקיים היחיד לשינוי מועד: סוגר את הפגישה הקיימת (מארכב, לא מוחק), כותב `requested_at=exactIso, requested_rank='nearest'`, וה-sweep הבא מריץ שוב את `findCallbackSlot` סביב הזמן הזה. **נכשל בכוונה** (`old_appointment_not_removed`) אם הפגישה הישנה לא הצליחה להתארכב — כדי לא ליצור פגישה כפולה בסיבוב הבא.
6. **`applyCallOutcome`** — מכונת המצבים היחידה שמחליטה מה קורה אחרי שיחה אמיתית: `no_answer` (סטריק, סגירה אוטומטית ל-`no_contact` + SMS חד-פעמי אחרי 3 רצופות), `needs_followup` (חוזר לתור), `completed`/`closed` (סופי). כל כתיבה אחרת ל-`call_outcome`/`status` **חייבת** לעבור דרך הפונקציה הזו — לא לכתוב ישירות לעמודות.
7. **הכל היום ידני בצד החיוג בפועל**: תזכורת ביומן Outlook → בעל/ת קלפה לוחצ/ת על `tel:` ומחייגת בעצמה (`/admin/callbacks/[id]/page.tsx`). **אין שום מגע קולי עם הליד עד לרגע הזה.** התוצאה מוזנת ידנית ב-`CallOutcomeForm`.
8. **גשר הקול הקיים (RSVPAgent)** בנוי סביב `call_attempts` (אורח+אירוע), טוקן חד-פעמי ב-`/api/voximplant/ctx/[token]` ו-`/api/voximplant/cb/[token]`, עם `strictObject` שמסרב לכל שדה זר, ותור `webhook_inbox` שמזין drain שכותב RSVP+חיוב. **אין שום מסלול מקביל ל-`callback_requests`.**

---

## 1. Scope, non-goals, ושאלת ה-scope הפתוחה

### מה כן

סוכן קולי **יוצא** (outbound) שמבצע **שיחת אישור/תיאום קצרה** (יעד 30–45 שניות) לליד שכבר יש לו שורת `callback_requests` **עם סלוט קיים ומתוזמן** (`status='scheduled'`), לפני מועד השיחה האמיתית עם בעל/ת קלפה:

- מאשר שהזמן שנקבע עדיין נוח.
- אם לא נוח — אוסף העדפה חדשה (זמן מדויק, אם ניתן לחלץ בבירור) ומפעיל reschedule דרך הפונקציה הקיימת `rescheduleCallbackRequest`.
- אם לא ניתן לענות (Voicemail/AMD, אין מענה, קו רע) — לא כותב שום סטטוס שלילי; זו שכבת תזכורת best-effort, לא ניסיון חיוג רשמי (ראו סעיף 3).
- מזהה בקשת הסרה ("תסירו אותי") ומפנה לביטול.
- **אף פעם לא מנהל את השיחה המהותית עצמה** (מכירות/תמיכה/חיוב) — זו נשארת שיחה אנושית של בעל/ת קלפה, בדיוק כמו היום.

### מה לא (non-goals, מפורש)

- **לא** עונה לשיחות נכנסות — זה ה-inbound-answering agent המקביל.
- **לא** מנהל משא-ומתן מכירתי או שכנוע — זה ה-sales-closing agent המקביל. אם השיחה נסחפת לשאלת מכירה אמיתית ("כמה זה עולה", "מה אתם בעצם עושים") — מסלול deflection ל-notify/escalate, בדיוק כמו RSVPAgent מול שאלות שאין לו עליהן תשובה.
- **לא** בוחר את מועד הפגישה בעצמו. כל מה שהסוכן אי-פעם שולח החוצה הוא: (1) אישור שהמועד הקיים תקף, (2) מגבלה חדשה/זמן מבוקש חדש שהמנוע הקיים בוחר לפיו סלוט. שום מחרוזת שהמודל ניסח לא נכנסת ליומן — אותו כלל בדיוק כמו `buildCallbackDraft`.
- **לא** כותב ל-`call_outcome`/`applyCallOutcome` — זה מתעד מה קרה ב**שיחה המהותית**, לא בשיחת התזכורת שלי.

### שאלת ה-scope — הוכרעה 2026-08-22

- **(ב) — אושרה כ-scope הבסיס:** הסוכן רק **מאשר/מזיז** סלוט שהמנוע האלגוריתמי כבר קבע. היקף שיחה צר, נפח נמוך (שיחה אחת פר בקשה מתוזמנת), מבנה זהה ל-RSVPAgent, MVP בטוח.
- **(א) — נשארת הרחבה עתידית מתועדת, לא בהיקף:** חזית קולית לשלב הטריאז' על כל ליד טרי. ראו הערה בסעיף 5 אם/כש-Phase 2 הזה יוזם.
- **תוספת בעלים 2026-08-22 — כיוון נכנס:** ראו סעיף 4א.

---

## 2. איך זה מתייחס למנוע הקיים — לא מחליף, שכבה נוספת

**הסוכן החדש הוא שכבת תזכורת/וידוא מעל `findCallbackSlot`/`scheduleCallbackAppointment`/`rescheduleCallbackRequest` — הוא לא מחליף אף אחד מהם ולא כותב ליומן בעצמו.**

זרימה מוצעת:
1. `runCallbackSchedulingSweep` (קיים) ממשיך לקבוע סלוט ראשוני בדיוק כמו היום.
2. **חדש:** sweep נפרד ("confirmation dispatch sweep"), למשל ~24 שעות לפני `scheduled_at`, אוסף שורות `status='scheduled'` שטרם קיבלו שיחת אישור. **נבדק בפועל (סעיף 11א), לא הונח:** `dispatchOutreachCall` (`src/lib/data/outreach-calls.ts`) **נקרא במלואו** — הוא בנוי סביב campaign/event/contact (`getCampaignContext`, `isContactReached`, `createCallAttempt` עם `campaignId`/`eventId`/`guestId`), ואין שום מקבילה לזה בשורת `callback_requests`. **מסקנה: לא reuse — דיספצ'ר חדש, לפי אותה תבנית (payload/timeouts/atomic-create) אבל קוד נפרד.** ראו סעיף 11א לפירוט המלא. בכל מקרה — **לא סקריפט אד-הוק חדש** (memory: `no-adhoc-vox-scripts-use-client`).
3. חלון החיוג של שיחת האישור עצמה **חייב לצייד מתוך `DEFAULT_CALLBACK_POLICY`** (א׳–ה׳ 09:00–18:00, ו׳ 09:00–13:00, שבת סגור) — לא מהנחיות 08:00–21:00 הגלובליות שלי כ-agent definition, שהן רק רשת ביטחון עליונה, לא המדיניות בפועל. אם 24 שעות לפני נופל מחוץ לחלון — להזיז קדימה לתחילת החלון הבא (אותה לוגיקה כמו `localInstant`/`addCalendarDays` הקיימים ב-`schedule-policy.ts`, לא מומצאת מחדש).
4. **תוצאת שיחת האישור לא נכתבת ל-`call_outcome`** (זה שדה של השיחה המהותית). `confirmation_call_status` (`not_sent`/`confirmed`/`no_answer`/`reschedule_requested`/`opted_out`) + `confirmation_call_at` שייכים ל**טבלת ה-attempt החדשה** שסעיף 7 ממילא מציע להקים עבור משטח הטוקן (לא עמודות נוספות ישירות על `callback_requests`) — פתרון אחד לשתי הבעיות, לא שניים נפרדים. **החלטת סכמה — מסירה ל-rls-schema-engineer**, לא מוכרעת כאן.
5. **reschedule מהסוכן = בדיוק `rescheduleCallbackRequest(id, exactIso)` הקיים**, שום פונקציה חדשה. אם הסוכן לא הצליח לחלץ ISO ברור מהדיבור — **לא מפעיל reschedule בכלל**, אלא מסלול "נחזור אליך" (notify/escalate לתור `console_queues`), בדיוק כמו RSVPAgent מול "תחזרו אליי מחר בערב" כשאין callback_iso ודאי.
6. **אם reschedule נכשל** (`old_appointment_not_removed`) — הסוכן **לא** אומר "תוזמן מחדש". יש לו נוסח כישלון-בכנות ייעודי (ראו סעיף 3, ענף reschedule), בדיוק כמו RSVPAgent מול `save_rsvp` שהחזיר `rejected` — לעולם לא להציג כישלון כהצלחה (memory: `save-rsvp-queued-false-promise`).

---

## 3. תרשים מצבים (state machine) — Phase 1

```
START (שיחה יוצאת, יעד 30–45 שניות)
  │
  ├─ AMD/Voicemail מזוהה ──────────────→ נתק מיד, confirmation_call_status='no_answer'. אין הודעה קולית.
  │
  ├─ מענה אנושי
  │    │
  │    ├─ 1. זיהוי — "מדבר/ת עם {{lead_name}}?"
  │    │      ├─ לא/אדם לא נכון ──→ בקשה עדינה להעביר/לחזור, notify_owner אם צריך, end_call
  │    │      └─ כן ↓
  │    │
  │    ├─ 2. הקשר קצר — "בקשר לפנייה שלך ל{{topic_he}} עם קלפה — קבענו לך שיחה ל{{scheduled_when_spoken}}, זה עדיין מתאים?"
  │    │      │
  │    │      ├─ כן, מתאים ──→ confirm_meeting (log בלבד, אין כתיבה ליומן) → סיום חם → END
  │    │      │
  │    │      ├─ לא מתאים, יש זמן חלופי ברור ──→ 3a
  │    │      │
  │    │      ├─ לא מתאים, אין זמן ברור / "תתקשרו שוב" ──→ 3b
  │    │      │
  │    │      ├─ "תסירו אותי" (בכל שלב, בכל ניסוח) ──→ mark_opt_out → אישור קצר → END
  │    │      │
  │    │      └─ שאלה מהותית (מחיר/מוצר/"מה זה קלפה") ──→ deflect קצר ("זה בדיוק מה שנדבר עליו בשיחה עצמה") → חזרה לשלב 2
  │    │
  │    ├─ 3a. reschedule עם זמן ברור
  │    │      → request_reschedule(callback_iso, callback_when_text)
  │    │      ├─ הצלחה ──→ **לא לומר זמן קונקרטי** (ראו הערה קריטית מתחת לתרשים) → "מעולה, נעדכן אותך במועד החדש" → END
  │    │      └─ כישלון (old_appointment_not_removed / שגיאה) ──→ "לא הצלחתי לעדכן ביומן עכשיו — מישהו יחזור אליך" → escalate_to_queue → END
  │    │
  │    └─ 3b. reschedule בלי זמן ברור
  │           → escalate_to_queue("caller wants different time, unclear when")
  │           → "אעביר בקשה שיחזרו אליך לתאם זמן חדש" → END
  │
  └─ שקט/קו רע (פעמיים) ──→ escalate_to_queue קצר → END
```

**⚠️ הערה קריטית — 3a לא יכול להבטיח זמן:** `rescheduleCallbackRequest` מחזיר `{ ok: true }` בלבד, בלי זמן. כל מה שהוא עושה בפועל הוא לכתוב `requested_at=exactIso, requested_rank='nearest'` ולסמן `needs_reschedule` — הסלוט **בפועל** נבחר מאוחר יותר, בסיבוב הבא של `runCallbackSchedulingSweep` → `findCallbackSlot`, שיכול לנחות במקום אחר לגמרי (שעות עבודה, תפוסה ביומן, תקרת 8/יום, שבת/חג — ו-`'nearest'` מחפש **בשני הכיוונים** סביב העוגן). ברגע שהסוכן מדבר, `{{new_time_spoken}}` **עדיין לא קיים**. זו בדיוק תבנית הכשל של `save-rsvp-queued-false-promise` — להבטיח משהו שהמערכת מעולם לא אישרה. **המסקנה ל-MVP: הסוכן לעולם לא קורא בקול זמן חדש קונקרטי אחרי `request_reschedule` — רק "נעדכן אותך".** עדכון בפועל (SMS/וואטסאפ עם הזמן שנבחר) הוא באחריות שכבה אחרת, לא הסוכן הקולי. אופציה עתידית (מותנית באימות latency בסעיף 11): אם `mtg/cb` מריץ סינכרונית `rescheduleCallbackRequest` ואז `scheduleCallbackAppointment` ומחזיר `startIso` אמיתי לפני שהסוכן מדבר — או-אז read-back קונקרטי בטוח. **לא הוכרע — תלוי במדידה, לא בהנחה.**

**2 strikes → fallback**: כל ענף שמגיע לשתי אי-הבנות/שתיקות רצופות עובר ל-escalate_to_queue ומסיים — אותו כלל בדיוק כמו RSVPAgent (`error handling` section).

**אין תור ניסיונות חוזרים אוטומטי לשיחת האישור עצמה** — זו שכבת best-effort. אם אין מענה, הפגישה המקורית שקבע `findCallbackSlot` **ממשיכה לעמוד** בלי שינוי; רק בעל/ת קלפה מגיעים אליה בלי "תזכורת חמה" מראש. זה בכוונה — מונע לערבב את הסטריק של `applyCallOutcome` (3 no_answer רצופות → סגירה + SMS) עם כישלון של שיחת תזכורת שהיא לא הניסיון הרשמי.

---

## 4. הכלים — Deterministic Gateway, לא סטייה

בהשראת RSVPAgent (`save_rsvp`/`mark_dnc`/`notify_owner`/`schedule_callback`), עם אותו עיקרון: **הסוכן אף פעם לא שולח מחרוזת שנכנסת כמו-שהיא ליומן**.

| כלי | פרמטרים | מה קורה בצד השרת |
|---|---|---|
| `confirm_meeting` | אין | לא נוגע ביומן. כותב `confirmation_call_status='confirmed'` בלבד (log). |
| `request_reschedule` | `callback_when_text` (חופשי, לוג בלבד), `callback_iso` (אופציונלי — כמו `schedule_callback` הקיים) | אם יש `callback_iso` תקין ועתידי → `rescheduleCallbackRequest(id, iso)` (**הפונקציה הקיימת, לא חדשה**). אם אין/לא תקין → אין כתיבה ליומן; נופל ל-`escalate_to_queue`. |
| `mark_opt_out` | אין | **תוקן 2026-08-22, ראו הערה מתחת לטבלה:** לא עמודה חדשה — upsert ל-`call_dnc_list` (אותו מנגנון ש-RSVPAgent's `mark_dnc`/`processCallDnc` כבר משתמשים בו), + `confirmation_call_status='opted_out'` (log, כבר בסכמה). |
| `escalate_to_queue` | `reason` (enum: `wrong_person`/`substantive_question`/`unclear_reschedule`/`bad_line`/`other`), `note_he` (עד 300 תווים) | כותב ל-`console_queues`/`contact_messages` באותו מנגנון קיים של `TOPIC_TO_QUEUE_KEY` (לא ערוץ חדש) — לא ל-Slack ישירות ולא ליומן. |

**תיקון 2026-08-22 — `mark_opt_out` לא היה פער, טעות בקריאה קודמת:** הטענה המקורית כאן ("`callback_requests` אין לו מסלול DNC") הייתה שגויה — נבדק בפועל מול `src/lib/data/outreach-engine.ts` (`isDncListed`, שער ב-`dispatchOutreachCall` וב-`console-calls.ts`) ו-`src/lib/data/call-result-processing.ts` (`processCallDnc`, ה-handler הקיים בפועל של `mark_dnc`): קיימת כבר `call_dnc_list` — טבלה **ברמת טלפון**, לא ברמת שורה, עם `upsert(..., {onConflict:'normalized_phone'})` — שכל דיספצ'ר יוצא במערכת (כולל זה שיובנה ל-`callback_requests`, סעיף 11א) כבר יצטרך לבדוק דרך `isDncListed()` בכל מקרה. **`mark_opt_out` הוא upsert לאותה טבלה, באותו מפתח, לא עמודה חדשה על `callback_requests`.** שתי עמודות DNC נפרדות (טבלה + row-level) היו יוצרות שני מקורות אמת שיכולים לסתור זה את זה — בדיוק מה ש-`call_dnc_list` המשותפת מונעת. `confirmation_call_status='opted_out'` (כבר ב-enum של הכלי) עדיין מתעד **שהקריאה הזו** הפעילה את זה, לשקיפות admin — אבל ההשתקה בפועל היא ה-upsert. תודה ל-`sales-meeting-schema-build` שמצא את זה תוך בניית טבלת ה-attempt.
| `end_call` (system) | `reason`, `message` | זהה במבנה ל-RSVPAgent — משפט הפרידה בפרמטר, לא כתור נפרד לפניו. |
| `voicemail_detection` / `language_detection` / `skip_turn` (system, built-in) | — | זהה ל-RSVPAgent; `voicemail_detection` קריטי כאן כי זו שיחה יוצאת לליד שלא בהכרח מצפה. |

**לא כלול:** שום כלי `save_rsvp`-מקביל שכותב תוכן חופשי ליומן. שום כלי טעינת מחיר/מוצר (זה knowledge-base/sales territory, לא כאן).

---

## 4א. כיוון נכנס — sub-flow משותף עם ה-inbound-answering agent (תוספת בעלים 2026-08-22)

**לא סוכן שלישי, לא מנגנון handoff חי.** כשלקוח מתקשר **פנימה** לקלפה ומזוהה על ידי ה-inbound-answering agent (`planner-inbound-agent`, Phase 1: "AI עונה רק כשסדר הצלצול מוצה וה-caller כבר מזוהה") כמי שיש לו שורת `callback_requests` עם `scheduled_at` עתידי — **אותו סוכן שכבר עונה לשיחה** (לא אני) מספר על הפגישה הקיימת ומאפשר להזיז אותה, בקריאת כלי אחת בתוך השיחה שלו. תואם את מה ששני הצדדים כבר הסכימו עליו (`planner-inbound-agent`'s §5): אין מנגנון handoff חי בין שני agents-AI מאומת בקוד הזה — רק המונה-הפיקוח האנושי (DTMF-9) קיים ומאומת חלקית.

**חלוקת אחריות (מוסכם עם `planner-inbound-agent`, לא הוכרע ע"י צד אחד):**

| מי | מה |
|---|---|
| **inbound-answering agent** | שלב הזיהוי כולו: `identifyInboundCaller()` (קיים, `route-inbound/route.ts`) + החיפוש הנוסף `callback_requests.phone = normalizedCli AND scheduled_at > now() AND status NOT IN ('cancelled','closed')`. **אין FK** (`callback_requests` אין לו `guest_id`/`contact_id`/`event_id`) — זה חיפוש טלפון ישיר, בדיוק כפי ש-`planner-inbound-agent` אימת מול types.ts החי. הם הבעלים הטבעיים של החיפוש הזה — הוא יושב ממש ליד שלב הזיהוי שלהם, לא צריך שאבנה אותו. |
| **מסמך זה (meeting-booking agent)** | חוזה ה-`request_reschedule` עצמו: הפרמטרים (`callback_when_text`/`callback_iso`), העטיפה סביב `rescheduleCallbackRequest(id, exactIso)` הקיים (**לא פונקציה חדשה, לא נבנית פעמיים**), אכיפת deterministic-gateway (שום זמן שהמודל בדה, ראו ההערה הקריטית בסעיף 3), ומודל הטוקן/הרשאה (למטה). |

**מודל טוקן משותף לשני הכיוונים — הרחבה של סעיף 7, לא מנגנון שני:**

הצעת `planner-inbound-agent` (חוזה משותף, לא נבנה פעמיים) והתכנון כאן (משטח `mtg/ctx`/`mtg/cb` עם טוקן אטום, ראו סעיף 7) הם **אותו רעיון בשני כיוונים שונים של מתי הטוקן מונפק**:

- **יוצא (המסלול הראשי במסמך זה):** הטוקן מונפק ב-dispatch (~24 שעות מראש), מקושר לשורת attempt חדשה שמצביעה על `callback_requests.id` ספציפי.
- **נכנס (התוספת הזו):** הטוקן מונפק **ברגע הזיהוי** — כש-`identifyInboundCaller()` + החיפוש שלמעלה מוצאים התאמה, ה-inbound agent מנפיק/מקבל טוקן קצר-טווח (TTL של דקות, לא שעות — תקף רק לאורך השיחה הנוכחית) המקושר לאותה שורה. הטוקן הזה מועבר להקשר השיחה (dynamic variable / `conversation_initiation_client_data`), והכלי `request_reschedule` **בתוך סוכן ה-inbound** קורא לאותו endpoint (`/api/voximplant/mtg/cb/[token]`) עם אותו payload — **אותה סכמת `strictObject`, אותה קריאה ל-`rescheduleCallbackRequest`**, רק טוקן שהונפק במועד אחר וממקור אחר (זיהוי חי, לא dispatch מתוזמן).

כך שכן — התשובה ל-`planner-inbound-agent`: **יש עיצוב (לא קוד עדיין)**, הוא מפורט בסעיף 7, וההרחבה הזו (הנפקת טוקן בזמן-זיהוי, לא רק ב-dispatch) היא התוספת היחידה שהכיוון הנכנס דורש ממנו. אין צורך בשני חוזי HTTP נפרדים.

**מוסכם, לא במחלוקת:** אין AI-to-AI live handoff במסמך הזה — קריאת הכלי קורית *בתוך* סוכן ה-inbound, לא כהעברה לפרסונה אחרת.

---

## 5. Knowledge Base — מכוון, לא RAG כללי

בדומה ל-RSVPAgent (`rag.enabled: false`, 0 מסמכים), **אין צורך ב-RAG למסלול (ב)**: כל מה שהסוכן צריך יודע מראש מתוך משתני הקשר (dynamic variables), בדיוק כמו RSVPAgent — לא ידע כללי על קלפה.

משתנים מוצעים (מקור: `callback_requests` + `DEFAULT_CALLBACK_POLICY`, **לעולם לא הרדקוד**):
- `{{lead_name}}` — `full_name`.
- `{{topic_he}}` — `topic` (רשימה סגורה, `TOPIC_TO_QUEUE_KEY`).
- `{{scheduled_when_spoken}}` — `scheduled_at` מפורמט לדיבור (`formatIsraelSpokenDate`/`formatIsraelTime`, לא `slice(0,10)` — memory `events-event-date-timestamptz`).
- `{{meeting_duration_spoken}}` — נגזר מ-`DEFAULT_CALLBACK_POLICY.durationMs` (15 דק'), לא הרדקוד בפרומפט.
- `{{caller_role}}` — **נבדק, שלילי מדוד:** אין בפרויקט שום מושג של "נציג מוקצה" ברמת שורה (`callback_requests` אין לו `assigned_to`/`sales_rep`), ואין רשימת אנשי צוות עם שם — יש רק חיבור Exchange עסקי **יחיד** (`loadBusinessConnection`, לא אישי) וישות חברה יחידה (`company_legal_name` ב-`company.ts`/`app_settings`). לכן `{{caller_role}}` **לא יכול להיות שם אדם** במצב הנוכחי — רק "מהצוות של קלפה" או `{{company_legal_name}}`, אם וכשמישהו מהצוות בקלפה מחליט שזה המידע הרצוי לחשוף. אם רוצים תשובה טובה יותר ל"עם מי אדבר" (השאלה שה-team-lead ציין שהסוכן חייב לענות עליה, לא לדחות) — נדרש שדה סכמה חדש לזיהוי הנציג, לא רק ניסוח פרומפט.

**אם התשובה מ-main היא (א)** (חזית קולית לטריאז', שיחות עם שאלות פתוחות יותר על "מה זה קלפה בכלל") — או-אז יש מקום אמיתי ל-RAG מכוון, אבל מקורו חייב להיות אותה טבלת "מה קלפה עונה על שאלות" שה-FAQ הציבורי כבר משתמש בה (memory: `no-hardcoded-business-facts`, `faq-protected-row`), לא מסמך שנכתב ידנית לסוכן הזה. זו החלטה נדחית ל-Phase 2, לא כלולה במסלול (ב).

---

## 6. שלד הפרומפט — כותרות בעברית (Phase 2, טיוטה לא-סופית)

לפי מבנה `prompting-guide` שכבר בשימוש ב-RSVPAgent (Personality/Environment/Tone/Goal/Guardrails/Tools/Error handling). **לא transcript מלא של 118 תרחישים** — זו טיוטת מבנה לאישור לפני כתיבת התמליל המלא (Phase 2 מחייב אישור בעלים לפני קוד, בדיוק כמו voice-rsvp-agent workflow).

```
# Personality
[שם עובד — לא הוכרע כאן, החלטת מותג. הצעת עבודה: "מתאם/ת" בתפקיד, לא שם פרטי-מותג
כמו "מאושר" (שהוא פאן מכוון על RSVP). קליל, ענייני, קצר בהרבה מ-RSVPAgent — זו
שיחת אישור, לא שיחה חברית.]

# Environment
שיחת טלפון יוצאת לליד שמילא טופס פנייה בקלפה. הליד לא בהכרח זוכר שהוא מילא טופס.
ידוע: {{lead_name}}, {{topic_he}}, {{scheduled_when_spoken}}, {{meeting_duration_spoken}}.
שום פרט אחר על קלפה, מחיר, או מוצר אין לסוכן.

# Tone
עברית מדוברת, קצר מאוד (משפט-שניים לתור), בלי שפת טפסים. המטרה מושגת תוך
30–45 שניות — לא שיחה, אישור.

# Goal
1. זיהוי קצר.
2. אישור/הזזה של המועד הקיים — לא קביעה חדשה מאפס.
3. אם שאלה מהותית עולה — דחייה עדינה לשיחה עצמה, לא מענה.
4. סגירה חמה.

# Guardrails
[מבנה זהה ל-RSVPAgent §Guardrails: פלט=דיבור בלבד; לא ממציא פרט; DNC מיידי;
לא מתחזה לאדם; לא דן במחיר/תוכן מכירתי; מספר ניסיונות כלי מוגבל; וכו']

# Tools
[confirm_meeting / request_reschedule / mark_opt_out / escalate_to_queue / end_call —
כמו סעיף 4 לעיל, בניסוח כלי מלא לפי הפורמט של elevenlabs-json-reference.md §2]
```

**הבעלים צריך לאשר את שלד הזרימה (סעיף 3) לפני שנכתב תמליל Phase 2 מלא** — בדיוק לפי מדיניות voice-rsvp-agent.

---

## 7. טלפוניה/ניתוב — נדרש משטח טוקן חדש, לא שימוש חוזר ב-ctx/cb הקיים

**נבדק בקוד, לא הונח:** `/api/voximplant/ctx/[token]` ו-`/api/voximplant/cb/[token]` קשורים קשיחות ל-RSVP אורח-אירוע:
- הזהות מגיעה מ-`getCallContextByAccessToken` → `call_attempts` המחובר ל-event+guest.
- השער הוא `ctx.event.status !== 'active'` + רשימת סטטוסים טרמינליים ספציפית ל-RSVP.
- גוף התגובה הוא אך ורק שדות אירוע/אורח.
- ב-`cb`, ה-`dedupe_key` הוא `vox-cb:${attemptId}:${call_status}`, וה-drain מנתב ל-`processCallResult` (RSVP+חיוב). `voxCallbackSchema` הוא `strictObject` שמסרב לכל שדה זר.

**אין תפר קיים** להכניס שיחת callback_requests לכאן בלי לסכן את מסלול ה-RSVP/חיוב הקיים.

**הצעה:** משטח טוקן **מקביל**, לא שכתוב של הקיים:
- `/api/voximplant/mtg/ctx/[token]` — קורא שורת attempt חדשה (טבלה חדשה, מקושרת ל-`callback_requests.id`, לא ל-`call_attempts`), מחזיר רק `lead_name`/`topic_he`/`scheduled_when_spoken`/`meeting_duration_spoken`. **שער טריות (freshness gate) — חובה, לפי הדפוס הקיים ב-`ctx/[token]` שבודק `event.status`/סטטוסים טרמינליים ברגע השיחה עצמה, לא רק ברגע ה-dispatch:** בין ה-dispatch (~24 שעות מראש) לרגע השיחה בפועל, `reconcileCallbacksWithCalendar` יכול לשחרר את השורה (בעל/ת קלפה מחקו את הפגישה ב-Outlook → `calendar_item_id` מתאפס, `status` חוזר ל-`pending_schedule`). בלי בדיקה מחדש, הסוכן עלול לפתוח עם "קבענו לך שיחה ל…" לפגישה שכבר לא קיימת. `mtg/ctx` **חייב** לאמת מחדש בזמן הקריאה: `status='scheduled'`, `calendar_item_id IS NOT NULL`, ו-`scheduled_at` זהה למה ש-dispatch שלח — אחרת אותו 404 גנרי כמו הקיים.
- `/api/voximplant/mtg/cb/[token]` — `event_kind` חדש (לא `call_result`), סכמת `strictObject` חדשה וצרה (רק מה שסעיף 4 מגדיר), **אינו נכנס ל-drain הקיים** — drain נפרד או handler ייעודי, כדי שלעולם לא ייגע ב-RSVP/חיוב.
- טוקן אטום, TTL, rate limit, 404 גנרי — **בדיוק אותו דפוס אבטחה** כמו `ctx`/`cb` הקיימים (fingerprint, no-store, oversized-body guard).
- **זו סקירת אבטחה של `public-rsvp-sentinel` לפני מימוש** (זהו משטח טוקן ציבורי חדש — הבריף שלו אומר שהוא התחנה הראשונה לתכנון endpoint טוקן-חדש), בשיתוף `rls-schema-engineer` לטבלה החדשה. **לא הוכרע כאן**, רק המלצה מנומקת.

**Scenario Voximplant:** תרחיש VoxEngine **חדש**, כלל חדש ב-Voximplant (**לא לגעת** ב-`OutCallAgent`/`RSVPAgent` הקיימים או בכלל ה-DTMF `OutCall`, לפי CLAUDE.md). Application נפרד או משותף — להחליט מול voximplant-engineer בזמן המימוש.

---

## 8. הסלמה לאדם / monitor path

**MVP מוצע:** `escalate_to_queue` → `console_queues` (אותו מנגנון קיים ש-`createContactMessage`/`createCallbackRequest` כבר מזינים), לפי `topic` → `sales`/`support`/`billing`. אדם רואה את זה בתור הרגיל שלו, בלי צורך בתשתית handoff חדשה.

**Phase 2 אפשרי:** ה-workstream של "browser call-center" (DTMF-9 live handoff, `human_agent_call_legs`, `advanceLegStatus`) קרוב מאוד לבשלות (memory: "רק אימות אודיו חי נותר"). אם רוצים handoff חי באמצע שיחת אישור (למשל הליד מתחיל לשאול שאלות מכירה אמיתיות ויש נציג זמין עכשיו) — זה שימוש חוזר טבעי בתשתית הקיימת, **לא** תשתית חדשה. **דורש תיאום עם מי שמוביל את ה-console-agent/browser-call-center workstream** (ראו "Coordination needed" למטה) — לא מוכרע כאן ולא כלול ב-MVP.

---

## 9. תאימות (compliance) — flag, לא הכרעה

שתי חשיפות שונות, לפי scope (סעיף 1):

- **(ב) MVP — שיחת אישור לסלוט שהליד עצמו ביקש:** הליד יזם את הפנייה (מילא טופס, ביקש שיחה). זו שיחה **על הבקשה של עצמו**, לא שידול. חשיפה נמוכה יחסית — אבל **עדיין שיחה יוצאת אוטומטית שלא הייתה קיימת קודם**, ולכן עדיין דורשת: זיהוי מטרת השיחה במשפט הראשון (בדיוק כמו RSVPAgent), כיבוד "תסירו אותי" מיידי, וחלון שעות חוקי (סעיף 2). **המלצה: סקירת israeli-compliance-advisor לפני הפעלה, גם אם הסיכון נמוך יחסית** — לא הוכרע כ"לא צריך".
- **(א) הרחבה — חזית קולית לטריאז' על כל ליד טרי:** זה מגע קולי ראשון על בסיס טופס טקסט, נפח גבוה יותר, **חובה** סקירת תאימות מלאה לפני כל מימוש — לא רק המלצה.
- **תוקן 2026-08-22:** בעבר נטען כאן שאין מסלול DNC ל-`callback_requests`. שגוי — `call_dnc_list` (ברמת טלפון, ראו התיקון בסעיף 4) כבר קיימת ומשמשת בדיוק לזה. "תסירו אותי" עדיין חייב נחיתה אמיתית ולא רק ניסוח בתמליל — אבל הנחיתה היא upsert לטבלה קיימת, לא עמודה חדשה.

---

## 10. Coordination needed

- **מול ה-inbound-answering agent (`planner-inbound-agent`) — הוכרע 2026-08-22, ראו סעיף 4א:** כיוון נכנס הוא sub-flow בתוך סוכן ה-inbound, לא agent שלישי ולא handoff חי. חלוקה מוסכמת: הם בעלי חיפוש הטלפון→שורה (`callback_requests.phone = normalizedCli`, יושב ליד שלב הזיהוי שלהם); מסמך זה בעל חוזה ה-`request_reschedule` (עטיפת `rescheduleCallbackRequest` הקיים, deterministic gateway, מודל טוקן). **פתוח עדיין:** מי בפועל מיישם את הענף "הנפק טוקן בזמן-זיהוי" ב-`mtg/cb` — טבעי שזה נופל אצל מי שכותב את endpoint ה-`mtg` (משימת יישום, לא עיצוב; להכריע כש-Phase implementation מתחיל, לא עכשיו).
- **מול ה-sales-closing agent:** אם השיחה המכירתית מזהה "ליד לא מוכן לקנות, רוצה שיחזרו אליו" — זה בדיוק היוצר של שורת `callback_requests` שהסוכן שלי מטפל בה מאוחר יותר. **מי כותב את השורה** (ישירות דרך `createCallbackRequest`, או flow ייעודי)? לא מכריע — שאלת מסירה בין שני התכנונים, טרם נדונה.
- **מול browser-call-center/console-agent workstream:** אם רוצים DTMF-9 live handoff (סעיף 8) — תיאום נפרד, לא כלול כאן.

---

## 11. Prerequisites — verify before implementation (בוצע בפועל 2026-08-22, לא רק מסומן)

בעקבות בקשת הבעלים: שני הפריטים שהיו מסומנים "unverified"/"unmeasured" — נבדקו בפועל (קריאת קוד המימוש האמיתי + לוגי production חיים דרך `pm2 logs`), לא רק דוגלו כשאלות פתוחות.

### א. הדיספצ'ר של קמפיין ה-RSVP — נבדק, **שלילי מאומת**

קראתי את `dispatchOutreachCall` המלא (`src/lib/data/outreach-calls.ts:138`). **המסקנה: לא ניתן לשימוש חוזר ישיר** עבור `callback_requests` — הוא בנוי מהיסוד סביב מודל קמפיין/אירוע/איש-קשר:
- ה-job type (`OutreachCallRequest`) הוא `{campaignId, eventId, contactId, normalizedPhone, touchpointIndex}` — לכולם אין מקבילה אמיתית בשורת `callback_requests` (אין קמפיין, אין בהכרח אירוע, אין "contact" במובן של הטבלה הזו).
- כל שערי הבדיקה תלויים במודל הזה: `getCampaignContext(campaignId)`, `isContactReached(eventId, contactId)`, `rsvpClosedReason(cctx)`, `hasCallConsent(contactId)` — כולם שאלות שאין להן תשובה בלי קמפיין/אירוע.
- הכתיבה בפועל היא ל-`call_attempts` דרך `createCallAttempt({eventId, campaignId, contactId, guestId, touchpointIndex, ...})` — אותה טבלה ואותו מודל שסעיף 7 כבר קבע שלא ניתן לשימוש חוזר עבור הטוקן. עקבי עם הממצא שם.

**מה כן ניתן לשימוש חוזר — התבנית, לא הפונקציה:** מבנה ה-payload (`{to, from, tok, u}`, Branch B, מתחת למגבלת 200 בייט), ה-create אטומי (`INSERT ... ON CONFLICT DO NOTHING`, לא read-then-insert), בדיקת יתרה מקדימה (`getAccountInfo` עם timeout מפורש — `BALANCE_TIMEOUT_MS=10s`), וקריאת `startScenarios` עם timeout מפורש (`START_TIMEOUT_MS=25s`) וסיווג definite/ambiguous של התוצאה. דיספצ'ר חדש ל-`callback_requests` **חייב** להיבנות לפי אותה תבנית (ואותם timeouts מפורשים!) אבל כפונקציה נפרדת — לא קריאה ל-`dispatchOutreachCall` הקיים. זו עבודת מימוש אמיתית (לא "עטיפה דקה"), לתכנן מול voximplant-engineer בפאזת המימוש.

### ב. Latency של Exchange/Graph בתוך תור שיחה — נבדק, **תלוי בעיצוב שכבר נבחר**

**קודם כל — הממצא החשוב ביותר: זה כבר לא רלוונטי לשום קריאת כלי ב-MVP שנבחר.** הכלים `confirm_meeting` ו-`request_reschedule` (סעיף 4) **לא מבצעים שום קריאת Graph סינכרונית תוך כדי השיחה** — `confirm_meeting` הוא log בלבד, ו-`request_reschedule` רק כותב `requested_at`/`rank` ל-DB (העיצוב שכבר תוקן בסעיף 3, ההערה הקריטית מתחת לתרשים). ה-sweep שבאמת קורא ל-Exchange רץ **אחרי** שהשיחה כבר הסתיימה. אז לשאלה "האם round-trip ל-Exchange נכנס בתוך תור שיחה" — **התשובה עבור העיצוב הנבחר היא: זה פשוט לא קורה בתוך השיחה בכלל.** זו לא הימנעות מהשאלה — זו הסיבה שהעיצוב הזה נבחר.

השאלה עדיין רלוונטית **רק** לאופציה העתידית המותנית (read-back סינכרוני, ראו ההערה הקריטית בסעיף 3) — עבורה, הנה מה שנמדד בפועל:

- **מבנה, מקוד `graph-impl.ts`:** `getAvailability` = קריאת POST **אחת** ל-`/calendar/getSchedule` (לא paginated, לא N+1 — "one request instead of a paged list", מתועד בקוד). `createAppointment` = POST **אחת** ל-`/events`. סה"כ 2 round-trips רציפים ל-Graph, לא יותר.
- **מדידה אמיתית, מלוגי production חיים (`pm2 logs kalfa-worker`):** נמצאו שני מקרים עצמאיים שבהם sweep הצליח לתזמן callback (שובצו=1) עם timestamp ברור לפני ואחרי:
  - 2026-08-19 23:06:31.024 (טריגר "triaged") → 23:06:34.289 (שורת סיום ה-sweep) = **3.265 שניות**
  - 2026-08-20 03:53:31.698 (טריגר "triaged") → 03:53:35.065 (שורת סיום ה-sweep) = **3.367 שניות**
  זה **גבול עליון**, לא בידוד נקי של שתי קריאות ה-Graph בלבד — הזמן כולל גם את `reconcileCallbacksWithCalendar`/`repairBlankCallbackBodies` שרצים לפני התזמון באותו tick (שיכולים בעצמם לקרוא ל-Graph). כ-3.2–3.4 שניות סה"כ, לא אפס וגם לא עשרות שניות — קרוב לגבול העליון הסביר לתור שיחה חי (2–4 שניות עם filler מורגש אבל לא שובר שיחה), אבל לא "מהיר בבירור".
- **פער קונקרטי שנמצא, לא רק latency:** ל-`graphClient()` **אין שום timeout מפורש** על אף קריאה (`.get()`/`.post()`/`.patch()`) — בניגוד לקריאות ה-Voximplant הסמוכות באותו קובץ שיש להן `BALANCE_TIMEOUT_MS`/`START_TIMEOUT_MS` מפורשים. תקלת Graph איטית/תקועה כיום **חסרת גבול זמן** — פער אמיתי שחייב תיקון קוד (הוספת AbortSignal/timeout) **לפני** שכל עיצוב read-back סינכרוני נבנה, לא רק "לבדוק latency".
- **מה לא הצלחתי למדוד, ומדוע — attempted, blocked on:** לא קיימת אינסטרומנטציית תזמון ייעודית (`console.time`/APM) שמבודדת רק `getAvailability` או רק `createAppointment` בנפרד מהעטיפה שסביבן. בידוד מדויק יותר דורש או (1) שינוי קוד להוספת לוגים — שינוי מימוש, מחוץ להיקף משימת תכנון בלבד, או (2) הרצת קריאה חיה מבוקרת מול תיבת הדואר האמיתית — פעולה נגד תשתית production, לא מורשית למשימת תכנון ללא אישור בעלים מפורש. **לא ניסיתי את (2)** — לא רק כי "לא מדדתי", אלא במפורש כי זו פעולה שמחוץ לסמכות של משימת plan-only.

**מסקנה מעשית לתוכנית:** לא חוסם את ה-MVP הנבחר (סעיף 3/4) בכלל. חוסם רק את אופציית ה-upgrade הסינכרונית העתידית, וגם עבורה — יש כבר מספר אמיתי (3.2–3.4s) ופער קונקרטי לתיקון (timeout חסר) לפני שהיא נבנית.

---

## 12. סיכונים

- **False confirmation:** אם `confirm_meeting` נשמע כמו "כן" אבל זה אי-הבנה (interruption-ignore terms כמו ב-RSVPAgent: "כן", "בטח" כמילות מילוי) — סיכון נמוך יחסית כי אין כתיבה ליומן על "כן" (רק log), אבל read-back קצר עדיין נדרש בתמליל.
- **Reschedule race:** אם הליד מבקש reschedule בדיוק כשה-sweep הרגיל רץ — `rescheduleCallbackRequest` כבר מטפל בזה אטומית (claim-then-write), לא סיכון חדש.
- **דיספצ'ר חדש = שטח קוד חדש, לא רק endpoint:** בעקבות סעיף 11א — כל בדיקות הבטיחות של `dispatchOutreachCall` (יתרה, concurrency cap, DNC, timeouts) צריכות שכפול מכוון עבור `callback_requests`, לא רק "לקרוא לפונקציה קיימת". זה מגדיל את היקף המימוש מעבר למה שנראה על פניו כמו "עוד endpoint".
- **חלון קריאה בזמן אמת — עודכן לפי סעיף 11ב:** לא רלוונטי ל-MVP (אין קריאת Graph חיה בתוך השיחה). רלוונטי רק לאופציית ה-upgrade הסינכרונית, שם יש כבר מספר מדוד (3.2–3.4s) ופער timeout לתקן קודם.
- **עמסת שיחות שווא על תור human_agent** אם `escalate_to_queue` נקרא באגרסיביות יתר על אי-הבנות רגילות — לכייל סף.
- **דליפת מדיניות DNC — נפתר 2026-08-22:** היה מסומן כפער סכמה; התברר שאינו — `call_dnc_list` הקיימת (ברמת טלפון, ראו סעיף 4) היא כבר מנגנון ההשתקה האמיתי בכל דיספצ'ר יוצא, ולא נדרשת עמודה חדשה. הסיכון שנותר קטן בהרבה: לוודא ש-`mark_opt_out` בפועל קורא ל-upsert הזה (לא רק סוגר את השורה) — פריט מימוש, לא עיצוב סכמה.

---

## 13. אימות מדורג (staged verification, לפני production)

1. ~~סקירת scope~~ — **הוכרע 2026-08-22**: אופציה (ב) + תוספת כיוון נכנס (סעיף 4א).
2. **סקירת אבטחה** — `public-rsvp-sentinel` על משטח הטוקן החדש (סעיף 7), **כולל שני מסלולי ההנפקה** (dispatch מתוזמן ליוצא, זמן-זיהוי לנכנס — סעיף 4א). ~~+ עמודות DNC~~ — **בוטל 2026-08-22**: אין עמודות DNC חדשות (סעיף 4 מתוקן), רק `call_dnc_list` הקיימת. `rls-schema-engineer` נדרש רק על טבלת ה-attempt עצמה (`callback_request_attempts`, כבר נבנתה/staged ע"י `sales-meeting-schema-build` — `supabase/migrations/20260822103442_callback_request_attempts_token_surface.sql`, לא הוחל על ה-DB). לתאם עם `planner-inbound-agent` שהסקירה מכסה את שני הכיוונים במעבר אחד, לא שתי סקירות נפרדות לאותו endpoint.
3. **אישור תרשים מצבים** (סעיף 3) — בעלים.
4. **אישור תמליל מלא** (Phase 2, אחרי סעיף 6) — בעלים, לפי מתודולוגיית voice-rsvp-agent.
5. **סקירת תאימות** — `israeli-compliance-advisor` (סעיף 9).
6. ~~בדיקת latency~~ — **בוצעה חלקית (סעיף 11ב):** לא חוסמת את ה-MVP; מספר מדוד קיים לאופציית ה-upgrade. **נותר:** הוספת timeout מפורש ל-`graphClient()` לפני כל עיצוב read-back סינכרוני.
7. **כתיבת דיספצ'ר חדש** ל-`callback_requests` (סעיף 11א) — לא reuse, עבודת מימוש מלאה לפי התבנית של `dispatchOutreachCall`, כולל שכפול השערים (יתרה/concurrency/DNC/timeouts).
8. **פריסת Voximplant לאפליקציית טסט בלבד תחילה** (`kalfatest` דוגמה קיימת), לא ישירות לרשימת שיחות חיה — לפי CLAUDE.md.
9. **אימות תמלול אודיו אמיתי** (לא תמליל הסוכן עצמו) לפני production — memory `elevenlabs-agent-config-workflow`.
10. **בדיקת נפח:** לפני הפעלה על כל תור ה-`callback_requests`, להריץ על מדגם קטן (5–10 שורות) ולבדוק תוצאות אמיתיות מול admin panel.

---

## נספח: קבצים שנקראו לבניית התוכנית הזו

- `src/lib/data/callback-scheduling.ts`, `src/lib/data/admin/callbacks.ts`, `src/lib/callbacks/calendar-item.ts`, `src/lib/callbacks/schedule-policy.ts`, `src/lib/data/inquiries.ts`
- `src/app/(admin)/admin/callbacks/{page.tsx,actions.ts,[id]/page.tsx,reschedule-form.tsx,call-outcome-form.tsx}`
- `src/lib/validation/admin.ts` (CALLBACK_STATUSES, CALL_OUTCOMES)
- `src/app/api/agents/callbacks/route.ts`
- `src/app/api/voximplant/ctx/[token]/route.ts`, `src/app/api/voximplant/cb/[token]/route.ts`
- `agent_configs/KALFA-RSVP.json` (מבנה פרומפט מלא + כלים)
- `docs/voice-agent/elevenlabs-json-reference.md` §6 (workflow מחייב)
- Supabase migrations: `20260728155249_callback_requests_triage.sql`, `20260819212112_callback_status_outcome_split.sql`, `20260819233736_callback_no_contact_closure.sql`
- `grep -ril "cal.com|calcom" src package.json` → אין שימוש ב-Cal.com בפרויקט (רק false-positive מ-"hebcal.com").
- **סעיף 11 (אימות בפועל, 2026-08-22):** `src/lib/data/outreach-calls.ts` (`dispatchOutreachCall` במלואו), `src/lib/exchange-ews/graph-impl.ts` (`getAvailability`/`createAppointment` המלאים), `pm2 logs kalfa-worker --lines 300` (לוגי production חיים — timestamps ה-sweep ששימשו למדידת ה-3.2–3.4 שניות).
