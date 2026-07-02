# 06 — קמפיינים ומנוע ה‑Outreach

מסמך זה מתעד את דומיין הקמפיינים ("אישורי הגעה") ואת מנוע ה‑Outreach של KALFA Event Magic: מודל הקמפיין היחיד‑לאירוע, תהליך האישור והחתימה, תבניות ומדיניות הפניות, מנוע העבודה מבוסס pg‑boss, תהליך ה‑worker, בקרות ההסכמה, ורישום "reached" לחיוב. התיעוד הופק מקריאה ישירה של הקוד, המיגרציות וה‑DB החי נכון ל‑2026‑07‑02. פריטים שקיימים רק בתכנון מסומנים "מתוכנן, טרם מומש".

מסמכים משלימים: `07-messaging-channels.md` (WhatsApp/SMS/Email ברמת הספק), `08-billing-and-payments.md` (SUMIT, J5 hold, גמר חשבון), `10-api-and-webhooks.md` (אינוונטר ה‑routes).

## 1. מהות הקמפיין והמודל העסקי

קמפיין ב‑KALFA הוא **"אישור קמפיין" מסחרי אחד לאירוע** — לא ישות שיווקית חוזרת. הוא מייצג את הסכמת בעל האירוע לשירות אישורי ההגעה במודל **חיוב מבוסס‑תוצאה (outcome billing)**: תשלום רק על **איש קשר שהושג** (התקבלה ממנו תגובה אנושית), עד תקרת חיוב שנגזרת בשרת. אין רכישת חבילה מראש ואין מנוי.

עקרונות מחייבים (נאכפים בקוד):

- **המחיר, הערוצים ולוח הפניות הם נתוני admin ב‑DB** (`packages`, `app_settings`, `message_templates`) — לעולם לא hardcoded בקוד או ב‑UI (`src/lib/data/campaigns.ts:97-119`).
- **כל כתיבה כספית עוברת דרך שרת** (service‑role client או RPC נעול), אחרי בדיקת בעלות מפורשת; RLS משמש לקריאה בלבד עבור הבעלים (`campaigns.ts:14-17`).
- **תקרה, hold ו"מערך מורשים" נגזרים בשרת** — אף ערך כספי אינו מתקבל מהדפדפן.

### 1.1 מפת הקבצים של הדומיין

| קובץ | תפקיד |
|---|---|
| `src/lib/data/campaigns.ts` | שכבת הנתונים של הקמפיין: יצירה, מעברי סטטוס, hold, גמר חשבון, תבניות |
| `src/lib/data/outreach-engine.ts` | שכבת ההחלטות של המנוע (C1): שערים, cursor, ביצוע צעד, reach |
| `src/lib/data/outreach.ts` | שליחת WhatsApp בפועל (בודד + batch) ורישום interactions |
| `src/lib/data/outreach-config.ts` | קריאת הדגלים והקונפיג מ‑`app_settings` (fail‑closed) |
| `src/lib/data/message-templates.ts` | פתרון `message_key` → תבנית Meta/script; ניהול admin |
| `src/lib/data/contacts.ts` | גזירת contacts ממוזמנים, consent, המערך המורשה הקפוא |
| `src/lib/data/billing.ts` | `recordReached` (ה‑RPC) + סיכום חיוב + זיכויים |
| `src/lib/data/close-charge.ts` | גמר חשבון: סגירה + capture של הכרטיס התפוס |
| `src/lib/data/campaign-delivery.ts` | לוח המסירה B8 (funnel + תוצאות contact) |
| `src/lib/data/webhooks.ts`, `webhook-processing.ts` | intake ועיבוד out‑of‑band של אירועי Meta |
| `src/lib/outreach/schedule.ts` | מתמטיקת לו"ז טהורה + det‑id |
| `src/lib/queue/queues.ts` | שמות תורים + מדיניות retry (קבועים) |
| `worker/main.ts` | תהליך ה‑pg‑boss (pm2 `kalfa-worker`) |
| `src/app/(customer)/app/events/[id]/campaign*` | ה‑UX: מקטע האירוע, actions, approve/payment/manage |
| `src/app/api/campaigns/[id]/{authorize,whatsapp-send,close-charge}` | Route Handlers מגודרי בעלות |
| `src/app/api/webhooks/whatsapp/route.ts` | ה‑webhook הנכנס של Meta |

## 2. מודל הנתונים והסטטוסים

### 2.1 טבלת `campaigns`

הטבלה הורחבה במיגרציה `supabase/migrations/202606240007_outcome_billing_schema.sql:36-60` ובהמשכים. עמודות מרכזיות:

| קבוצה | עמודות | הערות |
|---|---|---|
| זהות ומצב | `event_id`, `status`, `template_id` | `template_id → packages(id)` (FK חי, אומת מול `pg_constraint`) |
| תנאים מסחריים (נעולים) | `price_per_reached`, `max_contacts`, `max_charge_ceiling`, `allowed_channels`, `outreach_schedule` | מועתקים מה‑template הקנוני ביצירה; לא ניתנים לעריכת בעלים |
| חלון פעילות | `start_at`, `close_at` | `close_at` = תאריך האירוע (`campaigns.ts:171`) |
| אישור | `tos_version`, `approved_by`, `approved_at` | נכתבים ב‑`approveCampaign` |
| Hold (J5) | `capture_status`, `auth_number`, `auth_amount`, `card_token_ref`, `card_exp_month/year`, `card_citizen_id`, `auth_external_ref`, `authorized_at` | ראו `08-billing-and-payments.md` |
| גמר חשבון | `charge_status`, `final_charge_amount`, `sumit_charge_document_id`, `charge_document_url`, `charged_at` | |

