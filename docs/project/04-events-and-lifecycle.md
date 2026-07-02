# אירועים ומחזור חיים (Events & Lifecycle)

מסמך זה מתעד את דומיין האירועים ב-KALFA: ישות האירוע, שכבת הנתונים, הוולידציה,
מודל מחזור החיים (state model) על שלוש שכבות ההגנה שלו, ממשק הלקוח ותיעוד
הפעילות. המסמך מבוסס על קריאת הקוד בפועל ועל אימות מול בסיס הנתונים החי
(triggers ,constraints ורשימת המיגרציות) נכון ל-2026-07-02. כל פריט שקיים רק
במסמכי תכנון מסומן במפורש **"מתוכנן, טרם מומש"**.

מסמכי עזר:

- Spec: `plans/event-lifecycle-state-model-spec.md` (חוקים R1–R9 + R2b, פאזות S0–S4)
- Plan: `plans/event-lifecycle-state-model-plan.md`
- Runbook פריפלייט: `supabase/runbooks/event_lifecycle_s0_preflight.md`

---

## 1. ישות האירוע (Event entity)

הטבלה `public.events`. הטיפוסים הגנרטיביים: `src/lib/supabase/types.ts:790-861`.

| עמודה | טיפוס DB | הערות |
|---|---|---|
| `id` | uuid | מפתח ראשי |
| `owner_id` | uuid | הבעלים (legacy owner; נשמר לתאימות) |
| `org_id` | uuid, nullable | עוגן multi-tenancy — נקבע ב-`createEvent` דרך `ensurePersonalOrg()` |
| `name` | text | שם האירוע |
| `event_type` | enum `event_type` | ראו רשימת ערכים בהמשך |
| `event_date` | **timestamptz**, nullable | **לא `date`!** ראו קונבנציית `slice(0,10)` בהמשך |
| `rsvp_deadline` | **date**, nullable | מועד אחרון לאישור הגעה — עמודת `date` אמיתית, ללא שעה |
| `status` | enum `event_status` | `draft` \| `active` \| `closed` (`types.ts:1899`) |
| `venue_name` / `venue_address` | text, nullable | מקום האירוע |
| `notes` | text, nullable | |
| `package_id`, `template`, `with_ai_calls` | | עמודות billing/feature — אינן ניתנות לעריכה בנתיב הבעלים |
| `created_at` / `updated_at` | timestamptz | `updated_at` מתוחזק ע"י trigger `trg_events_updated` (`set_updated_at`) |

### Enums

- `event_status`: `draft`, `active`, `closed` — מקור אחד: `types.ts:1899`,
  ומראה אפליקטיבית ב-`EVENT_STATUSES` (`src/lib/validation/schemas.ts:78`).
- `event_type` (9 ערכים): `wedding`, `bar_mitzvah`, `bat_mitzvah`, `brit`,
  `britah`, `henna`, `engagement`, `birthday`, `other` —
  `EVENT_TYPES` (`src/lib/validation/schemas.ts:40`).

### קונבנציית `slice(0,10)` עבור `event_date`

`event_date` הוא `timestamptz` (אומת מול הסכמה החיה), אך ה-UI עובד עם
`<input type="date">`. לכן בכל תצוגה/קלט חותכים את עשרת התווים הראשונים
(`YYYY-MM-DD`):

- תצוגה: `src/app/(customer)/app/events/[id]/page.tsx:42-44` (`formatDate`),
  דשבורד `src/app/(customer)/app/page.tsx:91`, רשימת אירועים
  `src/app/(customer)/app/events/page.tsx:54`.
- השוואה צולבת בוולידציה: `updateEventSchema` משווה
  `rsvp_deadline <= event_date.slice(0, 10)` (`schemas.ts:120`).

`rsvp_deadline`, לעומת זאת, הוא `date` אמיתי — מחרוזת `YYYY-MM-DD` שמושווית
לקסיקוגרפית (שקול כרונולוגית) מול `todayIL()`.

