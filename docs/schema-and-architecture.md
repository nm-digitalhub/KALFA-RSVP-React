# KALFA — סכמה וארכיטקטורה (מקור: DB חי + קוד חי)

> מקור האמת: מסד הנתונים הפרודקשני (נשלף דרך Supabase REST/PostgREST עם service-role)
> וקוד המקור ב-`src/` ו-`worker/`. אין הסתמכות על קבצי מיגרציה או תיעוד.

---

## 1. מקור האמת לסכמה

לסכמה של KALFA יש מקור אמת יחיד: **ה-DB החי**. ניתן לשלוף את הצורה המלאה
(טבלאות, עמודות, טיפוסים, מפתחות זרים, enums) דרך ה-OpenAPI spec של PostgREST:

```
GET ${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/
  apikey: ${SUPABASE_SERVICE_ROLE_KEY}
```

חיבור psql ישיר ל-`SUPABASE_DB_HOST` אפשרי רק דרך ה-pooler ב-IPv4
(ה-host הישיר חושף AAAA/IPv6 שאינו נגיש מכל סביבה).

---

## 2. טבלאות (33)

### ליבת המוצר

**events** (16) — אירוע. `id`, `owner_id`, `name`, `event_type` (enum), `event_date`,
`venue_name`, `venue_address`, `template`, `package_id`→packages, `with_ai_calls`,
`status` (event_status), `rsvp_deadline`, `notes`, `created_at`, `updated_at`,
`org_id`→organizations.

**guests** (20) — מוזמן. `id`, `event_id`→events, `group_id`→guest_groups, `rsvp_token`,
`full_name`, `phone`, `language`, `expected_count`, `status` (guest_status),
`confirmed_adults`, `confirmed_kids`, `meal_pref`, `note`, `contact_status`,
`callback_requested`, `extras` jsonb, `contact_id`→contacts, `rsvp_token_revoked_at`,
`created_at`, `updated_at`.

**guest_groups** (5) — קבוצת מוזמנים. `id`, `event_id`→events, `name`, `color`, `created_at`.

**rsvp_responses** (10) — תשובת RSVP (append-only). `id`, `guest_id`→guests,
`event_id`→events, `attending`, `adults`, `kids`, `meal_pref`, `note`, `extras` jsonb,
`created_at`.

**event_questions** (10) — שאלות מותאמות. `id`, `event_id`→events, `q_key`, `label`,
`q_type`, `required`, `enabled`, `sort_order`, `options` jsonb, `created_at`.

**packages** (15) — מסלולי שירות. `id`, `name`, `tier`, `category`, `price_with_vat`,
`description`, `includes` jsonb, `sort_order`, `active`, `price_per_reached`,
`channels` (campaign_channel[]), `outreach_schedule` jsonb, `min_hold_floor`,
`hold_buffer_pct`, `created_at`.

**orders** (16) — הזמנת מסלול ותשלום SUMIT. `id`, `user_id`, `event_id`→events,
`package_id`→packages, `with_ai_addon`, `total_with_vat`, `vat_rate`,
`status` (order_status), `terms_accepted`, `privacy_accepted`, `authorization_accepted`,
`sumit_document_id`, `paid_at`, `payment_attempt_ref`, `payment_processing_started_at`,
`created_at`.

**profiles** (5) — פרופיל משתמש. `id`, `full_name`, `phone`, `created_at`, `updated_at`.

### קמפיינים, outreach וחיוב

**campaigns** (40) — קמפיין אישורי הגעה. כולל `steps` jsonb, `enabled`,
`status` (campaign_status), `max_contacts` (NOT NULL), `max_charge_ceiling`,
`price_per_reached`, `allowed_channels` (campaign_channel[]), `template_id`→packages,
`outreach_schedule` jsonb, `billing_route` (billing_route), ושדות SUMIT מלאים:
auth (`auth_amount`/`auth_number`/`authorized_at`/`auth_expires_at`/`auth_external_ref`),
capture/release (`capture_status`/`release_status`/`sumit_order_document_id`/`card_token_ref`),
charge (`charge_status`/`charged_at`/`sumit_charge_document_id`/`charge_document_number`/
`charge_document_url`/`charge_auth_number`/`charge_payment_id`), כרטיס
(`card_exp_month`/`card_exp_year`/`card_citizen_id`), וסיכום (`final_charge_amount`/
`final_invoice_document_id`).

**contacts** (8) — איש קשר ייחודי לפי טלפון. `id`, `event_id`→events, `normalized_phone`,
`op_status` (contact_op_status), `removal_requested`, `whatsapp_consent_at`,
`created_at`, `updated_at`.

**campaign_authorized_contacts** (5) — הסט המורשה המוקפא (cap מחייב על reached).
`id`, `event_id`→events, `campaign_id`→campaigns, `contact_id`→contacts, `created_at`.