### 2.2 enum הסטטוסים `campaign_status`

מוגדר ב‑`202606240007_outcome_billing_schema.sql:12-16`:

`draft`, `pending_approval`, `approved`, `scheduled`, `active`, `paused`, `closed`, `awaiting_invoice`, `billed`, `paid`, `cancelled`

בפועל, הזרימה הממומשת משתמשת ב: `pending_approval` (יצירה) → `approved` (חתימה+אישור) → `active` ↔ `paused` → `closed`, ובנוסף `cancelled` (ביטול R8). הערכים `draft`, `scheduled`, `awaiting_invoice`, `billed`, `paid` קיימים ב‑enum וב‑labels של ה‑UI (`campaign-section.tsx:13-25`) אך אין נתיב קוד שמייצר אותם כיום.

מעברי הסטטוס ממומשים כ‑guarded UPDATE אטומי (`transitionCampaignStatus`, `campaigns.ts:645-688`) — ה‑UPDATE תופס רק שורה שנמצאת באחד ממצבי המקור, כך ששני קליקים מקבילים לא יבצעו מעבר כפול:

| פעולה | ממצב | למצב | תנאים נוספים | מקור |
|---|---|---|---|---|
| `approveCampaign` | `pending_approval` | `approved` | הסכם חתום כבר נרשם; אירוע `active` ולא עבר | `campaigns.ts:250-290` |
| `activateCampaign` | `approved`/`scheduled`/`paused` | `active` | **`capture_status='authorized'`** (אין outreach בלי אמצעי תשלום תפוס), אירוע `active` ולא עבר | `campaigns.ts:693-702` |
| `pauseCampaign` | `active` | `paused` | — | `campaigns.ts:704-706` |
| `closeCampaign` | `active`/`paused`/`approved`/`scheduled` | `closed` | מותר גם לאירוע סגור/עבר (wind‑down) | `campaigns.ts:710-716` |
| `cancelCampaign` | `draft`/`pending_approval`/`approved` | `cancelled` | דרך RPC `cancel_campaign` בלבד; אסור כשיש התחייבות כספית | `campaigns.ts:726-743` |

שכבת DB מקבילה (defense‑in‑depth, `20260630223635_event_lifecycle_state_model.sql`):

- טריגר `campaigns_require_active_event` (R9, שורות 121‑135): כל INSERT/UPDATE למצב תפעולי (`pending_approval`…`paused`) נדחה אם האירוע אינו `active`.
- טריגר `campaigns_guard_cancel` (R8, שורות 147‑163): מעבר ל‑`cancelled` נחסם אם יש hold תפוס/בתהליך, `charge_status` כלשהו, או שורות `billed_results`.
- RPC `public.cancel_campaign(uuid)` (שורות 165‑187): `SECURITY DEFINER`, EXECUTE **ל‑service_role בלבד** — האכיפה מבוצעת באפליקציה לפני הקריאה (`getCampaignForHold` → `requireOwnedEvent`, `campaigns.ts:726-733`).
- טריגר `events_guard_update` (R7, שורות 76‑80): אי אפשר לסגור אירוע כשקיים קמפיין תפעולי.

בנוסף לסטטוס הראשי, לקמפיין שני מסלולי מצב כספיים אורתוגונליים (עמודות טקסט חופשי עם אוצר מילים עבודה, `campaigns.ts:292-298, 570-586`):

| עמודה | ערכים | משמעות |
|---|---|---|
| `capture_status` (hold J5) | `null` → `pending` → `authorized` / `hold_failed` / `hold_review` | `pending` הוא המנעול האטומי; `hold_failed`/`hold_review` ניתנים לניסיון חוזר; `authorized` הוא תנאי ההפעלה |
| `charge_status` (גמר חשבון) | `null` → `pending` → `charged` / `charge_failed` / `charge_review` / `nothing_to_charge` | `charged` סופי — קמפיין שחויב לא ייתפס שוב (`lockCampaignForCharge`) |

### 2.3 קמפיין אחד לאירוע (singleton)

האכיפה כיום היא **אפליקטיבית** בשני מנגנונים:

1. `createCampaign(eventId)` הוא **create‑or‑continue אידמפוטנטי**: אם קיים קמפיין לא‑מבוטל לאירוע — הוא מוחזר כמות שהוא, ולא נוצר שני (`campaigns.ts:129-181`, ובפרט 142‑144).
2. `getCampaignForEvent` מחזיר את הקמפיין הלא‑מבוטל האחרון (`.neq('status','cancelled')`, `campaigns.ts:216-231`) — ביטול משחרר את האירוע לקמפיין עתידי.

**אילוץ DB — מתוכנן, טרם מומש:** ה‑spec (`plans/campaign-rework-spec.md` §7.2) מגדיר `CREATE UNIQUE INDEX ... ON campaigns(event_id) WHERE status <> 'cancelled'`, אך אימות מול ה‑DB החי (`pg_indexes`, `pg_constraint`, 2026‑07‑02) מראה שעל `campaigns` קיימים רק `campaigns_pkey` ושני FK — **האינדקס החלקי לא הוחל**. ההערה ב‑`campaigns.ts:215` ("mirrors the partial UNIQUE") מתארת את הכוונה, לא את המצב החי. מרוץ בין שתי לשוניות מוגן כיום רק ברמת ה‑read‑then‑insert האפליקטיבי.