### כלל הלוח העברי-ישראלי (Asia/Jerusalem)

כל חוקי התאריכים מוגדרים במונחי יום קלנדרי בישראל, בכל שלוש השכבות באותו ביטוי:
`(now() AT TIME ZONE 'Asia/Jerusalem')::date` מול
`(event_date AT TIME ZONE 'Asia/Jerusalem')::date`. בצד האפליקציה המקבילה היא
`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })`
(`src/lib/data/event-date.ts:15-22`).

---

## 2. שכבת הנתונים — CRUD (`src/lib/data/events.ts`)

כל הפונקציות רצות בשרת בלבד (`import 'server-only'`), נשענות על
`requireUser()` (redirect ללוגין אם אין session) ומסננות `owner_id` במפורש
**בנוסף** ל-RLS.

### שערי בעלות (ownership gates)

| פונקציה | מיקום | תפקיד |
|---|---|---|
| `requireOwnedEvent(eventId)` | `events.ts:31` | השער הסטנדרטי: שולף את האירוע עם `eq('owner_id', user.id)`; `notFound()` (404) אם לא קיים/לא בבעלות. נקרא בראש **כל** פונקציית נתונים בהיקף אירוע (guests, campaigns, …) |
| `requireEventAccess(eventId, resource, action)` | `events.ts:55` | שער org-aware: בעלים **או** חבר ארגון עם הרשאה, דרך ה-RPC `can_access_event()` (מקור אמת יחיד ב-DB). מיועד ל-Phase 3 של המולטי-טננסי |

### קריאה

| פונקציה | מיקום | התנהגות |
|---|---|---|
| `listEvents({ limit=20, offset=0 })` | `events.ts:98` | רשימת אירועי הבעלים, DTO מצומצם (`EventListItem`), מיון `created_at desc`, עימוד `range()` בצד השרת |
| `getEventCounts()` | `events.ts:126` | ספירות total/active דרך head queries (`count: 'exact', head: true`) — ללא טעינת שורות |
| `getEvent(eventId)` | `events.ts:218` | DTO מלא לעריכה (`EventDetail`); 404 אם לא בבעלות |

### כתיבה

| פונקציה | מיקום | התנהגות |
|---|---|---|
| `createEvent(input)` | `events.ts:159` | R1 מובטח מבנית: ל-`CreateEventInput` **אין** שדה `status` (וה-trigger כופה `draft` בכל מקרה). בדיקת R2 אפליקטיבית (`isBeforeTomorrowIL`), עיגון ל-org, ורישום `event.created` |
| `updateEvent(eventId, input)` | `events.ts:269` | allow-list מפורש של שדות; `status` **אינו** ניתן לעדכון כאן כלל (R6 — רק `publishEvent`/`closeEvent` כותבים status). סמנטיקת **נוכחות מפתח**: היעדר `event_date`/`rsvp_deadline` = "אל תיגע"; נוכחות מפתח על אירוע לא-draft = בקשה מזויפת → נדחית במפורש (מראה R5). על draft — ולידציית R2/R2b לפני הכתיבה |
| `publishEvent(eventId)` | `events.ts:333` | R3: עדכון **status בלבד** `draft→active`, עם pre-checks של תאריך עתידי ו-re-check R2b (הדדליין אולי "התיישן" מאז שנשמר). ה-UPDATE עצמו מסונן `eq('status','draft')` |
| `closeEvent(eventId)` | `events.ts:364` | R6: `draft/active→closed`. חריגת R7 מה-trigger (קמפיין פעיל) ממופה להודעת שגיאה עברית בטוחה אחת |

**אין מחיקת אירוע (delete)** בנתיב הלקוח — הסגירה (`closed`) היא המצב הסופני.

### Server Actions (מעטפות דקות)