**outreach_state** (14) — סמן התקדמות per-(campaign,contact). `id`, `event_id`→events,
`campaign_id`→campaigns, `contact_id`→contacts, `status`, `current_step_index`,
`whatsapp_sent_count`, `call_request_count`, `next_run_at`, `reached_at`,
`reached_channel` (campaign_channel), `stop_reason`, `created_at`, `updated_at`.

**billed_results** (13) — מקור האמת לחיוב. `id`, `event_id`→events, `campaign_id`→campaigns,
`contact_id`→contacts, `channel` (campaign_channel), `attempt_id`, `reached_at`,
`locked_price`, `evidence_source`, `provider_ref`, `control_status`,
`manual_adjustment` jsonb, `created_at`.

**billing_credits** (7) — זיכויים. `id`, `event_id`→events, `campaign_id`→campaigns,
`amount`, `reason`, `created_by`, `created_at`.

**contact_interactions** (15) — אינטראקציות נכנסות/יוצאות. `id`, `event_id`→events,
`campaign_id`→campaigns, `contact_id`→contacts, `channel`, `direction`, `kind`,
`provider_id`, `billable`, `payload_meta` jsonb, `guest_id`→guests, `context_message_id`,
`delivery_status`, `delivery_error_code`, `created_at`.

**signed_agreements** (15) — ראיית חתימה. `id`, `campaign_id`→campaigns, `event_id`→events,
`signer_user_id`, `agreement_version`, `signed_at`, `ip`, `user_agent`, `signature_ref`,
`id_document_ref`, `content_hash`, `pdf_ref`, `verified_phone`, `otp_verified_at`,
`created_at`.

**message_templates** (10) — תבניות הודעה. `id`, `message_key`, `channel`, `label`,
`name`, `language`, `body`, `active`, `created_at`, `updated_at`.

**agreement_documents** (9) — גרסאות מסמך הסכם. `id`, `version`, `body_html`,
`status` (agreement_status), `is_active`, `approved_by`, `approved_at`, `created_at`,
`updated_at`.

### תשתית webhooks

**webhook_inbox** (13) — intake עמיד (persist-then-process). `id`, `provider`,
`event_kind`, `dedupe_key`, `message_id`, `context_message_id`, `phone_number_id`,
`event_at`, `payload` jsonb, `received_at`, `processed_at`, `attempts`, `last_error`.

### ארגונים והרשאות

**organizations** (5), **organization_members** (5), **organization_invitations** (11),
**organization_audit_log** (8), **org_roles** (8), **role_permissions** (4),
**permission_definitions** (6), **user_roles** (4, `role` app_role).

### הגדרות, OTP ושירות

**app_settings** (44, singleton) — מחזיק את כל ה-config והסודות: SUMIT
(`sumit_company_id`/`sumit_api_public_key`/`sumit_api_key`), SMS, SMTP+DKIM,
WhatsApp Cloud API (`whatsapp_phone_number_id`/`whatsapp_access_token`/
`whatsapp_app_secret`/`whatsapp_verify_token`/`whatsapp_waba_id`), דגלי תכונה
(`payments_enabled`/`campaign_holds_enabled`/`outreach_enabled`/`close_charge_enabled`),
knobs ל-hold (`reasonable_coverage_contacts`/`extreme_threshold_contacts`), וקונפיג הסכם.

**otp_challenges** (8), **user_settings** (6), **activity_log** (6),
**callback_requests** (8), **contact_messages** (6).

---

## 3. Enums (ערכים מה-DB החי)

| Enum | ערכים |
|------|-------|
| app_role | admin, user |
| event_type | wedding, bar_mitzvah, bat_mitzvah, brit, britah, henna, engagement, birthday, other |
| event_status | draft, active, closed |
| guest_status | pending, attending, declined, maybe |
| contact_status | not_contacted, contacted, responded, wrong_number, unclear, unavailable, callback |
| campaign_status | draft, pending_approval, approved, scheduled, active, paused, closed, awaiting_invoice, billed, paid, cancelled |
| campaign_channel | whatsapp, call |
| billing_route | saved_token, hold_j5 |
| order_status | pending, paid, failed, demo, processing, payment_review |
| agreement_status | draft, approved |
| contact_op_status | pending_contact, not_eligible, whatsapp_sent, whatsapp_delivered, whatsapp_read, whatsapp_responded, pending_call, call_dialed, no_answer, voicemail, human_interaction_call, wrong_number, removal_requested, reached_billed, not_reached |

---

## 4. ארכיטקטורת הגישה למסד

שלושה Supabase clients מובחנים:

- **server (SSR)** — `src/lib/supabase/server.ts`. session מבוסס cookie, **RLS נאכף**.
  משמש Server Components / Actions / Route Handlers.