### 2.4 טבלאות נלוות

| טבלה | תפקיד | מיגרציה |
|---|---|---|
| `contacts` | איש קשר ייחודי לפי `(event_id, normalized_phone)` (E.164); `op_status` תפעולי (§11), `removal_requested`, `whatsapp_consent_at` | `202606240007:70-96`, `202606290028:37` |
| `campaign_authorized_contacts` | **המערך המורשה הקפוא** — cap מחייב על reached; `UNIQUE(campaign_id, contact_id)` | `202606290024:19-45` |
| `outreach_state` | הסמן (cursor) של המנוע לכל `(campaign, contact)`: `status`, `current_step_index`, מוני שליחות; `UNIQUE(campaign_id, contact_id)` | `202606290032` |
| `contact_interactions` | יומן ניסיונות/אירועי ספק (רשומת ניסיון הודעה): in/out, `provider_id`, `delivery_status`, `billable`; dedup ב‑`UNIQUE(channel, provider_id)` | `202606240007:129-153` |
| `billed_results` | **מקור האמת לחיוב** — שורה = reach מחויב; `UNIQUE(event_id, contact_id)` | `202606240007:99-126` |
| `billing_credits` | זיכויים (append‑only) המקוזזים בגמר חשבון | `202606240007:156-174` |
| `signed_agreements` | ראיות חתימה (hash, IP, UA, PDF ref) — admin‑only RLS | `202606240007:179-201` |
| `webhook_inbox` | persist‑then‑process לאירועי Meta | `202606290035`, claim ב‑`202606300036` |

הערה: אין טבלה בשם `message_attempts` — רישום הניסיונות מפוצל בין `contact_interactions` (כל הודעה שנשלחה/התקבלה + סטטוס מסירה) לבין המונים ב‑`outreach_state` (`whatsapp_sent_count`, `call_request_count`).

מצבי ה‑cursor ב‑`outreach_state.status` (`202606290032:17`, נכתבים ב‑`setOutreachStatus`, `outreach-engine.ts:180-197`):

| ערך | משמעות | `stop_reason` אופייני |
|---|---|---|
| `active` | ה‑contact עדיין בתוך הרצף | — |
| `reached` | נרשם reach מחויב — עצירה סופית (+`reached_at`) | `reached` |
| `stopped` | הקמפיין/האירוע נעצר (סגירה, השהיה גלובלית, אירוע עבר) | `closed` |
| `exhausted` | כל ה‑touchpoints מוצו ללא reach | — |
| `not_eligible` | לא זכאי (ללא consent / הוסר) | `removal_requested` / `consent_revoked` |

## 3. יצירה, אישור וחיתום — ה‑workflow המלא

### 3.1 יצירה ("הפעלת אישורי הגעה")

נקודת כניסה יחידה: `CampaignSection` בעמוד האירוע (`src/app/(customer)/app/events/[id]/page.tsx:119`, `campaign-section.tsx`) → `setupCampaignAction(eventId)` (`campaign/campaign-actions.ts:46-66`) → `createCampaign(eventId)` (`src/lib/data/campaigns.ts:129-181`). אין שום קלט טופס מהמשתמש:

1. `requireOwnedEvent` + `assertEventNotPast` (L1) + דרישת `event.status='active'` (R9).
2. create‑or‑continue (§2.3).
3. `max_contacts` נגזר מ‑`countUniqueContactsForEvent` — ספירת טלפונים ייחודיים מרשימת המוזמנים (`contacts.ts:214-225`); נדרש ≥ 1.
4. ה‑template **הקנוני** נפתר ב‑`resolveCanonicalTemplate` (`campaigns.ts:236-243`) — הבעלים אינו בוחר מסלול.
5. INSERT במצב `pending_approval` עם העתקה נעולה של מחיר/ערוצים/לו"ז ותקרה `computeCeiling(price, maxContacts)` (`campaigns.ts:45-47`); `close_at` = תאריך האירוע.
6. redirect ל‑`/app/events/[id]/campaign/[campaignId]/approve`.

### 3.2 חתימה על ההסכם (תנאי לאישור)

עמוד `approve/page.tsx` מציג את התנאים (מחיר ל‑reached, `max_contacts`, תקרה, ערוצים, חלון) ואת גוף ההסכם המרונדר מ‑DB (`getActiveAgreementDoc`, `renderAgreementBody`). החתימה — `signAgreementAction` (`campaign-actions.ts:98-157`):

1. `tos_version` נקבע בשרת מגרסת מסמך ההסכם הפעיל — לא מהדפדפן.
2. Zod (`approveCampaignSchema`) מאמת **שלוש הסכמות מפורשות** (terms / privacy / authorization) + חתימת canvas (`data:image/...`) + קוד OTP בן 6 ספרות.
3. `recordSignedAgreement` (`src/lib/data/agreements.ts:57` ואילך): אימות OTP לטלפון שבפרופיל (purpose `agreement_signing`, SMS דרך ExtrA), רינדור PDF עברי מלא, `sha256` על הבייטים, העלאה ל‑bucket פרטי, כתיבת שורת `signed_agreements` ראייתית (טלפון מאומת, IP, user‑agent, hash), ושליחת ההסכם במייל כקישור מאובטח.
4. רק בסוף — `approveCampaign` (`campaigns.ts:250-290`): מעבר race‑safe ל‑`approved` עם `approved_by/approved_at/tos_version`. קמפיין מאושר **אינו ניתן לאישור מחדש** — התנאים ננעלים.