| Action | מיקום | הערות |
|---|---|---|
| `createEventAction` | `src/app/(customer)/app/events/actions.ts:10` | `createEventSchema.safeParse` → `createEvent` → redirect לעמוד האירוע |
| `updateEventAction` | `src/app/(customer)/app/events/[id]/actions.ts:20` | `eventId` נכרך מ-route segment בשרת, לא מהדפדפן. בונה את הקלט לפי `formData.has(...)` — אותה בדיקת נוכחות מזינה גם את ה-Zod parse וגם את `updateEvent` (מקור אמת אחד) |
| `publishEventAction` / `closeEventAction` | `src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts:271 / :288` | מעטפות דקות; כל האכיפה בשכבת הנתונים וב-DB |
| `cancelCampaignAction` (R8) | `campaign-actions.ts:309` | ביטול קמפיין תקוע כדי לאפשר סגירת אירוע |

---

## 3. ולידציה (Zod — `src/lib/validation/schemas.ts`)

- `createEventSchema` (`schemas.ts:52`): שם (1–200), `event_type` enum,
  `event_date` אופציונלי, `venue_name` עד 200; refine R2 —
  `event_date` ריק **או** ≥ מחר בישראל (`schemas.ts:70`).
- `updateEventSchema` (`schemas.ts:83`): מוסיף `venue_address` (עד 300)
  ו-`rsvp_deadline`, עם **ארבעה** refines צולבים:
  1. `schemas.ts:107` — דדליין מחייב `event_date` (מראה ה-CHECK ב-DB);
  2. `schemas.ts:116` — דדליין ≤ יום האירוע, כולל (השוואה לקסיקלית עם `slice(0,10)`);
  3. `schemas.ts:130` — R2: `event_date` ≥ מחר (הנעילה אחרי draft נאכפת בשכבת
     הנתונים/DB, לא כאן — לסכמה אין שדה `status`);
  4. `schemas.ts:138` — R2b: `rsvp_deadline >= todayIL()` (אותו יום חוקי).

הסכמות מייבאות את `isBeforeTomorrowIL`/`todayIL` מ-`src/lib/data/event-date.ts` —
מודול עלה (leaf) ללא `server-only`, ולכן בטוח גם לטופסי client.

---

## 4. מודל מחזור החיים — החוקים (R1–R9 + R2b)

מכונת המצבים של אירוע: `draft → active → closed`, כאשר `closed` סופני
ו-`draft → closed` מותר גם הוא. ה-spec המלא: `plans/event-lifecycle-state-model-spec.md` §5.
כל החוקים להלן **ממומשים ופרוסים** (ראו §6 לאימות):

