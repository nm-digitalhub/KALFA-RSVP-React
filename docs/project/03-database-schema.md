# KALFA Event Magic — סכמת מסד הנתונים (Supabase PostgreSQL)

> מסמך זה שוחזר משלושה מקורות אמת, לפי סדר עדיפות: (1) כל קובצי המיגרציה תחת `supabase/migrations/` (47 קבצים, כולם מוחלים על ה‑DB החי — אומת מול `supabase_migrations.schema_migrations`); (2) הטיפוסים המחוללים `src/lib/supabase/types.ts`; (3) אינטרוספקציה קריאה‑בלבד מול ה‑DB החי (`supabase db query --linked` על `pg_catalog`: `pg_constraint`, `pg_policies`, `pg_indexes`, `pg_trigger`, `pg_proc`, `pg_attribute`, `pg_enum`). נכון ל‑2026‑07‑02.
>
> ⚠️ הערת אינטרוספקציה למפתחים: ב‑DB הזה שאילתות `information_schema` על אילוצי FK/UNIQUE מחזירות תוצאות ריקות עבור אילוצים אמיתיים — יש להשתמש תמיד ב‑`pg_constraint` / `pg_indexes`.

## 1. מבט‑על

הסכמות הרלוונטיות:

| Schema | תוכן |
|---|---|
| `public` | 33 טבלאות אפליקטיביות (מפורטות במסמך זה), 22 פונקציות, טיפוסי enum |
| `auth` | Supabase Auth (מנוהל); `auth.users` הוא היעד של כל ה‑FK למשתמשים, והטריגר `on_auth_user_created` מזין את `public.profiles` |
| `storage` | Supabase Storage; bucket פרטי אחד: `id-documents` |
| `pgboss` | תור העבודות של ה‑worker (pg‑boss v12) — ראו §19 |
| `supabase_migrations` | טבלת היסטוריית המיגרציות (`schema_migrations`) |

עקרונות רוחביים של הסכמה:

- **RLS מופעל על כל 33 הטבלאות ב‑`public`** (אומת מול `pg_class.relrowsecurity`). בנוסף, ה‑event trigger `ensure_rls` (על `ddl_command_end`) מריץ את `public.rls_auto_enable()` ומפעיל RLS אוטומטית על כל טבלה חדשה שנוצרת ב‑`public`.
- **דפוסי RLS חוזרים**: `owner` דרך `owns_event(event_id)` או `owner_id/user_id = auth.uid()`; `admin` דרך `has_role(auth.uid(),'admin'::app_role)`; טבלאות רגישות הן admin‑only והשרת כותב אליהן דרך service‑role (עוקף RLS).
- **כתיבות עסקיות עוברות בשרת**: סטטוסי תשלום, חיובים, snapshots ו‑webhooks נכתבים רק דרך ה‑service‑role client או RPCs מסוג SECURITY DEFINER הנעולים ל‑`service_role`. ה‑RLS משמש בעיקר לקריאה מוגדרת‑היקף (owner SELECT) וכהגנת עומק.
- **מפתחות**: כל הטבלאות עם PK מסוג `uuid default gen_random_uuid()` (חריגים: `app_settings` — PK בוליאני singleton; `profiles`/`user_settings` — PK שהוא גם FK ל‑`auth.users`).

## 2. טיפוסי ENUM

כל הטיפוסים המותאמים ב‑`public` (אומת מול `pg_enum` ומול `types.ts`):

| Enum | ערכים |
|---|---|
| `app_role` | `admin`, `user` |
| `event_status` | `draft`, `active`, `closed` |
| `event_type` | `wedding`, `bar_mitzvah`, `bat_mitzvah`, `brit`, `britah`, `henna`, `engagement`, `birthday`, `other` |
| `guest_status` | `pending`, `attending`, `declined`, `maybe` |
| `contact_status` | `not_contacted`, `contacted`, `responded`, `wrong_number`, `unclear`, `unavailable`, `callback` |
| `order_status` | `pending`, `paid`, `failed`, `demo`, `processing`, `payment_review` |
| `campaign_status` | `draft`, `pending_approval`, `approved`, `scheduled`, `active`, `paused`, `closed`, `awaiting_invoice`, `billed`, `paid`, `cancelled` |
| `campaign_channel` | `whatsapp`, `call` |
| `billing_route` | `saved_token` (מסלול B — טוקן שמור), `hold_j5` (מסלול A — תפיסת מסגרת J5) |
| `contact_op_status` | `pending_contact`, `not_eligible`, `whatsapp_sent`, `whatsapp_delivered`, `whatsapp_read`, `whatsapp_responded`, `pending_call`, `call_dialed`, `no_answer`, `voicemail`, `human_interaction_call`, `wrong_number`, `removal_requested`, `reached_billed`, `not_reached` |
| `agreement_status` | `draft`, `approved` |

הרחבות enum בוצעו רק פעם אחת: `order_status` קיבל את `processing` ו‑`payment_review` במיגרציה `202606240002` (בקובץ נפרד כי `ALTER TYPE ... ADD VALUE` מוגבל בתוך טרנזקציה).

## 3. דומיין אירועים

### `events`

טבלת הליבה. כל רשומה נגזרת (מוזמנים, קמפיינים, חיובים, פעילות) נקשרת אליה ונבדקת דרך גבול הבעלות שלה.