### 3.3 שער החיוב: hold לפני הפעלה

אחרי החתימה המשתמש מנותב ל‑`payment/` → POST `/api/campaigns/[id]/authorize` (J5 hold ב‑SUMIT; מפורט ב‑`08-billing-and-payments.md`). מנקודת מבט הקמפיינים:

- `lockCampaignForHold` תופס אטומית את משבצת ה‑hold (`capture_status: null/hold_failed/hold_review → pending`, `campaigns.ts:324-335`).
- `prepareCampaignHold` (`campaigns.ts:465-521`) מריץ בצעד אחד: חישוב `full` עדכני, שליפת knobs מנוהלי‑admin (`app_settings.reasonable_coverage_contacts`, `packages.min_hold_floor/hold_buffer_pct` — fail‑safe כלפי hold גבוה), **הקפאת המערך המורשה** `snapshotAuthorizedSet` (semantics של REPLACE — top‑`covered` דטרמיניסטי, `contacts.ts:344` ואילך), עדכון `max_contacts`/`max_charge_ceiling`, וחישוב `holdAmount = max(floor, covered × price × (1+buffer))` (`computeHoldAmount`, `campaigns.ts:66-75`).
- **אינווריאנט הבטיחות**: ה‑hold מכסה רק את `covered`, אבל זה בטוח כי המערך הקפוא הוא ה‑cap המחייב על reached בכל נתיבי ה‑outreach והחיוב (reached ⊆ authorized ⊆ covered), בעוד התקרה נשארת `full × price`.
- `activateCampaign` דורש `capture_status='authorized'` — **אין outreach בלי מסגרת תפוסה**.

סיכום הנוסחאות (כולן פונקציות טהורות עם בדיקות יחידה, `campaigns.ts:45-75`; העיגול לאגורות):

```text
full     = מספר הטלפונים הייחודיים ברשימת המוזמנים (נגזר, לא קלט)
ceiling  = full × price_per_reached                 -- תקרת החיוב המקסימלית
covered  = min(full, reasonable_coverage_contacts)  -- הבסיס למערך הקפוא ול-hold
hold     = max(min_hold_floor, covered × price × (1 + hold_buffer_pct))
charge   = max(0, min(Σ locked_price, ceiling) − Σ credits)   -- בגמר חשבון
```

ערכי ה‑knobs החיים (admin, `app_settings`/`packages`): `reasonable_coverage_contacts = 300`, `extreme_threshold_contacts = 400`, `min_hold_floor = 0`, `hold_buffer_pct = 0`. בחירת בעלים מפורשת להרחבת כיסוי מעל ה‑extreme threshold מסומנת בקוד כ‑Phase 3 — מתוכנן, טרם מומש (`contacts.ts:340-343`).

## 4. תבניות קמפיין, ערוצים ומדיניות פניות

### 4.1 תבניות מסחריות (`packages`)

תבנית קמפיין = שורת `packages` פעילה עם `price_per_reached` לא‑NULL, הנושאת `channels` (enum `campaign_channel`: `whatsapp` | `call`), `outreach_schedule` (JSONB) וכלכלת hold. `listCampaignTemplates` (`campaigns.ts:97-119`) קורא אותן דרך ה‑admin client; `resolveCanonicalTemplate` בוחר את הראשונה לפי `sort_order`. הכל נתוני admin — שינוי מחיר/לו"ז אינו דורש קוד.

נכון ל‑2026‑07‑02 קיימות ב‑DB החי שתי תבניות מתומחרות (₪4 ל‑reached, ערוצים `{whatsapp,call}`); הקנונית היא "אישורי הגעה — וואטסאפ + שיחות AI". הערכים הם snapshot של נתוני admin וניתנים לכוונון ב‑DB בלבד.

### 4.2 מדיניות הפניות (attempt policy) — מה בתוקף בפועל

**חשוב:** המדיניות המקורית של מרווחים קבועים — "2 הודעות WhatsApp במרווח 24h → אסקלציה לשיחה אחרי 48h → עד 2 שיחות במרווח 4h" — הוגדרה במיגרציה `202606240011_attempt_policy.sql` אך **בוטלה במלואה**: מיגרציה `202606240014_outreach_schedule.sql:24-36` **מחקה את כל עמודות המדיניות הזו** (`whatsapp_attempts`, `whatsapp_reminder_gap_hours`, `escalation_delay_seconds`, `call_attempts`, `call_retry_gap_hours`) והחליפה אותן בלו"ז touchpoints **מעוגן בתאריך האירוע**.

המדיניות בתוקף היא `outreach_schedule` — מערך JSONB של `{days_before, channel, message_key}`, מוגדר על ה‑template, מועתק ונעול על הקמפיין ביצירה. הערך החי (אומת ישירות מול `packages` ב‑DB, זהה ל‑seed של המיגרציה; admin רשאי לכוונן):