| חוק | תוכן | אכיפה |
|---|---|---|
| **R1** | אירוע נוצר תמיד כ-`draft` | trigger `events_before_insert` כופה `new.status := 'draft'`; מבנית — ל-`CreateEventInput` אין status |
| **R2** | `event_date` הוא NULL (טיוטה ללא תאריך — חוקי) או ≥ מחר בישראל; ניתן לקביעה רק ב-draft | trigger (insert + draft update) + `events.ts:163,293` + Zod refine + `min` על ה-input |
| **R2b** | `rsvp_deadline` לא נקבע בעבר (חסם תחתון ≥ היום; כלל זמן-כתיבה, לא invariant מתמשך) | trigger (insert, draft-edit, ו-re-check בפרסום) + `events.ts:299,340` + Zod `schemas.ts:138` |
| **R3** | `draft → active` מחייב תאריך עתידי קונקרטי, והוא מעבר **status בלבד** (אסור לשנות תאריכים באותו UPDATE) | trigger `events_guard_update` + `publishEvent` |
| **R4** | אירוע `active` "רוכב" דרך היום שלו — ביום האירוע עצמו הוא עדיין תקף; "עבר" = רק אחרי סוף היום הקלנדרי בישראל | הגדרת הגבול ב-`isPastEventDay` וב-SQL; אין אכיפה נפרדת |
| **R5** | `event_date` ו-`rsvp_deadline` נעולים ברגע ש-status ≠ `draft` | trigger + דחיית מפתח-נוכח ב-`updateEvent:286-289` + inputs מנוטרלים ב-UI |
| **R6** | רק המעברים המותרים; `closed` סופני; no-op (status ללא שינוי) מותר | trigger; באפליקציה — רק `publishEvent`/`closeEvent` כותבים status |
| **R7** | אי אפשר לסגור אירוע כשקיים קמפיין אופרטיבי (`draft`,`pending_approval`,`approved`,`scheduled`,`active`,`paused`) | בדיקה חוצת-טבלאות בתוך ה-trigger (SECURITY DEFINER); שיקוף ב-UI (`page.tsx:15-22`) |
| **R8** | ביטול קמפיין: `draft`/`pending_approval`/`approved` → `cancelled` רק ללא התחייבות כספית (`capture_status` ∉ {authorized,pending,hold_review}, `charge_status` null, אין `billed_results`) | RPC `cancel_campaign` (service_role בלבד) + trigger backstop `campaigns_guard_cancel`; באפליקציה `cancelCampaign` (`campaigns.ts:726`) עם שער בעלות **לפני** ה-RPC |
| **R9** | כל פעולת קמפיין מסחרית מחייבת `event.status='active'` | trigger `campaigns_require_active_event` + בדיקה בתוך `try_record_billed_result` + מראות אפליקטיביות (`campaigns.ts:138,271`, `transitionCampaignStatus` עם `requireActiveEvent`) |

---

## 5. ארכיטקטורת שלוש שכבות ההגנה

העיקרון: `public.events` כתיב לבעלים דרך PostgREST, ולכן Zod לבדו עוקף. השכבה
האוטוריטטיבית היא ה-DB; האפליקציה וה-UI הן defense-in-depth ו-UX.

### L0/S1 — Triggers ו-CHECK ב-DB (השכבה האוטוריטטיבית)

**היסטוריה:** המיגרציה `supabase/migrations/20260630072729_events_date_guards_l0a.sql`
הוסיפה את **LC-1** (זוג triggers `events_reject_past_event_date_*` נגד תאריך עבר)
ואת **LC-2** (ה-CHECK `events_rsvp_deadline_within_event`). המיגרציה
`20260630223635_event_lifecycle_state_model.sql` (S1) יצרה את ה-triggers המלאים
של R1–R9 **ואז** הפילה את שני ה-LC-1 triggers (סדר fail-safe — קודם יוצרים, אחר
כך מפילים; ה-CHECK של LC-2 לא נגעו בו והוא בתוקף עד היום).

**מצב חי מאומת (2026-07-02, `pg_trigger`/`pg_constraint`):**

- על `public.events`: `events_before_insert`, `events_guard_update`,
  `trg_events_updated` (בלבד — ה-LC-1 הישנים אכן הוסרו);
- CHECK: `events_rsvp_deadline_within_event` —
  `rsvp_deadline IS NULL OR (event_date IS NOT NULL AND rsvp_deadline <= (event_date AT TIME ZONE 'Asia/Jerusalem')::date)`;
- על `public.campaigns`: `campaigns_require_active_event` (R9),
  `campaigns_guard_cancel` (R8), `trg_campaigns_updated`;
- RPC: `cancel_campaign(uuid)` — EXECUTE ל-`service_role` בלבד.

שלוש פונקציות ה-trigger של S1 הן SECURITY DEFINER (`events_guard_update` צריכה
קריאה חוצת-RLS של `campaigns` עבור R7); המיגרציה
`20260630230249_event_lifecycle_trigger_revoke_public.sql` שללה מהן EXECUTE
מ-public/anon/authenticated (הקשחת advisor בלבד — trigger ממילא לא נקרא ישירות).

### L1 — שומרי אפליקציה (`src/lib/data/event-date.ts`)