| עמודה | טיפוס | NULL | ברירת מחדל / הערות |
|---|---|---|---|
| `id` | `uuid` | לא | `gen_random_uuid()`, PK |
| `owner_id` | `uuid` | לא | FK → `auth.users(id)` ON DELETE CASCADE |
| `org_id` | `uuid` | כן | FK → `organizations(id)`; נוסף בשלב 1 של multi‑tenancy, במכוון nullable (backfill הושלם, הידוק NOT NULL נדחה לשלב עתידי) |
| `name` | `text` | לא | |
| `event_type` | `event_type` | לא | default `'wedding'` |
| `event_date` | `timestamptz` | כן | **שימו לב: timestamptz, לא date** (ראו §17) |
| `rsvp_deadline` | `date` | כן | **date** (לא timestamptz) |
| `status` | `event_status` | לא | default `'draft'`; מכונת המצבים נאכפת בטריגרים (§16) |
| `venue_name`, `venue_address` | `text` | כן | |
| `template` | `text` | כן | default `'classic'` |
| `package_id` | `uuid` | כן | FK → `packages(id)` |
| `with_ai_calls` | `boolean` | לא | default `false` |
| `notes` | `text` | כן | |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()` |

- **CHECK** ‏(LC‑2): `events_rsvp_deadline_within_event` — ‏`rsvp_deadline IS NULL OR (event_date IS NOT NULL AND rsvp_deadline <= (event_date AT TIME ZONE 'Asia/Jerusalem')::date)`. כלומר: deadline מחייב `event_date`, וחייב ליפול עד יום האירוע (לוח שנה ישראלי).
- **אינדקסים**: `idx_events_owner (owner_id)`, `events_org_idx (org_id)`.
- **RLS**: ‏`events_owner_all` — ALL עבור `owner_id = auth.uid()`; ‏`events_admin_all` — ALL עבור admin. (בידוד לפי org קיים ברמת ה‑DAL דרך `can_access_event`; ה‑RLS של events נשאר owner‑based בשלב 1.)
- **טריגרים**: `events_before_insert`, `events_guard_update` (שומרי lifecycle — §16), `trg_events_updated` (`set_updated_at`).

### `event_questions`

שאלות מותאמות‑אישית לטופס ה‑RSVP של אירוע (למשל העדפת תפריט מורחבת).

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `q_key` | `text` | לא | מפתח לוגי; אין UNIQUE ברמת DB — האכיפה בקוד וב‑`submit_rsvp` |
| `label` | `text` | לא | |
| `q_type` | `text` | לא | default `'text'` |
| `required` | `boolean` | לא | default `false` |
| `enabled` | `boolean` | לא | default `true` |
| `sort_order` | `integer` | לא | default `0` |
| `options` | `jsonb` | כן | מערך ערכים מותרים לשאלת בחירה; מאומת בתוך `submit_rsvp` |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `idx_eq_event (event_id)`.
- **RLS**: ‏`eq_owner` — ALL עבור `owns_event(event_id)`; ‏`eq_admin_all`. פוליסת הקריאה האנונימית `eq_public_read` **הוסרה** במיגרציה `202606290034` — הדרך הציבורית היחידה לשאלות היא הפונקציה המאובטחת `get_rsvp_by_token`.

## 4. דומיין מוזמנים ו‑RSVP ציבורי

### `guests`

מוזמן אחד לאירוע אחד; נושא את טוקן ה‑RSVP הציבורי.

| עמודה | טיפוס | NULL | ברירת מחדל / הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `group_id` | `uuid` | כן | FK → `guest_groups` ON DELETE SET NULL |
| `contact_id` | `uuid` | כן | FK → `contacts` ON DELETE SET NULL (כמה מוזמנים יכולים לחלוק טלפון/contact אחד) |
| `rsvp_token` | `text` | לא | **UNIQUE**; default `encode(gen_random_bytes(16),'hex')` — טוקן bearer של 128 ביט (32 hex), CSPRNG; הוגבה מ‑12 בייט (96 ביט) במיגרציה `202606290034`. הקוד לעולם לא קובע אותו — רק ברירת המחדל ב‑DB |
| `rsvp_token_revoked_at` | `timestamptz` | כן | ביטול/רוטציה של טוקן; טוקן מבוטל מתנהג כלא‑קיים בשתי פונקציות ה‑RSVP |
| `full_name` | `text` | לא | PII |
| `phone` | `text` | כן | PII |
| `language` | `text` | כן | default `'he'` |
| `expected_count` | `integer` | כן | default `1`; NULL = לא הוגדר (ואז אין תקרה ב‑`submit_rsvp`) |
| `status` | `guest_status` | לא | default `'pending'` |
| `confirmed_adults`, `confirmed_kids` | `integer` | כן | default `0`; הקרנת last‑write‑wins מתוך `rsvp_responses` |
| `meal_pref`, `note` | `text` | כן | |
| `contact_status` | `contact_status` | לא | default `'not_contacted'` |
| `callback_requested` | `boolean` | לא | default `false` |
| `extras` | `jsonb` | לא | default `'{}'` |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `trg_guests_updated` |

- **UNIQUE**: `guests_rsvp_token_key (rsvp_token)`.
- **אינדקסים**: `idx_guests_event (event_id)`, `idx_guests_token (rsvp_token)`, `guests_contact_idx (contact_id)`.
- **RLS**: ‏`guests_owner` — ALL עבור `owns_event(event_id)`; ‏`guests_admin_all`. אין שום פוליסת anon — הגישה הציבורית עוברת אך ורק דרך `get_rsvp_by_token`/`submit_rsvp` (נעולות ל‑`service_role`, מאחורי rate limiter בשרת).

### `guest_groups`

קיבוץ מוזמנים (משפחה/שולחן וכד').

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `name` | `text` | לא | |
| `color` | `text` | כן | |
| `created_at` | `timestamptz` | לא | `now()` |

- **RLS**: ‏`gg_owner` (ALL, `owns_event`), ‏`gg_admin_all`.

### `rsvp_responses`

יומן append‑only של הגשות RSVP (שורת אודיט לכל הגשה; ה‑guest מחזיק את ההקרנה העדכנית).

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `guest_id` | `uuid` | לא | FK → `guests` ON DELETE CASCADE |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `attending` | `boolean` | כן | `true`=attending, `false`=declined, `NULL`=maybe |
| `adults`, `kids` | `integer` | כן | default `0` |
| `meal_pref`, `note` | `text` | כן | |
| `extras` | `jsonb` | לא | default `'{}'` — תשובות לשאלות המותאמות |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `idx_rsvp_event (event_id)`.
- **RLS**: ‏`rsvp_owner_read` — SELECT עבור `owns_event(event_id)`; ‏`rsvp_admin_read` — SELECT לאדמין. **אין שום פוליסת INSERT** — הפוליסה `rsvp_auth_insert` הוסרה ב‑`202606290034`; הכתיבה היחידה היא דרך `submit_rsvp` (SECURITY DEFINER), שמבצעת נעילה, ולידציה, אידמפוטנטיות (הגשה זהה חוזרת לא יוצרת שורה) והקרנה על ה‑guest.

## 5. פעילות ואודיט

### `activity_log`

יומן פעילות אפליקטיבי (יצירת אירועים, עריכות מוזמנים, פעולות קמפיין וכד').

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `user_id` | `uuid` | כן | FK → `auth.users` ON DELETE SET NULL |
| `event_id` | `uuid` | כן | FK → `events` ON DELETE CASCADE |
| `action` | `text` | לא | |
| `meta` | `jsonb` | לא | default `'{}'` — ללא PII גולמי |
| `created_at` | `timestamptz` | לא | `now()` |

- **RLS**: ‏`al_owner_read` — SELECT עבור `user_id = auth.uid() OR owns_event(event_id)`; ‏`al_owner_insert` — INSERT עם CHECK ‏`user_id = auth.uid()`; ‏`al_admin_all`.

### `organization_audit_log`

ראו §8 — יומן אודיט ייעודי לשינויי חברות/תפקידים בארגון.

## 6. פניות ציבוריות (אתר שיווקי)

### `callback_requests`

בקשות "חייגו אליי" מהאתר הציבורי.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `full_name`, `phone` | `text` | לא | PII |
| `topic`, `note` | `text` | כן | |
| `status` | `text` | לא | default `'new'` |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `cb_set_updated_at` |

- **RLS**: ‏`cb_insert_anyone` — INSERT ל‑`anon`+`authenticated` ‏(`WITH CHECK true`); ‏`cb_admin_all`. אין קריאה ציבורית.

### `contact_messages`

הודעות "צרו קשר".

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `name`, `message` | `text` | לא | |
| `email`, `phone` | `text` | כן | |
| `created_at` | `timestamptz` | לא | `now()` |

- **RLS**: ‏`cm_insert_anyone` (anon+authenticated INSERT), ‏`cm_admin_all`.

## 7. משתמשים, פרופילים ותפקידי פלטפורמה

### `profiles`

פרופיל אפליקטיבי 1:1 מול `auth.users`; מאוכלס אוטומטית בהרשמה.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK **וגם** FK → `auth.users(id)` ON DELETE CASCADE |
| `full_name`, `phone` | `text` | כן | |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `trg_profiles_updated` |

- מאוכלס ע"י הטריגר `on_auth_user_created` על `auth.users` שמריץ את `handle_new_user()` ‏(SECURITY DEFINER) — מעתיק `full_name`/`phone` מ‑`raw_user_meta_data`.
- **RLS**: ‏`own_profile_read` (SELECT ‏`auth.uid() = id`), ‏`own_profile_write` (ALL ‏`auth.uid() = id`), ‏`profiles_admin_read` (SELECT לאדמין).

### `user_roles`

תפקידי **פלטפורמה** (staff) — נפרדים לחלוטין מתפקידי הארגון (§8). מקור האמת של `has_role`.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `user_id` | `uuid` | לא | FK → `auth.users` ON DELETE CASCADE |
| `role` | `app_role` | לא | `admin` / `user` |
| `created_at` | `timestamptz` | לא | `now()` |

- **UNIQUE**: `user_roles_user_id_role_key (user_id, role)`.
- **RLS**: ‏`ur_self_read` — SELECT עבור `user_id = auth.uid() OR has_role(...,'admin')`; ‏`ur_admin_all`. מינוי האדמין הראשון נעשה דרך ה‑RPC ‏`claim_first_admin` (§15).

### `user_settings`

העדפות התראה של הלקוח.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `user_id` | `uuid` | לא | PK + FK → `auth.users` ON DELETE CASCADE |
| `event_updates`, `reminder_updates`, `billing_updates` | `boolean` | לא | default `true` |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `user_settings_set_updated_at` |

- **RLS**: פוליסות owner נפרדות ל‑SELECT / INSERT / UPDATE ‏(`auth.uid() = user_id`). אין DELETE.

## 8. ארגונים ו‑multi‑tenancy (שלב 1)

נוסף במיגרציה `202606280021` — שכבה אדיטיבית: `events.owner_id` נשמר, וה‑RLS האירועי הקיים לא שונה. לכל בעל אירוע קיים בוצע backfill של "ארגון אישי". ההרשאות הן **נתונים** (data‑driven), לא קוד.

### `organizations`

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `name` | `text` | לא | |
| `created_by` | `uuid` | לא | FK → `auth.users` |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `organizations_set_updated_at` |

- **RLS**: ‏`organizations_member_select` — SELECT לחבר ארגון (`is_org_member(id)`) או staff; ‏`organizations_update` — UPDATE למי שיש `has_org_permission(id,'organization','edit')` (בפועל: owner בלבד) או staff; ‏`organizations_admin_all`.

### `org_roles`

ארבעה תפקידים **גלובליים קבועים** (אין תפקידים פר‑ארגון): `owner` / `admin` / `member` / `viewer`, עם `rank` ‏(40/30/20/10) לבדיקות anti‑escalation ו‑`is_owner_role` להגנת "בעלים אחרון".

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `name` | `text` | לא | **UNIQUE** (`org_roles_name_key`) |
| `label`, `description` | `text` | label לא, description כן | תוויות בעברית |
| `is_owner_role` | `boolean` | לא | default `false` |
| `rank`, `sort_order` | `integer` | לא | default `0` |
| `created_at` | `timestamptz` | לא | `now()` |

- **RLS**: קריאה לכל משתמש מחובר (`org_roles_select`); שינוי — staff בלבד (`org_roles_admin_all`). לקוחות לעולם לא עורכים תפקידים.

### `permission_definitions`

קטלוג ההרשאות הגלובלי (resource × action), 24 רשומות seed: ‏`events/guests/contacts/campaigns` ב‑view/create/edit/delete (+`campaigns.manage`), ‏`reports.view`, ‏`billing.view`, ‏`members.view/manage`, ‏`organization.view/edit/manage`.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `resource`, `action` | `text` | לא | **UNIQUE** ‏`(resource, action)` |
| `label` | `text` | לא | עברית |
| `sort_order` | `integer` | לא | default `0` |
| `created_at` | `timestamptz` | לא | `now()` |

- **RLS**: כמו `org_roles` — קריאה לכל מחובר, כתיבה staff בלבד.

### `role_permissions`

מיפוי תפקיד→הרשאה (data): ‏owner=הכול; admin=הכול פרט ל‑`organization.edit`; member=סט עריכה מצומצם + כל ה‑view; viewer=רק `*.view`.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `role_id` | `uuid` | לא | FK → `org_roles` ON DELETE CASCADE |
| `permission_id` | `uuid` | לא | FK → `permission_definitions` ON DELETE CASCADE |
| `created_at` | `timestamptz` | לא | `now()` |

- **UNIQUE**: `(role_id, permission_id)`. **RLS**: כמו `org_roles`.

### `organization_members`

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `organization_id` | `uuid` | לא | FK → `organizations` ON DELETE CASCADE |
| `user_id` | `uuid` | לא | FK → `auth.users` ON DELETE CASCADE |
| `role_id` | `uuid` | לא | FK → `org_roles` |
| `created_at` | `timestamptz` | לא | `now()` |

- **UNIQUE**: `(organization_id, user_id)`. **אינדקסים**: על `user_id` ועל `organization_id`.
- **RLS**: ‏`organization_members_select` — SELECT לחבר ארגון או staff; ‏`organization_members_manage` — ALL למי שיש `members.manage` או staff.

### `organization_invitations`

הזמנות בטוקן אטום (posture בסגנון RSVP): שימוש חד‑פעמי, פג‑תוקף, ניתן לביטול, מותאם‑email.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `organization_id` | `uuid` | לא | FK → `organizations` ON DELETE CASCADE |
| `email` | `text` | לא | |
| `role_id` | `uuid` | לא | FK → `org_roles` |
| `token` | `text` | לא | **UNIQUE** — טוקן אטום |
| `invited_by` | `uuid` | לא | FK → `auth.users` |
| `expires_at` | `timestamptz` | לא | |
| `accepted_at` | `timestamptz` | כן | |
| `accepted_by` | `uuid` | כן | FK → `auth.users` |
| `revoked_at` | `timestamptz` | כן | ביטול הזמנה |
| `created_at` | `timestamptz` | לא | `now()` |

- **UNIQUE חלקי**: `organization_invitations_active_uniq (organization_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL` — הזמנה פעילה אחת לכל email בארגון.
- **RLS**: ‏`organization_invitations_manage` — ALL למי שיש `members.manage` או staff. הקבלה עצמה עוברת רק דרך ה‑RPC ‏`accept_invitation`.

### `organization_audit_log`

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `organization_id` | `uuid` | לא | FK → `organizations` ON DELETE CASCADE |
| `actor_id` | `uuid` | לא | FK → `auth.users` |
| `action` | `text` | לא | |
| `target_user_id` | `uuid` | כן | FK → `auth.users` |
| `target_role_id` | `uuid` | כן | FK → `org_roles` |
| `details` | `jsonb` | כן | |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `(organization_id, created_at DESC)`.
- **RLS**: קריאה למי שיש `organization.manage` או staff; כתיבה — service‑role בלבד (אין פוליסת INSERT ללקוח).

## 9. חבילות / מסלולי שירות

### `packages`

משמשת גם כטבלת **תבניות הקמפיין המסחריות**: המסלולים הפעילים הם השורות עם `price_per_reached` לא‑NULL. המחיר, הערוצים ולוח ה‑outreach הם נתוני אדמין — מועתקים וננעלים על הקמפיין ביצירה, לעולם לא מגיעים מהדפדפן.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `name` | `text` | לא | |
| `tier` | `text` | לא | למשל `outcome_whatsapp` (המסלול הפעיל היחיד; `outcome_full` הושבת) |
| `category` | `text` | לא | default `'digital'` |
| `price_with_vat` | `numeric(10,2)` | לא | |
| `description` | `text` | כן | |
| `includes` | `jsonb` | לא | default `'[]'` |
| `sort_order` | `integer` | לא | default `0` |
| `active` | `boolean` | לא | default `true` |
| `price_per_reached` | `numeric` | כן | מחיר פר איש‑קשר שהושג; non‑NULL ⇒ תבנית קמפיין |
| `channels` | `campaign_channel[]` | כן | הערוצים שהמסלול מציע (data, לא hardcode) |
| `outreach_schedule` | `jsonb` | כן | מערך touchpoints ‏`{days_before, channel, message_key}` מעוגן לתאריך האירוע |
| `min_hold_floor` | `numeric` | לא | default `0` — רצפת hold מינימלית (מיגרציה 0024) |
| `hold_buffer_pct` | `numeric` | לא | default `0` — buffer לתמחור רב‑ערוצי |
| `created_at` | `timestamptz` | לא | `now()` |

- **RLS**: ‏`packages_public_read` — SELECT ל‑anon+authenticated עבור `active = true`; ‏`packages_admin_all`.
- הערה היסטורית: עמודות מדיניות הניסיונות הקבועה (`whatsapp_attempts` וכו', מיגרציה 0011) הוסרו ב‑0014 לטובת `outreach_schedule`.

## 10. הזמנות ותשלומים (SUMIT)

### `orders`

הזמנות לקוח בזרימת התשלום הישירה (נפרדת מחיוב הקמפיינים).

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `user_id` | `uuid` | לא | FK → `auth.users` ON DELETE CASCADE |
| `event_id` | `uuid` | כן | FK → `events` ON DELETE SET NULL |
| `package_id` | `uuid` | כן | FK → `packages` |
| `with_ai_addon` | `boolean` | לא | default `false` |
| `total_with_vat` | `numeric(10,2)` | לא | |
| `vat_rate` | `numeric(4,2)` | לא | default `18.00` |
| `status` | `order_status` | לא | default `'demo'` |
| `terms_accepted`, `privacy_accepted`, `authorization_accepted` | `boolean` | לא | default `false` — תיעוד הסכמות בזמן ההזמנה |
| `sumit_document_id` | `integer` | כן | PaymentID של SUMIT — מפתח ה‑lookup היחיד; **UNIQUE חלקי** ‏(`WHERE sumit_document_id IS NOT NULL`) |
| `paid_at` | `timestamptz` | כן | |
| `payment_attempt_ref` | `uuid` | לא | default `gen_random_uuid()`, **UNIQUE**; מזהה ניסיון — מסובב בכל retry ונשלח ל‑SUMIT כ‑`Customer.ExternalIdentifier` |
| `payment_processing_started_at` | `timestamptz` | כן | נקבע בזמן הנעילה; לאיתור הזמנות `processing` תקועות |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `orders_user_id_idx (user_id)` (תואם את פוליסת ה‑RLS).
- **RLS**: ‏`orders_owner_select` — **SELECT בלבד** עבור `user_id = auth.uid()` (הפוליסה `orders_owner` מסוג ALL הוסרה ב‑0003); ‏`orders_admin_all`. כל מעברי הסטטוס נכתבים דרך `createAdminClient()` (service‑role) בלבד.

## 11. קמפיינים ו‑outreach

### `campaigns`

קמפיין פר‑אירוע (אחד‑לאירוע נאכף באפליקציה, לא ב‑DB). מרכז את האישור, המדיניות הנעולה, ושני מסלולי הסליקה.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `status` | `campaign_status` | לא | default `'draft'` |
| `steps` | `jsonb` | לא | default `'[]'` (עמודת בסיס היסטורית) |
| `enabled` | `boolean` | לא | default `false` |
| `close_at` | `timestamptz` | כן | סוף חלון החיוב |
| `start_at` | `timestamptz` | כן | תחילת חלון |
| `template_id` | `uuid` | כן | FK → `packages(id)` — התבנית שממנה נוצר |
| `price_per_reached` | `numeric` | כן | מחיר נעול שהועתק מהתבנית |
| `max_contacts` | `integer` | **לא** | הודק ל‑NOT NULL ב‑0031 (הגנת עומק על תקרת הספירה) |
| `max_charge_ceiling` | `numeric` | כן | תקרת חיוב קפואה |
| `allowed_channels` | `campaign_channel[]` | לא | default `'{whatsapp,call}'` |
| `outreach_schedule` | `jsonb` | כן | לוח touchpoints נעול |
| `tos_version` | `text` | כן | |
| `approved_by` | `uuid` | כן | |
| `approved_at` | `timestamptz` | כן | |
| `billing_route` | `billing_route` | כן | `hold_j5` (מסלול A) / `saved_token` (מסלול B) |
| `final_charge_amount` | `numeric` | כן | |
| `final_invoice_document_id` | `integer` | כן | |
| **מסלול A (J5 hold):** `auth_amount` `numeric`, `auth_number` `text`, `authorized_at` / `auth_expires_at` `timestamptz`, `capture_status` `text` (pending/captured/failed…), `release_status` `text` (pending/released/expired), `sumit_order_document_id` `integer`, `auth_external_ref` `text` (ה‑`Customer.ExternalIdentifier` — העוגן היחיד ל‑capture, מיגרציה 0025) | | כולן כן | |
| **מסלול B / כרטיס שמור:** `card_token_ref` `text`, `card_exp_month` / `card_exp_year` `smallint` (0026 — לעולם לא PAN/CVV), `card_citizen_id` `text` (0027 — **PII**, ת"ז של בעל הכרטיס, נדרש ע"י SUMIT לחיוב טוקן) | | כולן כן | |
| **קבלה/חיוב (0027):** `charge_status` `text`, `charged_at` `timestamptz`, `sumit_charge_document_id` / `charge_document_number` / `charge_payment_id` `integer`, `charge_document_url` / `charge_auth_number` `text` | | כולן כן | |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `trg_campaigns_updated` |

- **RLS**: ‏`camp_owner_select` — SELECT בלבד עבור `owns_event(event_id)` (כתיבות דרך השרת, כמו orders); ‏`camp_admin_all` — ALL לאדמין.
- **טריגרים**: `campaigns_require_active_event` ‏(R9), `campaigns_guard_cancel` ‏(R8) — ראו §16.

### `contacts`

איש קשר יחיד לכל טלפון‑מנורמל באירוע — היחידה הנספרת/מחויבת.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `normalized_phone` | `text` | לא | E.164; **UNIQUE** ‏`(event_id, normalized_phone)` |
| `op_status` | `contact_op_status` | לא | default `'pending_contact'` — הסטטוס התפעולי (§11 במפרט) |
| `removal_requested` | `boolean` | לא | default `false` — opt‑out; חוסם חיוב ב‑RPC |
| `whatsapp_consent_at` | `timestamptz` | כן | **הסכמה שיווקית ספציפית‑ערוץ** (מיגרציה 0028) |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `contacts_set_updated_at` |

- **אינדקס**: `contacts_event_idx (event_id)`.
- **RLS**: ‏`contacts_owner_select` (SELECT, ‏`owns_event`), ‏`contacts_admin_all`.

### `campaign_authorized_contacts`

ה‑SET הקפוא של אנשי הקשר המאושרים — snapshot שנכתב בשרת בשלב ה‑hold. **התקרה המחייבת** על חיוב: איש קשר שאינו בסט לעולם לא מחויב (fail‑closed: סט ריק ⇒ אף אחד לא מחויב). מבטיח `reached ⊆ authorized` מבנית.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `campaign_id` | `uuid` | לא | FK → `campaigns` ON DELETE CASCADE |
| `contact_id` | `uuid` | לא | FK → `contacts` ON DELETE CASCADE |
| `created_at` | `timestamptz` | לא | `now()` |

- **UNIQUE**: `(campaign_id, contact_id)`. **אינדקס**: `campaign_authorized_contacts_campaign_idx (campaign_id)`.
- **RLS**: owner SELECT ‏(`owns_event`) + admin ALL; כתיבה — service‑role בלבד.

### `outreach_state`

הסמן (cursor) העמיד של מנוע ה‑outreach פר‑(campaign, contact) — התקדמות בלוח ה‑touchpoints, בסמנטיקת compare‑and‑advance אידמפוטנטית. `billed_results` נשאר מקור האמת לחיוב; זו רק ההתקדמות ההנדסית + אודיט גלוי ללקוח.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` / `campaign_id` / `contact_id` | `uuid` | לא | FK → events/campaigns/contacts, כולן ON DELETE CASCADE |
| `status` | `text` | לא | default `'active'` — ‏active/reached/stopped/exhausted/not_eligible |
| `current_step_index` | `integer` | לא | default `0` |
| `whatsapp_sent_count`, `call_request_count` | `integer` | לא | default `0` |
| `next_run_at`, `reached_at` | `timestamptz` | כן | |
| `reached_channel` | `campaign_channel` | כן | |
| `stop_reason` | `text` | כן | reached/closed/removal_requested/consent_revoked |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `set_outreach_state_updated_at` |

- **UNIQUE**: `(campaign_id, contact_id)`. **אינדקס**: `(campaign_id, status)`.
- **RLS**: owner SELECT + admin ALL; ה‑worker כותב דרך service‑role.

### `message_templates`

תוכן השליחה שהמנוע פותר לפי `message_key` (למשל `invite`, `reminder_1`, `call_1`). Seed בגישת fail‑closed: ‏`active=false` עד שאדמין ממלא שם תבנית מאושרת‑Meta ומפעיל.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `message_key` | `text` | לא | **UNIQUE** (`message_templates_message_key_key`) |
| `channel` | `campaign_channel` | לא | |
| `label` | `text` | כן | תצוגת אדמין (עברית) |
| `name` | `text` | לא | default `''` — שם התבנית המאושרת ב‑WhatsApp |
| `language` | `text` | לא | default `'he'` |
| `body` | `text` | כן | תסריט שיחה / רפרנס |
| `components` | `jsonb` | כן | מפרט רכיבי שליחה (header/body_vars/buttons); ‏NULL = תבנית "חשופה"; הצורה מאומתת ב‑Zod ‏(`src/lib/whatsapp/template-spec.ts`) |
| `active` | `boolean` | לא | default `false` |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `set_message_templates_updated_at` |

- **RLS**: admin‑only ‏(`message_templates_admin_all`); הקורא בשרת הוא service‑role.

### `contact_interactions`

יומן אירועי ספק (WhatsApp/שיחות) + דה‑דופליקציה של webhooks — גם outbound (ה‑wamid נשמר כ‑`provider_id`) וגם inbound.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | כן | FK → `events` ON DELETE CASCADE |
| `campaign_id` | `uuid` | כן | FK → `campaigns` ON DELETE CASCADE |
| `contact_id` | `uuid` | כן | FK → `contacts` ON DELETE SET NULL |
| `guest_id` | `uuid` | כן | FK → `guests` (0035) — מאפשר RSVP‑מכפתור |
| `channel` | `campaign_channel` | לא | |
| `direction` | `text` | לא | inbound/outbound |
| `kind` | `text` | לא | whatsapp_message / whatsapp_status / call_result |
| `provider_id` | `text` | לא | wamid / session id; **UNIQUE** ‏`(channel, provider_id)` — ‏Meta משחזרת אותו wamid עד 7 ימים |
| `context_message_id` | `text` | כן | קישור תשובה נכנסת להודעה היוצאת (0035) |
| `delivery_status`, `delivery_error_code` | `text` | כן | סטטוס מסירה אחרון + קוד שגיאת Meta (0035) |
| `billable` | `boolean` | לא | default `false` |
| `payload_meta` | `jsonb` | כן | **לא רגיש בלבד** |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `contact_interactions_contact_idx (contact_id)`.
- **RLS**: owner SELECT (רק כאשר `event_id` לא NULL) + admin ALL.

## 12. חיוב מבוסס‑תוצאה והסכמים

### `billed_results`

**מקור האמת לחיוב**: שורה = איש קשר אחד שהושג ומחויב. נכתבת אך ורק דרך ה‑RPC ‏`try_record_billed_result` (§15).

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE — נכתב מ‑`campaign.event_id`, לא מהקורא (L2) |
| `campaign_id` | `uuid` | לא | FK → `campaigns` ON DELETE CASCADE |
| `contact_id` | `uuid` | לא | FK → `contacts` ON DELETE CASCADE |
| `channel` | `campaign_channel` | לא | |
| `attempt_id` | `text` | כן | |
| `reached_at` | `timestamptz` | לא | `now()` |
| `locked_price` | `numeric` | לא | המחיר שננעל ברגע היצירה |
| `evidence_source` | `text` | לא | whatsapp_inbound / call_asr / call_dtmf |
| `provider_ref` | `text` | כן | wamid / session id |
| `control_status` | `text` | לא | default `'confirmed'` — ‏confirmed/adjusted/disputed |
| `manual_adjustment` | `jsonb` | כן | |
| `created_at` | `timestamptz` | לא | `now()` |

- **UNIQUE** (האינווריאנט המרכזי): `billed_results_event_contact_unique (event_id, contact_id)` — לכל היותר חיוב אחד פר איש‑קשר פר אירוע, חוצה‑ערוצים, ברמת DB.
- **אינדקס**: `billed_results_campaign_idx (campaign_id)`.
- **RLS**: owner SELECT (שקיפות) + admin ALL; אין INSERT ללקוח.

### `billing_credits`

זיכויים/התאמות — append‑only.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `campaign_id` | `uuid` | כן | FK → `campaigns` ON DELETE SET NULL |
| `amount` | `numeric` | לא | חיובי = זיכוי ללקוח |
| `reason` | `text` | לא | |
| `created_by` | `uuid` | כן | מזהה אדמין |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `billing_credits_campaign_idx`. **RLS**: owner SELECT + admin ALL.

### `signed_agreements`

ראיות חתימה על ההסכם — **PII ברגישות גבוהה, admin‑only** (אין קריאת owner).

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `campaign_id` | `uuid` | לא | FK → `campaigns` ON DELETE CASCADE |
| `event_id` | `uuid` | לא | FK → `events` ON DELETE CASCADE |
| `signer_user_id` | `uuid` | לא | |
| `agreement_version` | `text` | לא | |
| `signed_at` | `timestamptz` | לא | `now()` |
| `ip`, `user_agent` | `text` | כן | ראיות |
| `signature_ref` | `text` | כן | נתיב Storage לחתימה |
| `id_document_ref` | `text` | כן | נתיב bucket פרטי — **legacy**; אימות הזהות עבר ל‑OTP (0016) |
| `verified_phone` | `text` | כן | הטלפון שאומת ב‑OTP (0016) |
| `otp_verified_at` | `timestamptz` | כן | מועד אימות ה‑OTP |
| `content_hash` | `text` | לא | SHA‑256 של ה‑PDF הסופי |
| `pdf_ref` | `text` | כן | נתיב Storage |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `signed_agreements_campaign_idx`. **RLS**: ‏`signed_agreements_admin_all` בלבד; כתיבה בשרת דרך service‑role.

### `agreement_documents`

מסמך ההסכם עצמו כ‑DATA (גרסה, סטטוס, גוף אופציונלי) — מנוהל מ‑`/admin/agreement`. ‏`body_html` ‏NULL ⇒ שימוש בתבנית ברירת המחדל שבקוד.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `version` | `text` | לא | |
| `body_html` | `text` | כן | NULL = תבנית ברירת מחדל בקוד |
| `status` | `agreement_status` | לא | default `'draft'`; סימון "טיוטה" מתווסף ברינדור |
| `is_active` | `boolean` | לא | default `true`; **UNIQUE חלקי** ‏`(is_active) WHERE is_active` — מסמך פעיל אחד לכל היותר |
| `approved_by` | `uuid` | כן | FK → `auth.users` |
| `approved_at` | `timestamptz` | כן | |
| `created_at`, `updated_at` | `timestamptz` | לא | `now()`; טריגר `agreement_documents_set_updated_at` |

- **RLS**: admin‑only; ההסכם מגיע ללקוח דרך רינדור צד‑שרת בלבד.

### `otp_challenges`

אתגרי OTP (SMS דרך ExtrA) לאימות זהות בחתימת ההסכם. **הקוד עצמו לעולם לא נשמר** — רק `sha256(code + phone)`.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `phone` | `text` | לא | E.164 |
| `purpose` | `text` | לא | למשל `'agreement_signing'` |
| `code_hash` | `text` | לא | SHA‑256 בלבד |
| `expires_at` | `timestamptz` | לא | קצר‑מועד |
| `attempts` | `integer` | לא | default `0` — הגבלת ניסיונות |
| `consumed_at` | `timestamptz` | כן | חד‑פעמי |
| `created_at` | `timestamptz` | לא | `now()` |

- **אינדקס**: `otp_challenges_lookup_idx (phone, purpose, created_at DESC)`.
- **RLS**: admin‑only; יצירה/אימות בשרת דרך service‑role.

## 13. Webhook Inbox

### `webhook_inbox`

קליטה עמידה בדפוס **persist‑then‑process** ל‑webhooks של ספקים (WhatsApp/Meta ראשון): ה‑route מאמת חתימה, מנרמל, מכניס שורה ומחזיר 200 מהר; ה‑worker מעבד out‑of‑band.

| עמודה | טיפוס | NULL | הערות |
|---|---|---|---|
| `id` | `uuid` | לא | PK |
| `provider` | `text` | לא | default `'whatsapp'` |
| `event_kind` | `text` | לא | `'message'` / `'status'` |
| `dedupe_key` | `text` | לא | `'wa-msg:<wamid>'` / `'wa-status:<wamid>:<status>'`; **UNIQUE** ‏`(provider, dedupe_key)` |
| `message_id` | `text` | כן | wamid |
| `context_message_id` | `text` | כן | ‏context.id של תשובה נכנסת |
| `phone_number_id` | `text` | כן | |
| `event_at` | `timestamptz` | כן | |
| `payload` | `jsonb` | לא | האירוע הגולמי — **מכיל PII** (טלפונים/שמות); לעולם לא נרשם ללוג |
| `received_at` | `timestamptz` | לא | `now()` |
| `processed_at` | `timestamptz` | כן | |
| `attempts` | `integer` | לא | default `0`; שורות עם `attempts >= 5` לא נטענות שוב |
| `last_error` | `text` | כן | |

- **אינדקסים**: ‏`webhook_inbox_unprocessed_idx (received_at) WHERE processed_at IS NULL` (מסלול ה‑worker), ‏`webhook_inbox_received_idx (received_at DESC)` (inspector של האדמין).
- **RLS**: ‏`webhook_inbox_admin_all` בלבד; ה‑route וה‑worker משתמשים ב‑service‑role.
- הטעינה התחרותית עוברת דרך `claim_webhook_events` ‏(`FOR UPDATE SKIP LOCKED`, §15) כך ששני runs חופפים מקבלים סטים זרים.

## 14. הגדרות מערכת — `app_settings`

טבלת **singleton** (בדיוק שורה אחת): ‏PK ‏`id boolean default true` + ‏CHECK ‏`app_settings_singleton (id = true)`; השורה נזרעה במיגרציה 0005. מרכזת קונפיגורציית אדמין תפעולית, כולל **סודות ספקים** — ולכן מאז 0006 **אין שום פוליסת קריאה ל‑authenticated**; כל קריאה היא צד‑שרת (service‑role) או אדמין תחת `app_settings_admin_all` (הפוליסה היחידה). טריגר `app_settings_set_updated_at`.

קבוצות העמודות (כולן נוספו אינקרמנטלית במיגרציות 0005–0033):

| קבוצה | עמודות | הערות |
|---|---|---|
| דגלי הפעלה (fail‑closed) | `payments_enabled`, `campaign_holds_enabled`, `outreach_enabled`, `close_charge_enabled`, `sms_enabled`, `email_enabled` — כולם `boolean not null default false` | שום מסלול כסף/שליחה לא פעיל עד שאדמין מדליק |
| SUMIT (סליקה) | `sumit_company_id`, `sumit_api_public_key`, `sumit_api_key` 🔒 | ‏`sumit_api_key` הוא סוד — לעולם לא מגיע לדפדפן |
| SMS ‏(ExtrA) | `extra_sms_token` 🔒, `extra_sms_sender` | OTP לחתימת הסכם |
| SMTP ‏(IONOS) | `smtp_host`, `smtp_port` `integer`, `smtp_secure` `boolean not null default false`, `smtp_user`, `smtp_password` 🔒, `smtp_from` | דוא"ל עסקי |
| DKIM | `dkim_domain`, `dkim_selector`, `dkim_private_key` 🔒 | חתימה עצמית של מייל יוצא |
| WhatsApp Cloud API | `whatsapp_phone_number_id`, `whatsapp_access_token` 🔒, `whatsapp_app_secret` 🔒 (אימות HMAC), `whatsapp_verify_token`, `whatsapp_waba_id` | ‏WABA_ID = היעד של ניהול תבניות |
| זהות משפטית (§14ג) | `company_legal_name`, `company_legal_id`, `company_legal_address`, `company_contact_phone`, `company_contact_email`, `privacy_url`, `terms_url`, `warranty_text` | גילויי חובה בהסכם — data, לא hardcode |
| פרמטרי הסכם | `agr_service_activation_window`, `agr_offer_validity_days`, `agr_charge_window_days`, `agr_hold_release_days`, `agr_liability_cap`, `agr_retention_days`, `agr_record_retention_months` — כולם `text default ''` | טקסט חופשי (ייתכנו ביטויים בעברית); מוזרקים לתבנית ההסכם |
| ספי כיסוי לחיוב | `reasonable_coverage_contacts` `integer not null default 300`, `extreme_threshold_contacts` `integer not null default 400` | קלט לחישוב גובה ה‑hold ‏(0024) |

🔒 = סוד; מוצג באדמין כ"מוגדר ✓" בלבד. סודות תשתית (service‑role key וכד') נשארים ב‑ENV, לא בטבלה.

## 15. פונקציות ו‑RPCs

כל הפונקציות ב‑`public` (אומת מול `pg_proc` כולל ACL בפועל). "EXECUTE" מציין למי יש הרשאת הרצה בפועל ב‑DB החי.

### פונקציות הרשאה (בסיס ה‑RLS וה‑DAL)

| פונקציה | ארגומנטים | מחזירה | SECDEF | EXECUTE | תפקיד |
|---|---|---|---|---|---|
| `has_role` | `_user_id uuid, _role app_role` | `boolean` | ✔ | anon, authenticated, service_role | בדיקת תפקיד פלטפורמה מול `user_roles`; הבסיס לכל פוליסות ה‑admin |
| `owns_event` | `_event_id uuid` | `boolean` | ✔ | ‏PUBLIC (ברירת מחדל) | ‏`events.owner_id = auth.uid()`; הבסיס לכל פוליסות ה‑owner |
| `has_org_permission` | `_org_id uuid, _resource text, _action text` | `boolean` | ✔ | PUBLIC | **מקור האמת היחיד** להרשאות ארגון — קורא `organization_members` × `role_permissions` × `permission_definitions` |
| `is_org_member` | `_org_id uuid` | `boolean` | ✔ | PUBLIC | פרימיטיב הבידוד לפי ארגון ב‑RLS |
| `can_access_event` | `_event_id uuid, _resource text default 'events', _action text default 'view'` | `boolean` | ✔ | PUBLIC | שער גישה org‑aware ל‑DAL; ה‑owner הקלאסי תמיד עובר |
| `org_role_rank` | `_role_id uuid` | `int` | ✔ | PUBLIC | דירוג תפקיד לבדיקות anti‑escalation |

### RPCs עסקיים

| פונקציה | ארגומנטים | מחזירה | SECDEF | EXECUTE | תפקיד |
|---|---|---|---|---|---|
| `claim_first_admin` | — (ללא ארגומנטים) | `boolean` | ✔ | anon, authenticated, service_role | ‏bootstrap: אם אין עדיין admin — ממנה את הקורא המאומת ומחזירה `true`; אם קיים admin — ‏`false`; לא‑מאומת — exception |
| `create_organization` | `_name text` | `uuid` | ✔ | PUBLIC | יצירת ארגון + חברות owner לקורא, אטומית |
| `accept_invitation` | `_token text` | `uuid` | ✔ | PUBLIC | קבלת הזמנה: בתוקף, לא‑מבוטלת, חד‑פעמית, מותאמת‑email; נועלת `FOR UPDATE` |
| `get_rsvp_by_token` | `_token text` | `jsonb` | ✔ | **service_role בלבד** | השער הציבורי היחיד לקריאת RSVP: מאמתת טוקן לא‑מבוטל + אירוע `active`; מחזירה guest+event+questions+`can_respond` (משוקלל גם מול יום האירוע וגם מול ה‑deadline, בלוח שנה Asia/Jerusalem). נקראת רק מהשרת אחרי rate limiter |
| `submit_rsvp` | `_token text, _status text, _adults int, _kids int, _meal text, _note text, _answers jsonb default '{}'` | `jsonb` | ✔ | **service_role בלבד** | ההגשה האטומית: whitelist סטטוס, נעילת guest, שערי אירוע (active, לא‑עבר‑יומו, deadline), ולידציית counts מול `expected_count`, ולידציית תשובות מול `event_questions`, אידמפוטנטיות, append ל‑`rsvp_responses` + הקרנה על `guests`. סיבות כשל: `invalid_status`/`not_found`/`closed`/`deadline_passed`/`invalid_count`/`invalid_answers`/`missing_required` |
| `try_record_billed_result` | `p_event uuid, p_campaign uuid, p_contact uuid, p_channel campaign_channel, p_attempt text, p_evidence text, p_provider_ref text` | `text` | ✔ | **service_role בלבד** (ננעל ב‑0038 אחרי שממצא P0 הוכיח שanon הריץ אותה) | **נקודת הכניסה היחידה לחיוב** — טרנזקציה נעולה אחת: אימות קמפיין (`FOR UPDATE`), התאמת אירוע (`event_mismatch`), סטטוס `active|paused`, חלון `start_at`/`close_at`, ‏`event_passed` (יום האירוע עבר בישראל), ‏`event_not_active` (R9), ‏opt‑out ‏(`removal_requested`), **חברות ב‑SET הקפוא** (`not_authorized`), תקרת ספירה (`ceiling_reached`), ואז INSERT עם `ON CONFLICT (event_id, contact_id) DO NOTHING` ‏(`already_billed`). מחזירה `billed` בהצלחה. ה‑event_id הנכתב נגזר מהקמפיין — לא מהקורא |
| `campaign_billing_summary` | `p_campaign uuid` | `table(reached_count int, accrued numeric, ceiling numeric, max_contacts int)` | ✔ | **service_role בלבד** (0038) | סיכום מדויק: ‏`accrued = Σ locked_price` |
| `cancel_campaign` | `p_campaign uuid` | `text` | ✔ | **service_role בלבד** | ביטול R8: מותר רק מ‑`draft|pending_approval|approved` ללא מחויבות פיננסית (`capture_status` לא authorized/pending/hold_review, ‏`charge_status IS NULL`, אפס `billed_results`); מחזירה `cancelled`/`already_cancelled`/`not_cancellable`/`no_campaign` |
| `claim_webhook_events` | `_limit int` | `setof webhook_inbox` | ✔ | **service_role בלבד** | טעינת שורות לא‑מעובדות (`attempts < 5`) בסדר קבלה עם `FOR UPDATE SKIP LOCKED` — קוראים מקבילים מקבלים סטים זרים |

### פונקציות טריגר ותשתית

| פונקציה | סוג | SECDEF | הערות |
|---|---|---|---|
| `set_updated_at` | trigger | ✘ (INVOKER) | ‏`new.updated_at = now()`; משמשת את כל טריגרי ה‑updated_at |
| `handle_new_user` | trigger | ✔ | על `auth.users` ‏(`on_auth_user_created`) — יוצרת שורת `profiles` |
| `events_before_insert` | trigger | ✘ (INVOKER, `search_path=''`) | ראו §16 |
| `events_guard_update` | trigger | ✔ (EXECUTE הוסר מ‑anon/authenticated — קוסמטי; PostgreSQL ממילא חוסם קריאה ישירה לפונקציות trigger) | ראו §16 |
| `campaigns_require_active_event` | trigger | ✔ (כנ"ל) | ראו §16 |
| `campaigns_guard_cancel` | trigger | ✔ (כנ"ל) | ראו §16 |
| `rls_auto_enable` | event trigger | ✔ | מחובר ל‑event trigger ‏`ensure_rls` ‏(`ddl_command_end`): מפעיל RLS על כל טבלה חדשה ב‑`public` |

## 16. טריגרים ואילוצי Lifecycle

### שומרי מחזור החיים של אירועים (מצב נוכחי — 4 טריגרים חיים + CHECK אחד)

כלל "אירוע עבר" אחיד בכל השכבות: יום קלנדרי בישראל — ‏`(x AT TIME ZONE 'Asia/Jerusalem')::date`; ‏`event_date` ‏NULL לעולם לא חוסם.

| טריגר | טבלה | אירוע | חוקים נאכפים |
|---|---|---|---|
| `events_before_insert` | `events` | BEFORE INSERT | **R1** — כל אירוע חדש נכפה ל‑`status='draft'`; **R2** — ‏`event_date` (אם סופק) חייב להיות מחר ומעלה בישראל; **R2b** — ‏`rsvp_deadline` (אם סופק) חייב להיות היום ומעלה (החסם התחתון בלבד — העליון ב‑CHECK) |
| `events_guard_update` | `events` | BEFORE UPDATE | **R6** — מעברי סטטוס חוקיים בלבד: ‏`draft→active`, ‏`draft→closed`, ‏`active→closed`; **R3** — פרסום (`draft→active`) דורש `event_date` קיים ו≥ מחר, אוסר שינוי תאריכים באותו UPDATE, ומבצע re‑check ל‑R2b; **R5** — ‏`event_date`/`rsvp_deadline` ננעלים לאחר יציאה מ‑draft; עריכת תאריכים ב‑draft מאומתת מחדש (R2+R2b); **R7** — סגירת אירוע נחסמת כשקיימים קמפיינים תפעוליים (`draft|pending_approval|approved|scheduled|active|paused`) |
| `campaigns_require_active_event` | `campaigns` | BEFORE INSERT OR UPDATE | **R9** — קמפיין במצב תפעולי (`pending_approval…paused`) מחייב `events.status='active'` |
| `campaigns_guard_cancel` | `campaigns` | BEFORE UPDATE | **R8** — מעבר ל‑`cancelled` מותר רק מ‑`draft|pending_approval|approved` בלי מחויבות פיננסית (ראו `cancel_campaign` ב‑§15); backstop בלתי‑תלוי‑קורא (SECURITY DEFINER) |

- **CHECK ‏(LC‑2)**: ‏`events_rsvp_deadline_within_event` — נשאר פעיל לצד הטריגרים ומכסה את מה ש‑CHECK יכול לבטא (ביטוי סטטי same‑row): ‏deadline מחייב `event_date` ו‑≤ יום האירוע בישראל. ה‑now() תלוי‑הזמן (חסם תחתון) נמצא בטריגרים בלבד, כי CHECK עם `now()` היה שובר dump/restore.
- **היסטוריה (LC‑1)**: במיגרציה `20260630072729` נוצרו שני טריגרי L0a — ‏`events_reject_past_event_date_insert` ו‑`events_reject_past_event_date_update` (עם הפונקציה `events_reject_past_event_date`) שחסמו `event_date` בעבר. הם **הוסרו** במיגרציית ה‑lifecycle ‏(`20260630223635`), שיצרה קודם את השומרים החדשים (סופרסט קפדני) ורק אחר כך הפילה את הישנים — כך שסה"כ הוגדרו לאורך ההיסטוריה **6 טריגרי שמירה** (2 L0a שהוסרו + 4 החיים כיום), ולידציית ה‑`rsvp_deadline`/`event_date` נאכפת כיום בטריגרים + CHECK + בתוך שלושת ה‑RPCs (שכבת L2: ‏`get_rsvp_by_token`, ‏`submit_rsvp`, ‏`try_record_billed_result`).

### טריגרי `updated_at`

כולם מריצים את `public.set_updated_at()` ‏BEFORE UPDATE ‏FOR EACH ROW (12 בסך הכול, אומת מול `pg_trigger`):

| טבלה | טריגר |
|---|---|
| `events` | `trg_events_updated` |
| `guests` | `trg_guests_updated` |
| `campaigns` | `trg_campaigns_updated` |
| `profiles` | `trg_profiles_updated` |
| `callback_requests` | `cb_set_updated_at` |
| `user_settings` | `user_settings_set_updated_at` |
| `app_settings` | `app_settings_set_updated_at` |
| `contacts` | `contacts_set_updated_at` |
| `organizations` | `organizations_set_updated_at` |
| `agreement_documents` | `agreement_documents_set_updated_at` |
| `message_templates` | `set_message_templates_updated_at` |
| `outreach_state` | `set_outreach_state_updated_at` |

### טריגרים נוספים

- `on_auth_user_created` על `auth.users` → ‏`handle_new_user()` (יצירת פרופיל).
- Event trigger ‏`ensure_rls` ‏(`ddl_command_end`) → ‏`rls_auto_enable()` (RLS אוטומטי על טבלאות חדשות ב‑`public`).

## 17. ניואנסים חשובים

1. **`events.event_date` הוא `timestamptz` — לא `date`; ‏`events.rsvp_deadline` הוא כן `date`.** כל השוואת "יום" נעשית במפורש ב‑Asia/Jerusalem (סשן ה‑DB הוא UTC). בקוד ה‑UI חותכים `slice(0,10)` לתצוגת/קלט תאריך של `event_date`.
2. **טוקני RSVP**: ‏`guests.rsvp_token` — bearer secret ציבורי; ‏default ב‑DB ‏(`encode(gen_random_bytes(16),'hex')`, ‏128 ביט, ‏CSPRNG) הוא הנקודה היחידה שמייצרת אותו (הקוד בכוונה לא קובע ערך). ‏`rsvp_token_revoked_at` מאפשר ביטול/רוטציה — טוקן מבוטל שקוף כ"לא נמצא" (ללא אות enumeration). מיגרציה 0034 ציינה שרוטציית טוקנים ישנים (קצרים מ‑32 hex) היא תיקון‑דאטה נפרד ומותנה‑אישור, לא חלק מהסכמה.
3. **הסכמה (consent)**: ‏`contacts.whatsapp_consent_at` — הסכמה שיווקית מפורשת פר‑ערוץ עם חותמת זמן; ‏`contacts.removal_requested` — ‏opt‑out שנאכף גם בשער החיוב; ‏`orders.terms_accepted`/`privacy_accepted`/`authorization_accepted` — הסכמות עסקה; ההסכם החתום מתועד ב‑`signed_agreements` עם ראיות (IP, ‏user agent, ‏OTP, ‏hash).
4. **PII ורגישות**: ‏`signed_agreements` ו‑`otp_challenges` הם admin‑only ללא קריאת owner; ‏`webhook_inbox.payload` מכיל PII גולמי ולכן admin‑only ולעולם לא נרשם ללוג; ‏`campaigns.card_citizen_id` (ת"ז) הוא PII שהצדקתו ותקופת שמירתו מעוגנות בהסכם; ‏`app_settings` מחזיק סודות ספקים ולכן אין בו קריאת authenticated.
5. **אידמפוטנטיות ודה‑דופליקציה ברמת DB**: ‏`billed_results (event_id, contact_id)` — חיוב יחיד פר איש‑קשר; ‏`contact_interactions (channel, provider_id)` — ‏retry של Meta לא מכפיל; ‏`webhook_inbox (provider, dedupe_key)`; ‏`orders.payment_attempt_ref` — ניסיון תשלום יחיד; ‏`contacts (event_id, normalized_phone)` — איש קשר יחיד פר טלפון; ‏`outreach_state (campaign_id, contact_id)` — סמן יחיד.
6. **"קמפיין אחד לאירוע"** הוא אילוץ אפליקטיבי (DAL) — אין UNIQUE על `campaigns.event_id` ב‑DB.
7. **הזרימה הכספית fail‑closed בכל שכבה**: דגלי `app_settings` כבויים כברירת מחדל; ‏SET קפוא ריק לא מחייב איש; ‏RPCs נעולים ל‑service_role; ‏RLS נותן ללקוח קריאה בלבד על טבלאות כסף.

## 18. Storage

| Bucket | ציבורי? | תוכן | גישה |
|---|---|---|---|
| `id-documents` | לא (private) | צילומי מסמכי זהות שנאספו באישור קמפיין (legacy — הוחלף באימות OTP), חתימות/PDF | **אין שום פוליסת RLS על `storage.objects`** בכוונה — כל גישה היא service‑role בלבד (העלאה דרך route מאומת; צפיית אדמין דרך signed URLs קצרי‑מועד שנוצרים בשרת) |

## 19. תור העבודות — pg‑boss (סכמת `pgboss`)

ה‑worker ‏(`worker/main.ts`, תהליך pm2 ‏`kalfa-worker`) משתמש ב‑**pg‑boss ‏v12** ‏(`pg-boss@^12.21.2`) עם `schema: 'pgboss'` — סכמה נפרדת באותו מסד Supabase, שמנוהלת כולה ע"י הספרייה (לא ע"י מיגרציות הפרויקט). טבלאות בפועל ב‑DB החי: ‏`job`, ‏`job_common`, ‏`job_dependency`, ‏`queue`, ‏`schedule`, ‏`subscription`, ‏`version`, ‏`warning`, ‏`bam`.

- **חיבור**: ה‑worker מתחבר ישירות ל‑Postgres דרך משתני `SUPABASE_DB_*` (ה‑session pooler של Supabase, פורט 5432 — המארח הישיר הוא IPv6‑only ולא נגיש מהשרת), עם `application_name: 'kalfa-worker'` ו‑`max: 4`.
- **תורים** (מוגדרים ב‑`src/lib/queue/queues.ts`): ‏`outreach-arm` ‏(cron כל דקה — זריעה/הזרוע של הצעד הנוכחי), ‏`outreach-step` (צעד בודד; ‏retryLimit 3 עם backoff ו‑dead‑letter ל‑`outreach-dead`), ‏`outreach-call-request`, ‏`outreach-sweeper` (כל 5 דקות — self‑heal), ‏`webhook-process` (כל דקה — ניקוז `webhook_inbox`).
- **הקשר לסכמת `public`**: העבודות נושאות מזהים בלבד (`campaignId`/`contactId`/`eventId`/`stepIndex`); כל המצב העמיד חי ב‑`public` — הסמן ב‑`outreach_state` (compare‑and‑advance + מזהי job דטרמיניסטיים ⇒ אידמפוטנטיות), הקליטה ב‑`webhook_inbox` (הטעינה דרך `claim_webhook_events`), והחיוב אך ורק דרך `try_record_billed_result`. שערי ההפעלה (`outreach_enabled` וכו') נבדקים בכל צעד, כך שה‑worker אינרטי עד go‑live.

## 20. היסטוריית מיגרציות

כל 47 המיגרציות מוחלות על ה‑DB החי (אומת מול `supabase_migrations.schema_migrations`). ארבע הראשונות הן placeholders ריקים (`;`) — הסכמה הבסיסית (events, guests, orders, packages, user_roles, profiles, וכו') נוצרה ישירות בפרויקט ה‑Supabase החי לפני שהריפו אימץ מיגרציות מנוהלות, וההיסטוריה יושרה (reconciled) מולה.

| קובץ | תקציר |
|---|---|
| `20260621214435_6e440290-…` | ‏placeholder ריק (יישור היסטוריה מול ה‑DB החי) |
| `20260622000810_ea62510e-…` | placeholder ריק |
| `20260622001354_ed18f6fc-…` | placeholder ריק |
| `20260622120000_harden_guests_rls` | placeholder ריק (ההקשחה בוצעה ישירות ב‑DB) |
| `202606240001_settings_and_sumit_payments` | ‏`user_settings` + פונקציית `set_updated_at` + RLS owner |
| `202606240002_order_payment_statuses` | הוספת `processing`, `payment_review` ל‑`order_status` |
| `202606240003_order_payment_flow` | עמודות תשלום ב‑orders ‏(`sumit_document_id`, `paid_at`, `payment_attempt_ref`, `payment_processing_started_at`) + ‏uniques + צמצום RLS ל‑SELECT‑only |
| `202606240004_orders_user_id_index` | אינדקס `orders_user_id_idx` |
| `202606240005_app_settings` | טבלת singleton ‏`app_settings` + ‏`payments_enabled` |
| `202606240006_payment_provider_settings` | קונפיג SUMIT ב‑app_settings + הסרת קריאת authenticated (סוד בטבלה) |
| `202606240007_outcome_billing_schema` | ליבת החיוב‑לפי‑תוצאה: enums ‏(`campaign_status`/`campaign_channel`/`billing_route`/`contact_op_status`), הרחבת `campaigns`, ‏`contacts`, ‏`billed_results`, ‏`contact_interactions`, ‏`billing_credits`, ‏`signed_agreements` |
| `202606240008_id_documents_bucket` | ‏bucket פרטי `id-documents` |
| `202606240009_campaign_templates` | ‏`packages.price_per_reached` + ‏`campaigns.template_id` + ‏seed תבניות |
| `202606240010_fix_template_names` | תיקון שמות/תיאורי התבניות (שני הערוצים בכל מסלול) |
| `202606240011_attempt_policy` | מדיניות ניסיונות קבועה על packages/campaigns (הוסרה ב‑0014) |
| `202606240012_single_track` | מסלול שירות יחיד; השבתת התבנית השנייה |
| `202606240013_template_channels` | ‏`packages.channels` — ערוצי המסלול כ‑data |
| `202606240014_outreach_schedule` | ‏`outreach_schedule` ‏jsonb על packages/campaigns; הסרת עמודות המדיניות הקבועה |
| `202606240015_sms_otp` | קונפיג ExtrA SMS ב‑app_settings + טבלת `otp_challenges` |
| `202606240016_agreement_otp_and_company` | ‏`verified_phone`/`otp_verified_at` ב‑signed_agreements + זהות משפטית ב‑app_settings |
| `202606240017_company_legal_config` | השלמת קונפיג משפטי (טלפון/מייל/URLים/אחריות) |
| `202606240018_smtp_email` | קונפיג SMTP ‏(IONOS) ב‑app_settings |
| `202606240019_dkim` | קונפיג DKIM (חתימה עצמית) ב‑app_settings |
| `202606260020_campaign_holds_flag` | ‏`campaign_holds_enabled` — ‏kill‑switch נפרד למסלול ה‑hold |
| `202606280021_org_multitenancy` | שלב 1 של multi‑tenancy: 7 טבלאות ארגון, 4 תפקידים קבועים data‑driven, ‏`has_org_permission` ‏ומשפחתה, ‏`events.org_id`, ‏backfill ארגון אישי |
| `202606290022_agreement_documents` | ‏enum ‏`agreement_status` + טבלת `agreement_documents` (ההסכם כ‑data) |
| `202606290023_agreement_config` | 7 עמודות `agr_*` ב‑app_settings (פרמטרי ההסכם) |
| `202606290024_billing_authorized_set` | ‏`campaign_authorized_contacts` (ה‑SET הקפוא) + ספי כיסוי ב‑app_settings + ‏`min_hold_floor`/`hold_buffer_pct` ב‑packages |
| `202606290025_campaign_auth_external_ref` | ‏`campaigns.auth_external_ref` — תיקון עוגן ה‑capture של SUMIT |
| `202606290026_campaign_card_expiry` | ‏`card_exp_month`/`card_exp_year` (נדרשים לחיוב טוקן שמור) |
| `202606290027_charge_findings` | ‏`card_citizen_id` + עמודות מחזור החיוב והקבלה (`charge_*`, `sumit_charge_document_id`, `charged_at`) |
| `202606290028_billing_backhalf` | דגלי `outreach_enabled`/`close_charge_enabled` + קונפיג WhatsApp + ‏`contacts.whatsapp_consent_at` + ה‑RPCs ‏`try_record_billed_result` ו‑`campaign_billing_summary` |
| `202606290029_billing_set_membership` | הוספת בדיקת חברות ב‑SET הקפוא ל‑`try_record_billed_result` ‏(`not_authorized`) |
| `202606290030_message_templates` | טבלת `message_templates` + ‏seed ‏5 מפתחות (fail‑closed) |
| `202606290031_max_contacts_not_null` | הידוק `campaigns.max_contacts` ל‑NOT NULL |
| `202606290032_outreach_state` | טבלת `outreach_state` (סמן המנוע) |
| `202606290033_whatsapp_waba_id` | ‏`app_settings.whatsapp_waba_id` |
| `202606290034_rsvp_harden` | הקשחת ה‑RSVP: נעילת `get_rsvp_by_token`/`submit_rsvp` ל‑service_role, ‏`rsvp_token_revoked_at`, טוקן 128‑ביט, ‏submit אידמפוטנטי + ולידציית תשובות, הסרת `eq_public_read` ו‑`rsvp_auth_insert` |
| `202606290035_webhook_inbox` | טבלת `webhook_inbox` ‏(persist‑then‑process) + הרחבת `contact_interactions` ‏(guest_id, delivery_*) |
| `202606300036_webhook_claim_skip_locked` | ‏RPC ‏`claim_webhook_events` ‏(FOR UPDATE SKIP LOCKED, ‏service_role בלבד) |
| `202606300037_message_template_components` | ‏`message_templates.components` ‏jsonb |
| `202606300038_lock_billing_rpcs` | ‏P0: נעילת שני ה‑RPCs של החיוב ל‑service_role (ביטול EXECUTE מ‑anon/authenticated/PUBLIC) |
| `20260630072729_events_date_guards_l0a` | ‏L0a: טריגרי LC‑1 (נגד `event_date` בעבר) + ‏CHECK ‏LC‑2 ‏(`events_rsvp_deadline_within_event`) |
| `20260630164747_l2_rpc_event_date_guards_and_billing_integrity` | ‏L2: שערי יום‑האירוע בתוך שלושת ה‑RPCs + נגזרת event_id מהקמפיין ‏(`event_mismatch`/`event_passed`) |
| `20260630223635_event_lifecycle_state_model` | מודל ה‑lifecycle ‏R1–R9: ‏`events_before_insert`/`events_guard_update`, החלפת טריגרי L0a, ‏`campaigns_require_active_event`, ‏`campaigns_guard_cancel` + ‏RPC ‏`cancel_campaign`, והוספת `event_not_active` ל‑`try_record_billed_result` |
| `20260630230249_event_lifecycle_trigger_revoke_public` | ביטול EXECUTE (קוסמטי, לשקט ה‑security advisors) משלוש פונקציות ה‑trigger החדשות |