| # | `days_before` (לפני האירוע) | `channel` | `message_key` |
|---|---|---|---|
| 0 | 10 | whatsapp | `invite` |
| 1 | 6 | whatsapp | `reminder_1` |
| 2 | 3 | whatsapp | `reminder_2` |
| 3 | 2 | call | `call_1` |
| 4 | 1 | whatsapp | `final` |

מועד כל touchpoint = `event_date − days_before × 24h` (`touchpointTime`, `src/lib/outreach/schedule.ts:16-18`). עריכת תאריך האירוע ממקמת מחדש את הפניות הבאות, כי הזמנים נגזרים תמיד מה‑`event_date` החי. תגובה אנושית מאומתת עוצרת את כל הרצף (stop‑on‑reach, §6.3).

### 4.3 תבניות הודעה (`message_templates`)

`message_key` שבלו"ז נפתר לתוכן שליחה דרך `getTemplateByKey` (`src/lib/data/message-templates.ts:15-28`): שם תבנית Meta מאושרת + שפה (WhatsApp) או script (שיחה). רק תבניות `active=true` נפתרות — **fail‑closed**: מפתח שלא הוגדר לא שולח דבר. ניהול ב‑`/admin/templates` (`listMessageTemplates`/`updateMessageTemplate`, אכיפת `requireAdmin`).

## 5. מנוע ה‑Outreach (C1) — ארכיטקטורה

Spec: `plans/outreach-engine-c1-spec.md` (ממומש). חלוקת אחריות:

- **שכבת ה‑web (Next.js) נקייה מ‑pg‑boss** — היא רק משנה שורות DB (סטטוס קמפיין, קונפיג).
- **`src/lib/queue/queues.ts`** — קבועים טהורים: שמות תורים ומדיניות retry (ללא import של pg‑boss, בטוח לכל צד).
- **`src/lib/outreach/schedule.ts`** — מתמטיקת הלו"ז, טהורה וללא I/O: `touchpointTime`, `nextTouchpointIndex` (שורות 22‑39), `firstDueIndex` (44‑67, כולל fire‑first‑now כשהכול בעבר), ו‑`detId` (75‑89) — UUIDv5 דטרמיניסטי לכל `(campaign, contact, step)`.
- **`src/lib/data/outreach-engine.ts`** — שכבת ההחלטות/DB, request‑free (בלי cookies/`requireUser`; רצה מה‑worker עם service‑role).
- **`worker/main.ts`** — התהליך היחיד שמחזיק pg‑boss ומבצע `send`/`work`/`schedule`.

### 5.1 תורים וסוגי jobs

מוגדרים ב‑`src/lib/queue/queues.ts:3-11`; ה‑worker יוצר את כולם ב‑boot (`worker/main.ts:174-176`):

| Queue | Payload | Handler | תזמון | תפקיד |
|---|---|---|---|---|
| `outreach-arm` | — | `handleArm` | cron `* * * * *` | זריעה עצמית‑מרפאת: לכל קמפיין `active` — seed של `outreach_state` מהמערך הקפוא + enqueue הצעד הנוכחי של כל contact פעיל (אידמפוטנטי דרך det‑id) |
| `outreach-step` | `{campaignId, contactId, eventId, stepIndex}` | `handleStep` | `startAfter` = מועד ה‑touchpoint | ביצוע touchpoint אחד ל‑contact אחד + תזמון הבא |
| `outreach-sweeper` | — | `handleArm` (אותו handler) | cron `*/5 * * * *` | רשת ביטחון נוספת לאותה זריעה |
| `outreach-call-request` | `OutreachCallRequest` (`queues.ts:23-30`) | **אין consumer** | — | ממשק ל‑C2 (שיחות AI) — נכתב אליו, לא נצרך (§9) |
| `outreach-dead` | jobs שכשלו סופית | אין (dead‑letter) | — | יעד ה‑`deadLetter` של `outreach-step` |
| `webhook-process` | — | `handleWebhook` | cron `* * * * *` | ניקוז `webhook_inbox` (persist‑then‑process) |

### 5.2 מדיניות retry/backoff

`STEP_RETRY` (`queues.ts:15-20`): `retryLimit: 3`, `retryBackoff: true` (מעריכי), `retryDelayMax: 300` שניות, `deadLetter: 'outreach-dead'`. בשילוב עם compare‑and‑advance ומזהה ה‑job הדטרמיניסטי, retries הם at‑most‑once‑effective: ניסיון חוזר שכבר "הפסיד" את הצעד לא ישלח שוב.

### 5.3 מחזור חיים של צעד (`handleStep`, `worker/main.ts:62-110`)

1. **שער** — `stepGate` (`outreach-engine.ts:134-157`): `outreach_enabled` כבוי → `paused` (re‑enqueue בעוד 5 דקות); קמפיין לא `active` / `close_at` עבר / **יום האירוע עבר לפי ה‑`event_date` החי** (L1) / אירוע לא `active` (R9) → `stopped`; ה‑contact כבר reached → `reached` (עצירה סופית).
2. **schedule‑next‑FIRST** — הצעד הבא (`nextTouchpointIndex`) מתוזמן **לפני** הביצוע, עם `id: detId(...)` — כך כשל שליחה לעולם לא שובר את השרשרת, וכפילות enqueue היא no‑op (`ON CONFLICT (name,id) DO NOTHING` של pg‑boss).
3. **ביצוע** — `executeStep` (`outreach-engine.ts:232-294`): שליפת ה‑contact, דילוג אם `removal_requested` או ללא `whatsapp_consent_at` (לערוץ whatsapp) או ערוץ שאינו ב‑`allowed_channels`; ואז `claimStep` — UPDATE אטומי שמקדם את `current_step_index` רק אם הוא עדיין `stepIndex` (`outreach-engine.ts:161-178`); רק המנצח שולח. WhatsApp → `sendOneWhatsApp` (`src/lib/data/outreach.ts:23-61`, רישום interaction יוצא לא‑billable עם dedup); `call` → enqueue ל‑`outreach-call-request`.
4. אם אין touchpoint עתידי — `setOutreachStatus(..., 'exhausted')`.