מודול עלה יחיד, ללא תלויות וללא `server-only`, בטוח ל-worker ול-client;
`src/lib/data/events.ts:27` מייצא אותו מחדש כבית המתועד:

| פונקציה | מיקום | כלל |
|---|---|---|
| `isPastEventDay(eventDate, nowMs?)` | `event-date.ts:24` | "עבר" = רק **אחרי** סוף היום הקלנדרי בישראל (R4); NULL לעולם לא "עבר" |
| `assertEventNotPast(eventDate)` | `event-date.ts:36` | צורה זורקת (שגיאה עברית) ל-Server Actions |
| `todayIL()` | `event-date.ts:47` | היום בישראל כ-`YYYY-MM-DD` — בסיס השוואה ל-`rsvp_deadline` |
| `isBeforeTomorrowIL(eventDate)` | `event-date.ts:55` | גבול R2/R3 — דוחה גם את היום (רק ≥ מחר חוקי) |

**נקודות האכיפה של L1 בנתיבים המסחריים (ממומש, לא מתוכנן):**

- `createCampaign` — `campaigns.ts:134` (`assertEventNotPast`) + R9 ב-`:138`;
- `approveCampaign` — `campaigns.ts:269` + R9 ב-`:271`;
- `activateCampaign` — דרך `transitionCampaignStatus` (`campaigns.ts:645`) עם
  `{ rejectPastEvent: true, requireActiveEvent: true }` (`:693`); pause/close
  נשארים מותרים לאירוע שעבר — נתיבי wind-down, לפי החרגת R9;
- חתימת הסכם — `src/lib/data/agreements.ts:107`;
- J5 hold — `src/app/api/campaigns/[id]/authorize/route.ts:122`;
- שליחת WhatsApp — `src/app/api/campaigns/[id]/whatsapp-send/route.ts:72`;
- **ה-worker** (outreach engine) — `src/lib/data/outreach-engine.ts:149`
  (`isPastEventDay → { reason: 'stopped' }`) וכן `src/lib/data/outreach.ts:102`.

### L2 — שומרי RPC (מיגרציה `20260630164747_l2_rpc_event_date_guards_and_billing_integrity.sql`)

סוגר את הפרצות שחיות רק בשכבת ה-RPC (נתיבים שלא עוברים דרך L1):

- `get_rsvp_by_token` — מחזיר `can_respond` שמחושב גם מול יום האירוע וגם מול
  `rsvp_deadline` (Asia/Jerusalem), כך שטופס ה-RSVP הציבורי נסגר מעצמו;
- `submit_rsvp` — דוחה הגשה אחרי הדדליין (`reason: 'deadline_passed'`,
  שורות 156-158 במיגרציה) ואחרי יום האירוע (מוחזר כ-`closed`);
- `try_record_billed_result` — `event_mismatch` (האירוע נגזר מהקמפיין, לא
  מהקורא), `event_passed` (אין חיוב לאירוע שעבר, גם כש-`close_at` NULL),
  ומאז S1 גם `event_not_active` (R9) — הגרסה העדכנית בתוך
  `20260630223635_event_lifecycle_state_model.sql` Step 6.

---

## 6. סטטוס פריסה: מה מומש ומה מתוכנן

אומת מול `supabase migration list --linked` (local = remote עד
`20260630230249` כולל) ומול קטלוג ה-DB החי:

