The audit report for the admin-data and core slice (165 files, 29.5k lines) is in team-lead's inbox. Nothing was changed: Serena reads only, no Bash, no files written. The full report is below.

**(a) Module map**
- **Admin data** (`src/lib/data/admin`, 55 files, 15.4k lines):
  - Gated data-access modules (one per admin screen).
  - Provider config and orchestration: `channels`, `voximplant-channel`, `integrations/*`.
  - Helpers: pagination, audit primitive, label and money mappers, nav counts and visibility, caches.
- **Ops** (9 files): health checks, integration flags, queue schedule, device telemetry, the supabase-cli runner.
- **Core:**
  - `auth`: three permission-check layers (string-key in `dal.ts`, CASL in `platform-ability.ts`, bearer-token in `console-agent.ts`) and the generator for staff-table SQL and pgTAP tests.
  - Other core folders: supabase clients, validation (23 files), security, http, analytics, alerts, consent, i18n, seo, faq, dnc, testing.

**(b) Mixed concerns** (MEASURED unless marked)
- **One function, many jobs:**
  - `contacts.ts:194-322`: database reads, SMTP send, error mapping and writes in one function.
  - `callbacks.ts`: DB reads, ElevenLabs JSON coercion, a voicemail inference rule (314-324) and funnel attribution across four tables (617-665).
  - `coupon-assignments.ts:93-261`: pricing, RPC call, and errors matched by message text (188-194).
- **Provider calls and file reads inside data modules:**
  - `fleet.ts` reads the fleet config file from disk. Its comment says errors are matched on the code, but only 42501 is (line 381); 382-384 match message text.
  - `channels.ts:85-119` makes a raw Graph API fetch inside the data module.
- **Layer inversions:** `labels.ts:2` imports a type from `components/ui/badge`; `support.ts:10` imports from `app/(customer)`.
- **Two ways to check a platform permission:**
  - The string key `requirePlatformPermission` has 549 references in 135 files.
  - CASL `requirePlatformAction` has 57 references in 16 files, and the CASL map covers only 4 subjects.
  - `dal.ts` has both `isPlatformStaff` and `isStaff`, with the same description but different database functions.
- **Stale comments:** `ops/db-health.ts:11-13` and `ops/app-health.ts:9-10` say admin modules have no permission check of their own. In fact 48 of 55 call one; the other 7 are helpers.
- **Security (one line):** `support.ts:104-113` and `261-273` write to `support_access_log` directly. Those rows have no permission, subject_type or subject_id. This skips `recordStaffAccess`, "the single audited-read primitive", which the same file uses at line 179.

**(c) Large files:** a table of 24 files over about 400 lines, each with its line count and responsibilities. 15 of the 24 descriptions are INFERRED from symbols and imports only.

**(d) Duplication**
- **Account lookup by email, three ways:**
  - `support.ts:340` reads only the first page of 200 users, so by construction it misses accounts beyond that.
  - `coupon-assignments.ts:465` uses an RPC with no page limit.
  - `users.ts` scans 10 pages by substring.
- **Phone masking:** `maskPhoneForDisplay` is defined twice with the same name and different output (`phone.ts:62` and `data/console-calls.ts:3384`). A third variant is in `coupon-assignments.ts:300`.
- **Cache:** the cached-fetch code in `ga4-dashboard.ts` and `search-console.ts` has diverged in how it handles concurrent requests.
- **Page size:** hard-coded in 4 modules, although `shared.ts:5-6` says it never is.
- **`app_settings`:** the `SETTINGS_ID = true` constant is declared 10 times.
- **Search-term cleaning:** 7 places with different character sets.
- **Result types:** `FormState` and `ActionResult` in `validation/result.ts` have no references; `ConnectionTestResult` is declared twice.
- **Documented, intentional duplicates** (not defects): the app-origin parsing, the client-IP functions and the two Voximplant balance caches.
- **WhatsApp error codes:**
  - `src/whatsapp-error-codes.ts` has no importers (MEASURED).
  - It looks like a leftover from the older `scripts/generate.mjs`, which still defaults to writing it (INFERRED: its schema is a subset of the live catalog).
  - The live catalog is `src/lib/whatsapp/generated/error-codes.ts`, imported by `src/lib/whatsapp/error-labels.ts`.

**(e) Coverage:** every file got a symbols overview and an import and pattern scan. 26 files were read in full and about 20 in part, with ranges cited in the report. My first file listing missed `ga4-types.ts` and `marketing/event-types.ts`; I added both and read their opening sections.