העיקרון המוצהר: **at‑most‑once** — עדיף nudge שהוחמץ על פני הודעה כפולה; הלו"ז רב‑הנקודות מכסה את עצמו (`outreach-engine.ts:228-231`).

### 5.4 שליחה ידנית (interim)

`POST /api/campaigns/[id]/whatsapp-send` (`src/app/api/campaigns/[id]/whatsapp-send/route.ts`) — שליחת תבנית יזומה ע"י הבעלים לכלל הזכאים, עם אותם שערים (origin/CSRF, בעלות, gate כפול, L1/R9) ואותה כבילה למערך הקפוא דרך `listSendableContacts(eventId, campaignId)` (INNER JOIN ל‑`campaign_authorized_contacts`, `contacts.ts:265-302`). הוגדר כפתרון ביניים עד המנוע; נשמר כ"שלח עכשיו" ידני.

## 6. תהליך ה‑worker (`kalfa-worker`)

### 6.1 בנייה והרצה

- Entrypoint: `worker/main.ts`; נבנה עם esbuild ל‑bundle יחיד `dist/worker.cjs` — `server-only`, `next/headers`, `next/cache` ממופים ל‑stub ריק (`worker/empty.js`), `pg-native` חיצוני (`package.json:11`, script `worker:build`).
- הרצה: `node dist/worker.cjs` תחת **pm2 בשם `kalfa-worker`**, לצד `kalfa-beta` (האפליקציה, פורט 3002). ה‑deploy (`package.json:10`) בונה ומפעיל מחדש את שניהם; לוגים: `npm run worker:logs`.
- התהליך טוען `.env.local` בעצמו (Next לא רץ שם; `worker/main.ts:37-53`).
- Shutdown חינני: SIGTERM/SIGINT → `boss.stop({graceful:true, timeout:30000})`.

### 6.2 חיבור למסד

`new PgBoss({...})` (`worker/main.ts:160-170`) עם `host: SUPABASE_DB_HOST`, `port: SUPABASE_DB_PORT` (ברירת מחדל 5432), `user: SUPABASE_DB_USER`, `database: postgres`, `ssl`, `schema: 'pgboss'`, `application_name: 'kalfa-worker'`, `max: 4`.

**אילוץ תפעולי קריטי:** הערכים חייבים להצביע על **ה‑session pooler** של Supabase — `aws-1-ap-south-1.pooler.supabase.com:5432` עם user בתבנית `postgres.<project-ref>` (IPv4). המארח הישיר `db.<ref>.supabase.co` הוא **IPv6‑only** ואינו נגיש מהשרת — חיבור אליו גורם ל‑`ENETUNREACH` ו‑crash‑loop של ה‑worker. חובה session pooler (5432) ולא transaction pooler (6543), כי pg‑boss תלוי ב‑session state ו‑advisory locks. (ערכי הסודות עצמם ב‑`.env.local` בלבד.)

### 6.3 עצירה על reach והיגיינת המנוע

- ההגנה האמיתית מפני שליחה לאחר reach היא **בדיקת זמן‑ביצוע**: `stepGate` בודק `billed_results` לכל צעד (`isContactReached`, `outreach-engine.ts:119-130`) — לא ביטול jobs.
- `writeReach` (`outreach-engine.ts:300-306`) — הנתיב המשותף לשני הערוצים: קורא ל‑`recordReached` (ה‑RPC, §8) ועל `billed` מעדכן `outreach_state` ל‑`reached`.
- `handleArm` הוא self‑healing: גם אם ה‑worker היה כבוי או job אבד, ה‑cron הדקתי זורע מחדש את הצעד הנוכחי של כל contact פעיל, וה‑det‑id מונע כפילות.

### 6.4 ניקוז webhooks (persist‑then‑process)

הצד הנכנס בנוי בשני שלבים מופרדים בכוונה:

1. **Intake** — `POST /api/webhooks/whatsapp` (`src/app/api/webhooks/whatsapp/route.ts`): מאמת חתימת `X-Hub-Signature-256` (HMAC עם `whatsapp_app_secret`; זהו האימות — אין session/CSRF), מנרמל **את כל** האירועים שב‑payload המקובץ (איטרציה ידנית על `PostData` — לא ה‑dispatcher של הספרייה, שמפיל אירועים בקבצים), כותב שורות ל‑`webhook_inbox` עם `dedupe_key` (`wa-msg:<id>` / `wa-status:<id>:<status>`), ומחזיר 200 מהר. fail‑closed: outreach כבוי או חתימה חסרה/שגויה → לא נכתב דבר.
2. **עיבוד** — `handleWebhook` (`worker/main.ts:116-127`) בתור `webhook-process` קורא `claimUnprocessedWebhookEvents(50)` — RPC `claim_webhook_events` עם `FOR UPDATE SKIP LOCKED` (`202606300036`), כך ששני workers לא יתפסו אותה שורה — ומריץ `processWebhookEvent` על כל שורה; כשל בשורה אחת מעלה את מונה ה‑attempts שלה (עם `last_error`) בלי לחסום את השאר. שום payload אינו נרשם ללוג.