| פאזה (spec §8) | תוכן | סטטוס |
|---|---|---|
| **S0** — פריפלייט קריאה-בלבד | סט שאילתות V1a/V1b/V1c/V3/V4a/V4b/V5 + החלטות | **בוצע ונחתם** — `supabase/runbooks/event_lifecycle_s0_preflight.md` |
| **S1** — triggers ב-DB | R1,R2,R2b,R3,R5,R6,R7 על events; R9 על campaigns + RPC; R8 (trigger + `cancel_campaign`) | **פרוס בפרודקשן** (מיגרציה 20260630223635 applied; triggers אומתו חיים) |
| **S2** — אפליקציה + Zod | שומרי `createEvent`/`updateEvent`, `publishEvent`/`closeEvent`, `cancelCampaign`, שומרי R9, refines | **ממומש** (ראו §2–§3) |
| **S2.5** — רמדיאציית חריגי S0 | טיפול בחריג ec7c68d1 (קמפיין approved על אירוע draft) דרך מנגנוני R8/publish | **בוצע** — הרצה חוזרת של שאילתת V3 על ה-DB החי (2026-07-02) מחזירה 0 שורות |
| **S3** — UI | כפתורי Publish/Close במקום dropdown; נעילת תאריכים אחרי draft; כפתור Cancel-campaign מינימלי | **ממומש** — `event-status-actions.tsx`, `edit-event-form.tsx`, `cancelCampaignAction` |
| **S4** — אימות סופי | בדיקות trigger ב-PG מבודד + הרצה חוזרת של S0 | **חלקי**: בדיקות unit מקיפות קיימות (`events.test.ts`, `actions.test.ts`); V3 אומת ריק. בדיקות trigger ב-PostgreSQL מבודד — **מתוכנן, טרם מומש** (לא נמצאו בריפו) |

הערה: ה-checkpoint בזיכרון הפרויקט ("next = L1 for campaign/worker") התיישן —
הקוד מראה ש-L1 כבר פרוס בכל הנתיבים המסחריים וב-worker (ראו §5).

---

## 7. טבלת מעברי סטטוס (נאכף ע"י `events_guard_update`)

נגזר ישירות מה-SQL של ה-trigger במיגרציה
`supabase/migrations/20260630223635_event_lifecycle_state_model.sql` (Step 2):

| מ- \ אל- | `draft` | `active` | `closed` |
|---|---|---|---|
| **`draft`** | ✔ no-op (אין מעבר — ה-trigger בודק רק `IS DISTINCT FROM`) | ✔ מותר, בתנאי: `event_date` קיים ו≥ מחר בישראל; אסור לשנות `event_date`/`rsvp_deadline` באותו UPDATE; `rsvp_deadline` NULL או ≥ היום (re-check R2b) | ✔ מותר, בתנאי R7: אין קמפיין במצב חוסם |
| **`active`** | ✖ נדחה (`illegal event status transition`) | ✔ no-op | ✔ מותר, בתנאי R7 |
| **`closed`** | ✖ נדחה | ✖ נדחה | ✔ no-op (`closed` סופני) |

בנוסף, בכל UPDATE כש-`old.status <> 'draft'`: שינוי כלשהו ב-`event_date` או
`rsvp_deadline` נדחה (`R5 lock`), ללא תלות במעבר status.

**סט הקמפיינים החוסם של R7** (בדיוק כמו ב-trigger וכמו
`BLOCKING_CAMPAIGN_STATUSES` ב-`src/app/(customer)/app/events/[id]/page.tsx:15`):
`draft`, `pending_approval`, `approved`, `scheduled`, `active`, `paused`.
מצבי קמפיין שאינם חוסמים: `closed`, `awaiting_invoice`, `billed`, `paid`, `cancelled`.

מעברי קמפיין רלוונטיים למחזור החיים:

- INSERT/UPDATE של קמפיין למצב אופרטיבי (`pending_approval`…`paused`) מחייב
  אירוע `active` (trigger `campaigns_require_active_event`, R9);
- UPDATE ל-`cancelled` מותר רק מ-`draft`/`pending_approval`/`approved` ללא
  התחייבות כספית (trigger `campaigns_guard_cancel` + RPC `cancel_campaign`, R8).

---

## 8. ולידציית `rsvp_deadline` — כל נקודות האכיפה

האינווריאנט המשולב: `today_IL <= rsvp_deadline <= event_day_IL`, ודדליין מחייב
`event_date`. שש נקודות האכיפה בצד ה-DB (שני triggers, CHECK אחד ושלושה שערי RPC):