- **browser** — `src/lib/supabase/client.ts`. anon key, RLS נאכף.
- **admin (service-role)** — `src/lib/supabase/admin.ts`. **עוקף RLS**, מוגן ב-`server-only`,
  דוחה placeholder key. משמש קוד שרת מהימן שרץ ללא session (worker, webhook חתום, חיוב).

מודל הרשאות דו-שכבתי:
1. **בידוד tenant** ברמת DB RLS.
2. **אכיפת פועל** ברמת השרת — `requireOwnedEvent(eventId)` בראש כל פעולה event-scoped
   (owner נגזר מה-session, לעולם לא מהדפדפן), ו-`requirePermission(...)` data-driven
   דרך RPC `has_org_permission`.

---

## 5. נתיב החיוב (defense-in-depth)

כל כתיבת חיוב עוברת דרך נקודת כניסה יחידה — `recordReached()` ב-`src/lib/data/billing.ts`,
שקוראת ל-RPC `try_record_billed_result`. ה-cap, חלון הזמן, ובדיקת ה-dedup
(one-per-`(event,contact)`) חיים בתוך טרנזקציה נעולה ב-DB, לא ב-JS.

שלוש שכבות הגנה מפני חיוב כפול / חריגה:
- **`campaign_authorized_contacts`** — הסט המורשה המוקפא; cap מחייב על reached (fail-closed:
  סט ריק לא מחייב אף אחד).
- **`billed_results` UNIQUE(event_id, contact_id)** — ערובת DB לחיוב יחיד לאיש קשר באירוע.
- **`contact_interactions` UNIQUE(channel, provider_id)** — dedup של אירועי ספק (retry של Meta).

`getCampaignBillingSummary` **זורק** על שגיאת RPC (במקום להחזיר 0) כדי לנתב סגירה ל-`review`
ולא לסגור קמפיין ב-₪0 בטעות.

---

## 6. עיבוד WhatsApp webhooks (persist-then-process)

1. **Route** (`src/app/api/webhooks/whatsapp/route.ts`) — מאמת חתימה
   (`whatsapp-api-js`, `secure:true`), מנרמל את כל ה-entries/changes/messages/statuses
   לשורות `webhook_inbox`, ומחזיר 200 מהר. אין לוגיקה כלכלית ב-route.
2. **Intake** (`src/lib/data/webhooks.ts`) — `insertWebhookEvents` עושה upsert idempotent
   על `(provider, dedupe_key)` עם `ignoreDuplicates` → retry של Meta = no-op.
3. **Worker** (`worker/main.ts`) — `handleWebhook` מנקז עד 50 שורות לא-מעובדות
   (`attempts<5`, ישנות-קודם), מעבד כל אחת עצמאית דרך `processWebhookEvent`,
   ומקדם `attempts`+`last_error` בכשל (dead-letter ל-poison rows).

תור pg-boss (`worker/main.ts`, תהליך pm2 `kalfa-worker`): `outreach-arm`/`step`/
`call-request`/`sweeper`/`dead` + `webhook-process`. Idempotency דרך `detId` (job id
דטרמיניסטי) ו-`claimStep` (compare-and-advance). Schedules: arm כל דקה, sweeper כל 5 דק',
webhook כל דקה.

---

## 7. חובות טכניים (מאומתים בקוד)

1. **`bumpCount` לא אטומי** — `src/lib/data/outreach-engine.ts:188-210`: read-modify-write
   בשתי שאילתות (select count → update cur+1). חשוף ל-race תחת ריצה מקבילה. ההשפעה מוגבלת
   (מונה תצוגתי, לא חיוב), אך מנוגד לדפוס ה-CAS האטומי במקומות אחרים באותו מודול.
2. **drain של webhook ללא נעילה** — `src/lib/data/webhooks.ts:39-45`: `select … is('processed_at',null)`
   ללא `FOR UPDATE SKIP LOCKED`. עם cron כל דקה + `max:4`, שני workers / חפיפת ריצה עלולים
   למשוך אותן שורות. ה-dedup ב-DB מונע חיוב כפול — העלות היא עבודה כפולה מבוזבזת בלבד.
3. **SSL לא מאומת ב-worker** — `worker/main.ts:166`: `ssl: { rejectUnauthorized: false }`
   בחיבור pg-boss ל-DB.
4. **parser ידני ל-`.env.local`** — `worker/main.ts:37-51`: regex פשוט שלא מטפל ב-multiline,
   escapes או `export`. עדיף `dotenv`.

---

## 8. לקח תפעולי

מקור האמת לסכמה הוא **ה-DB החי** (REST API עם service-role, או psql דרך ה-pooler ב-IPv4),
ולא תיקיית `supabase/migrations/` ולא `src/lib/supabase/types.ts`. בכל בירור סכמה — לשאול
תחילה את ה-DB החי.