עיבוד סטטוסי מסירה (`processStatus`, `webhook-processing.ts:170-190`): סטטוס `sent`/`delivered`/`read` מעדכן `delivery_status` על ההודעה היוצאת (last‑write‑wins פר `provider_id`); `failed` שומר גם את קוד השגיאה הגולמי, וקוד `131026` ("Message undeliverable") — היחיד ב‑`WRONG_NUMBER_CODES` (`webhook-processing.ts:47`) — מסמן את ה‑contact כ‑`wrong_number` (שמרני במכוון; הקוד הגולמי נשמר תמיד לביקורת).

## 7. זרימת ה‑UX ללקוח

1. **עמוד האירוע** — מקטע `CampaignSection`: ללא קמפיין → CTA יחיד "הפעלת אישורי הגעה"; עם קמפיין → כרטיס מצב (Badge עברי לפי סטטוס) ו‑CTA הקשרי שמצביע תמיד על הצעד הבא — `pending_approval` → "המשך לאישור וחתימה"; `approved` בלי hold → "תפיסת מסגרת לתשלום"; `approved` עם hold → "הפעלת הקמפיין" (`campaign-section.tsx:42-58`).
2. **`/campaign/[campaignId]/approve`** — תצוגת התנאים (מחיר, `max_contacts`, תקרה, ערוצים, חלון), גוף ההסכם (sheet), בקשת OTP (`requestSigningOtpAction`), חתימה + שלוש הסכמות → `signAgreementAction` → redirect לתשלום.
3. **`/campaign/[campaignId]/payment`** — טופס פרטי כרטיס (SUMIT token) → `POST /api/campaigns/[id]/authorize` (J5).
4. **`/campaign/[campaignId]`** — מסך הניהול (`page.tsx`, `manage-client.tsx`): פעולות `activate`/`pause`/`close`/`settle` (Server Actions כרוכות ל‑ids בצד השרת), סיכום חיוב (`getCampaignBillingSummary` — reached/accrued/ceiling) ולוח מסירה B8 (`getCampaignDeliveryBreakdown`, `src/lib/data/campaign-delivery.ts:112-163`): funnel מצטבר sent ≥ delivered ≥ read + failed, ותוצאות ברמת contact (reached / wrong_number / opted‑out). שניהם fail‑soft — כשל בקריאה לא מפיל את העמוד.
5. **ביטול** — `cancelCampaignAction` (R8) זמין למצבים ללא התחייבות כספית.

ולידציה: קלטי הטפסים עוברים Zod (`src/lib/validation/campaigns.ts` — `approveCampaignSchema`, `authorizeHoldSchema`, `whatsappSendSchema`); הודעות שגיאה עבריות בטוחות בלבד; ערכים מסחריים לעולם לא מגיעים מהדפדפן.

## 8. הסכמה (consent) וציות

- **הסכמה פר‑ערוץ:** `contacts.whatsapp_consent_at` (timestamp; `202606290028:37`). האכיפה fail‑closed בשני הנתיבים: `executeStep` מדלג על contact ללא consent לערוץ whatsapp (`outreach-engine.ts:249-251`), ו‑`listSendableContacts` מסנן `whatsapp_consent_at IS NOT NULL` + `removal_requested=false` (`contacts.ts:280-296`).
- **פער מומש‑חלקית:** פונקציית הרישום `recordWhatsAppConsent` (`contacts.ts:245-256`) קיימת ונבדקת, אך **אין לה caller בקוד הייצור** — טרם חוּוט מסך/תהליך שרושם הסכמה. עד אז, contact ללא consent פשוט לא יקבל הודעות (fail‑closed). — השלמת ה‑UX: מתוכנן, טרם מומש.
- **Opt‑out:** תשובת הסרה נכנסת **מחויבת קודם** (היא reach אנושי — כלל D4) ורק אחר כך `markContactRemovalRequested` עוצר כל פנייה עתידית (`webhook-processing.ts:120-127`); `removal_requested` נבדק גם ב‑RPC החיוב וגם בכל שליחה.
- **טרנזקציוני מול שיווקי:** הודעות הקמפיין הן תבניות Meta מאושרות, ממוקדות לאירוע ולמוזמניו בלבד, ותחומות במערך המורשה הקפוא של הקמפיין — לא ניתן לפנות לאיש קשר מחוץ לאירוע. הסכמה שיווקית פר‑ערוץ היא דרישת מדיניות מתועדת (`CLAUDE.md`) שהסכימה כבר תומכת בה.
- **פרטיות:** אין לוג של טוקנים, טלפונים, גוף הודעות או payloads (מוצהר ונאכף לאורך `outreach.ts`, `webhook route`, worker).

## 9. רישום "reached" לחיוב