1. **CHECK `events_rsvp_deadline_within_event`** (LC-2, מיגרציה 20260630072729;
   בתוקף, אומת חי) — חסם עליון בלתי-מותנה על כל שורה: דדליין דורש `event_date`
   ו-≤ יום האירוע בישראל. CHECK ולא trigger כי הביטוי סטטי ו-IMMUTABLE.
2. **`events_before_insert`** — R2b בחסם התחתון בלבד (`>= today_IL`) ב-INSERT;
   בכוונה לא משכפל את ה-CHECK (החסם התחתון תלוי `now()` ולכן לא ניתן ל-CHECK).
3. **`events_guard_update` — ענף עריכת draft** — כל עריכת תאריכים ב-draft
   מפעילה מחדש את R2b (הורחב כך שגם עריכת הדדליין לבדה נבדקת).
4. **`events_guard_update` — re-check בפרסום** — גם כשהערכים לא השתנו,
   `today_IL` זז קדימה מאז השמירה; דדליין שהיה תקף עלול להיות נחות מהיום —
   הפרסום נדחה (`rsvp_deadline has elapsed`).
5. **`submit_rsvp`** (L2) — דוחה הגשת RSVP ציבורית אחרי הדדליין
   (`deadline_passed`), בהשוואת יום ישראלי.
6. **`get_rsvp_by_token`** (L2) — `can_respond=false` אחרי הדדליין (או אחרי יום
   האירוע), כך שהטופס מוצג נעול עוד לפני ניסיון הגשה.

מעל אלה: מראות Zod (ארבעת ה-refines ב-`updateEventSchema`, §3), מראות בשכבת
הנתונים (`events.ts:299,340`), ו-UX ב-`edit-event-form.tsx` — צימוד דו-כיווני
בין השדות (`min`/`max` דינמיים: לדדליין `min=todayIL`, `max=event_date`;
לתאריך האירוע `min = max(מחר, הדדליין שנבחר)`), ונעילה מלאה כשהאירוע אינו
draft (ה-input גם `disabled` וגם ללא `name`, כך שהמפתח לא נשלח כלל ב-POST).

---

## 9. ממשק הלקוח (`src/app/(customer)/app/`)

כל העמודים הם Server Components; אין שליפת נתונים עסקיים מהדפדפן.

- **דשבורד** — `app/page.tsx`: `Promise.all` של `getEventCounts()` (ספירות head
  על כלל האירועים) ו-`listEvents({ limit: 5 })` (תצוגה מקדימה). מצב ריק מטופל
  במפורש.
- **רשימת אירועים** — `app/events/page.tsx`: `listEvents()` (ברירת מחדל 20,
  ממוין `created_at desc`). *מגבלה ידועה:* אין עדיין UI לעימוד בעמוד זה, אף
  שהפונקציה תומכת ב-offset.
- **יצירת אירוע** — `app/events/new/` (`new-event-form.tsx` +
  `createEventAction`).
- **עמוד אירוע** — `app/events/[id]/page.tsx`: תגית סטטוס, תגית "האירוע חלף"
  (`isPastEventDay`), `EventStatusActions` (`event-status-actions.tsx`) — כפתור
  "פרסום האירוע" (מנוטרל בלי תאריך עתידי, R3) וכפתור "סגירת האירוע" עם confirm
  (מנוטרל עם רמז טקסטואלי כשיש קמפיין חוסם, R7); טופס עריכה
  (`edit-event-form.tsx`) עם נעילת תאריכים אחרי פרסום; ו-`CampaignSection`.
- **מוזמנים** — `app/events/[id]/guests/page.tsx`: קריאת `searchParams`
  (חיפוש/סינון/מיון/עמוד) והעברתם ל-`listGuests` (`src/lib/data/guests.ts:167`)
  — סינון, מיון (עמודות whitelist בלבד), חיפוש (עם סניטציה של תווי PostgREST)
  ועימוד — **כולם ב-DB**; קישורי העימוד משמרים את הסינון הנוכחי. תתי-עמודים:
  פרטי מוזמן, הוספה, וייבוא (`guests/import/`).