- **נקודת כניסה יחידה:** RPC `public.try_record_billed_result(p_event, p_campaign, p_contact, p_channel, p_attempt, p_evidence, p_provider_ref)` — `SECURITY DEFINER`; EXECUTE **נשלל מ‑anon/authenticated/PUBLIC והוענק ל‑service_role בלבד** (`202606300038_lock_billing_rpcs.sql`; אומת שנחשף בעבר anonymously ותוקן — P0). הקוד קורא אליו רק דרך `recordReached` (`src/lib/data/billing.ts:30-47`) בצד השרת/worker; **לעולם לא INSERT ישיר** ל‑`billed_results`.
- **הגוף הנוכחי** (הגרסה האחרונה, `20260630223635:196-246`) אוכף בטרנזקציה נעולה אחת: קמפיין קיים ונעול (`FOR UPDATE`), התאמת אירוע (`event_mismatch`), סטטוס `active`/`paused` (paused עדיין מחייב תגובה נכנסת — D2), חלון `start_at`/`close_at`, **יום האירוע לא עבר** (L2, `event_passed`), אירוע `active` (R9), לא `removal_requested`, **חברות במערך המורשה הקפוא** (`not_authorized` — fail‑closed: מערך ריק לא מחייב אף אחד), cap כמותי מול `max_contacts`, ולבסוף INSERT עם `locked_price` ו‑`ON CONFLICT (event_id, contact_id) DO NOTHING` → `already_billed`. תוצרים: `billed | already_billed | ceiling_reached | not_active | before_window | closed_window | removal_requested | not_authorized | no_campaign | event_passed | event_not_active | event_mismatch`.
- **מי קורא:** ה‑worker בלבד, דרך עיבוד ה‑webhook — הודעת WhatsApp נכנסת billable שמזוהה ל‑contact ממוקד (העדפה ל‑`context.id` המדויק, נפילה לטלפון השולח) נרשמת קודם ב‑`contact_interactions` (dedup) ורק אם היא fresh נקראת `recordReached` (`webhook-processing.ts:79-127`). על `billed` — `op_status='reached_billed'` ועצירת ה‑outreach של ה‑contact.
- **RSVP מכפתור:** תשובת quick‑reply מזוהה (`RSVP_BUTTON_MAP`, `webhook-processing.ts:27-31`) נרשמת דרך אותו `submit_rsvp` אטומי של הטופס הציבורי — רק כשמאחורי ה‑contact עומד guest יחיד.
- **גמר חשבון:** `closeCampaignAndCharge` (`src/lib/data/close-charge.ts:40` ואילך) — `amount = max(0, min(Σ locked_price, ceiling) − credits)`; 0 → `nothing_to_charge` בלי קריאת ספק; אחרת capture של הכרטיס התפוס. שגיאת RPC אמיתית מנותבת ל‑`review` — לעולם לא לחיוב ₪0 שגוי. מפורט ב‑`08-billing-and-payments.md`.

## 10. מצב נוכחי — חי מול מתוכנן

נכון ל‑2026‑07‑02 (אומת מול `app_settings` ב‑DB החי ומול הקוד):

| רכיב | מצב |
|---|---|
| קמפיין יחיד‑לאירוע (create‑or‑continue, CTA יחיד, מסע מודרך) | **ממומש** (rework שלב 1) |
| אינדקס חלקי `UNIQUE(event_id) WHERE status <> 'cancelled'` | **מתוכנן, טרם מומש** — לא קיים ב‑DB החי (§2.3) |
| חתימה + OTP + הסכם PDF + אישור קמפיין | **ממומש וחי** |
| J5 hold (`campaign_holds_enabled`) | **פעיל** ב‑DB החי |
| מנוע ה‑outreach (`outreach_enabled`) + קונפיג WhatsApp | **פעיל** ב‑DB החי; ה‑worker רץ תחת pm2 `kalfa-worker` |
| ערוץ WhatsApp מקצה‑לקצה (שליחה, webhook persist‑then‑process, מסירה, חיוב reach) | **ממומש**; חיווט ה‑button payloads על התבניות היוצאות ב‑WABA (RSVP‑מכפתור) — הצד הנכנס ממומש, הגדרת התבניות היוצאות בהשלמה |
| ערוץ השיחות (C2, AI calls) | **מתוכנן, טרם מומש** — touchpoints מסוג `call` נרשמים ונשלחים ל‑`outreach-call-request`, אך אין consumer בתור ואין אינטגרציית ספק בקוד (`worker/main.ts` רושם handlers רק ל‑step/arm/sweeper/webhook) |
| גמר חשבון אוטומטי (`close_charge_enabled`) | **כבוי** ב‑DB החי — הקוד קיים (`closeCampaignAndCharge`, `settleCampaignAction`) אך fail‑closed עד הפעלת הדגל |
| UX לרישום הסכמת WhatsApp | **מתוכנן, טרם מומש** — הפונקציה קיימת ללא caller (§8) |
| לוח תוצאות (סיכום חיוב + funnel מסירה B8) | **ממומש** במסך ניהול הקמפיין |
| סטטוסי enum `draft`/`scheduled`/`awaiting_invoice`/`billed`/`paid` | קיימים ב‑enum בלבד; אין נתיב קוד שמייצר אותם כיום |

כלל ההכרעה: אם מסמך ב‑`plans/` (למשל `campaign-rework-spec.md`, `outreach-engine-c1-spec.md`) סותר את הקוד — הקוד הוא מקור האמת; מסמך זה משקף את הקוד וה‑DB החי בתאריך ההפקה.