- **אין עמוד "דוחות/פעילות" ללקוח** נכון להיום — פיד הפעילות נצרך רק בצד
  האדמין (ראו §10). דוחות ללקוח — מתוכנן, טרם מומש.

---

## 10. תיעוד פעילות (audit) — `logActivity`

`logActivity` — `src/lib/data/activity.ts:35`. כותב שורה ל-`activity_log` דרך
הלקוח בהיקף הבקשה (תחת RLS של המשתמש). Best-effort ומתועד ככזה: כישלון כתיבה
לא מפיל את הפעולה העיקרית, ונרשם רק שם ה-action (בלי meta). חוזה מפורש:
**אין PII ב-meta** — מזהים וספירות בלבד.

פעולות מתועדות בדומיין האירועים והנלווים לו:

| Action | מקור |
|---|---|
| `event.created` | `events.ts:183` |
| `event.updated` | `events.ts:320` |
| `event.published` | `events.ts:357` |
| `event.closed` | `events.ts:379` |
| `guest.created` / `guest.updated` / `guest.deleted` / `guest.contact_status_updated` | `guests.ts:356/419/473/504` |
| `group.created` / `group.updated` / `group.deleted` | `guests.ts:563/600/630` |
| `guests.imported` | `guests/import/import-actions.ts:231` |
| `rsvp.submitted` | `rsvp.ts:142` (`recordRsvpAudit`) — נתיב נפרד במכוון: RSVP ציבורי הוא אנונימי, אין session ל-`requireUser`, ולכן נכתב דרך ה-admin client עם `user_id: null` ו-meta של מזהים בלבד |
| `settings.updated`, `profile.updated`, `profile.email_change_requested`, `password.reset_requested` | user-settings/profiles/settings actions |
| `admin.*`, `package.*`, `callback.status_updated`, `webhook.reprocess` | נתיבי אדמין |

צריכת הפיד: צד אדמין בלבד — `src/lib/data/admin/activity.ts`
(`listActivity:418` עם סינון/עימוד בצד השרת, `recentActivity:554` לדשבורד
האדמין, ו-`describeActivity:363` לתרגום לעברית).

---

## 11. בדיקות ומגבלות ידועות

- **בדיקות**: `src/lib/data/events.test.ts` מכסה את מראות R1/R2/R2b/R5/R6/R7
  בשכבת הנתונים (כולל דחיית forged-request על אירוע לא-draft, re-check R2b
  בפרסום, מיפוי חריגת R7, וגבולות `isPastEventDay` סביב חצות ישראל);
  `src/app/(customer)/app/events/[id]/actions.test.ts` מכסה את סמנטיקת נוכחות
  המפתח ב-action. בדיקות trigger ישירות מול PostgreSQL מבודד — **מתוכנן, טרם
  מומש**.
- **עימוד רשימת האירועים**: `listEvents` תומך offset אך לעמוד הרשימה אין עדיין
  בקרי עימוד (בפועל לא מגבלה עד ~20 אירועים למשתמש).
- **מחיקת אירוע**: לא קיימת; `closed` הוא הסיום. זהו עיצוב מכוון (auditability),
  לא פער.
- **`requireEventAccess`** קיים ומוכן, אך רוב הנתיבים עדיין משתמשים
  ב-`requireOwnedEvent` (בעלים בלבד) עד הרחבת ה-RLS לחברות ארגונית (Phase 3
  של המולטי-טננסי — מתוכנן, טרם מומש).
- **V5 (יותר מקמפיין אחד לא-מבוטל לאירוע)** נשאר informational בלבד לפי ה-spec —
  קונבנציית "קמפיין אחד לאירוע" נאכפת אפליקטיבית, לא ב-DB.
