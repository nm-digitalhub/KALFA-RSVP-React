# Form ⇄ Table Wiring Map (existing forms → DB columns)

> מיפוי מלא של **שדות הטפסים הקיימים ↔ עמודות הטבלאות**, מחולץ מהקוד החי: שמות שדות (`name=`) →
> סכמת Zod (`src/lib/validation/*`) → עמודות DB (introspection חי). מסומן: ✓ מחווט · ⚠ פער · ﹡ מכוון.
> נגזר ישירות מהקוד הקיים — לא נוצר קוד חדש (תואם [[reuse-existing-no-duplication]]).

## A. Form → Table matrix

| Form file (`src/app/…`) | Form fields | Zod schema | Target table(s) → columns | Status |
|---|---|---|---|---|
| `auth/login/login-form` | email, password | `loginSchema` | `auth.users` (Supabase auth) | ✓ |
| `auth/signup/signup-form` | email, full_name, phone, (password) | `signupSchema` | `auth.users` + trigger `handle_new_user` → `profiles.full_name/phone` | ✓ |
| `…/events/new/new-event-form` | name, event_type, event_date, venue_name | `createEventSchema` | `events`: name, event_type, event_date, venue_name (owner_id/org_id/status server-set) | ✓ |
| `…/events/[id]/edit-event-form` | name, event_type, event_date, venue_name, venue_address, rsvp_deadline, status | `updateEventSchema` | `events`: + venue_address, rsvp_deadline, status | ✓ |
| `…/events/[id]/guests/guest-form` | full_name, phone, expected_count, status, group_id, note, contact_status | `createGuestSchema` | `guests`: full_name, phone, expected_count, status, group_id, note, contact_status (event_id/rsvp_token server/DB) | ✓ |
| `…/guests/import/import-form` | file | `importRowSchema` (per row) | `guests` (bulk insert) | ✓ |
| `…/campaign/new/new-campaign-form` | template_id, start_at, close_at | `campaignTermsSchema` | `campaigns`: template_id, start_at, close_at (steps/price_per_reached/max_contacts/ceiling/allowed_channels/outreach_schedule derived from package at create) | ✓ |
| `…/campaign/[id]/approve/sign-agreement-form` | terms_accepted, privacy_accepted, authorization_accepted, signature, otp_code | `approveCampaignSchema`/`agreementApproveSchema` | `orders`: terms/privacy/authorization_accepted · `signed_agreements`: signature_ref, verified_phone, otp_verified_at · `campaigns`: tos_version, approved_at/by, status · OTP via `otp_challenges` | ✓ |
| `…/app/settings/settings-client` | full_name, phone, new_email, event_updates, reminder_updates, billing_updates | `updateProfileSchema` + `emailChangeSchema` + `updateSettingsSchema` | `profiles`: full_name, phone · `auth.users`: email · `user_settings`: event_updates, reminder_updates, billing_updates | ✓ |
| `…/app/team/team-client` | email, role_id, member_id, invitation_id | `inviteMemberSchema`/`changeMemberRoleSchema`/`memberIdSchema`/`invitationIdSchema` | `organization_invitations`: email, role_id, token · `organization_members`: role_id | ✓ |
| `admin/callbacks/callback-status-form` | id, status | `updateCallbackStatusSchema` | `callback_requests`: status (full_name/phone/topic/note created by public request) | ✓ |
| `admin/channels/channels-client` | outreach_enabled, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_app_secret, whatsapp_verify_token | (inline in `data/admin/channels`) | `app_settings`: same 6 columns | ✓ |
| `admin/company/company-form` | company_legal_name, company_legal_id, company_legal_address, company_contact_phone, company_contact_email, privacy_url, terms_url, warranty_text | `companySettingsSchema` | `app_settings`: same 8 columns | ✓ |
| `admin/settings/settings-form` | payments_enabled, sumit_company_id/api_public_key/api_key, sms_enabled, extra_sms_sender/token, email_enabled, smtp_host/port/secure/user/password/from | `appSettingsSchema` | `app_settings`: same columns | ✓ |
| `admin/agreement/agreement-config-form` | serviceActivationWindow, offerValidityDays, chargeWindowDays, holdReleaseDays, liabilityCap, retentionDays, recordRetentionMonths | (inline) | `app_settings`: `agr_service_activation_window`, `agr_offer_validity_days`, `agr_charge_window_days`, `agr_hold_release_days`, `agr_liability_cap`, `agr_retention_days`, `agr_record_retention_months` | ✓ |
| `admin/agreement/agreement-client` | version, body_html | `agreementEditSchema` | `agreement_documents`: version, body_html, status, approved_by/at | ✓ |
| `admin/packages/package-form` | name, tier, category, price_with_vat, description, includes, sort_order, active | `packageBaseSchema` | `packages`: same 8 columns | ✓ (partial — see ⚠ B) |
| `admin/templates/templates-client` | name, body, language, active, id | (inline) | `message_templates`: name, body, language, active · `message_key`/`channel`/`label` are display/fixed | ✓﹡ |
| `admin/sumit-test/sumit-test-form` | amount, vat_rate, authorize_amount, auto_capture, prevent_document_creation, card_token_not_needed, email | (test harness) | none (SUMIT live-test tool) | ✓﹡ |

## A.2 Action-driven & inline forms (no visible `name=` — button/hidden-input pattern)

> These were missed by the `name=`-only extraction (they pass data via bound args / hidden inputs / SUMIT JS).
> Full sweep via `useActionState|<form|action={` + every `actions.ts`. Especially the **event-detail lifecycle**.

| UI surface | Action(s) | Target table → columns | Status |
|---|---|---|---|
| `events/page` + `events/actions` | `createEventAction` (+ delete) | `events` | ✓ |
| `events/[id]/page` + `[id]/actions` | `updateEventAction` | `events` (edit) | ✓ |
| `campaign/new` | `createCampaignAction` | `campaigns` (+ derived billing cols from package) | ✓ |
| **`campaign/[id]/manage-client`** | `activateCampaignAction`, `pauseCampaignAction`, `closeCampaignAction`, `settleCampaignAction` | `campaigns.status` + lifecycle/billing (`capture_status`, `release_status`, `charge_*`, `final_charge_amount`, `charged_at`) | ✓ (wired by c3c04a3) |
| `campaign/[id]/approve/sign-agreement-form` | `requestSigningOtpAction`, `signAgreementAction` | `otp_challenges`, `signed_agreements`, `campaigns.tos_version/approved_*` | ✓ |
| **`campaign/[id]/payment/hold-form`** | authorize route (J5 hold) | `campaigns`: `auth_amount`, `auth_number`, `authorized_at`, `auth_expires_at`, `card_token_ref` | ✓ |
| `orders/[id]/pay/payment-form` | `payPendingOrderAction` / pay route | `orders`: `status`, `paid_at`, `sumit_document_id`, `payment_attempt_ref`, `payment_processing_started_at` | ✓ |
| `guests/[guestId]/page` + `guest-form` | `updateGuestAction` | `guests` (edit) | ✓ |
| `guests/guest-row-actions` | `deleteGuestAction` | `guests` (delete) | ✓ |
| **`guests/contact-status-cell`** | `setContactStatusAction` | `guests.contact_status` | ✓ |
| **guest groups** (`guests-actions`) | `createGroupAction`, `deleteGroupAction` | `guest_groups` | ✓ |
| `guests/guest-list-controls` | `search` (query only) | — (read/filter) | ✓ |
| **`admin/users/[id]/user-actions`** | `setPlatformAdmin`, `setUserSuspended`, `grantBillingCredit`, `updatePlan` | `user_roles`, auth ban, `billing_credits` (event_id, amount, reason), `orders.package_id` | ✓ |
| `admin/packages/[id]/delete-package-form` | `deletePackageAction` | `packages` (delete) | ✓ |
| `admin-access/claim-admin-form` | `claim_first_admin` RPC | `user_roles` | ✓ |
| `join/[token]/page` | `accept_invitation` RPC | `organization_members`, `organization_invitations` | ✓ |

**Net:** the event-detail lifecycle (activate/pause/close/settle), J5 hold, order pay, guest micro-actions, groups,
and admin user/plan/credit are all **wired** — they were absent from the first matrix but exist in code. No NEW gaps
surfaced here. The gaps in §D stand: packages outcome-billing fields, the RSVP surface, event_questions, app_settings ops gates.
One minor addition: `guests/[guestId]/page` shows `guest.status` but does **not** read `rsvp_responses` rows (no reader) →
the detailed response isn't surfaced (ties to the RSVP gap).

## B. Columns with NO form field (reverse gaps)

| Table | Columns with no UI form field | Severity | Note |
|---|---|---|---|
| **packages** | `price_per_reached`, `channels`, `outreach_schedule`, `min_hold_floor`, `hold_buffer_pct` | **⚠ HIGH** | The **outcome-billing core** ([[outcome-billing-model]]). Verified: grep empty in package-form / `data/admin/packages.ts` / `validation/admin.ts`. Set only via SQL/seed → admin cannot configure per-reached price, channels, schedule, or hold floor in the UI. |
| **guests** | `confirmed_adults`, `confirmed_kids`, `meal_pref`, `language` | **⚠ HIGH** | `confirmed_*`/`meal_pref` are RSVP-response fields — only fillable via the **missing public RSVP page** (see C). `language` never set in UI. |
| **app_settings** | `close_charge_enabled`, `campaign_holds_enabled`, `reasonable_coverage_contacts`, `extreme_threshold_contacts`, `dkim_domain`, `dkim_selector`, `dkim_private_key` | **⚠ MED** | Billing/coverage config gates + email DKIM — no admin form field; only SQL-managed. |
| **events** | `notes`, `with_ai_calls`, `template`, `package_id` | ◦ LOW | `package_id` set via order/campaign flow; `notes`/`with_ai_calls`/`template` have no editor (verify if intended). |
| **campaigns** | charge/auth/capture lifecycle cols | ◦ N/A | Written by billing engine (J5/close-charge), not a form. ✓ by design. |

## C. Orphan tables — NO form writes them at all

| Table | State | Severity | Bridge |
|---|---|---|---|
| **event_questions** | anon-read RLS exists; **zero app code** (verified grep empty) | **⚠ HIGH** | Needs (a) owner authoring UI, (b) render on the RSVP page. |
| **rsvp_responses** | table + RLS exist; **zero app code** (verified grep empty) | **⚠ HIGH** | Written only by the **missing** public RSVP submit (see `plans/public-rsvp-implementation.md`). |

## D. Prioritized gap list (from this map)

1. **⚠ HIGH — packages outcome-billing fields not editable in admin UI.** Extend `admin/packages/package-form` +
   `packageBaseSchema` + `data/admin/packages.ts` to manage `price_per_reached`, `channels`, `outreach_schedule`,
   `min_hold_floor`, `hold_buffer_pct`. **Wire INTO the existing package form** — do not create a parallel editor.
2. **⚠ HIGH — public RSVP surface missing** (rsvp_responses + guests.confirmed_*/meal_pref orphaned). → `plans/public-rsvp-implementation.md`.
3. **⚠ HIGH — event_questions orphan** (no authoring UI, no render). Owner-side authoring form + RSVP-page render.
4. **⚠ MED — app_settings ops gates** (`close_charge_enabled`, `campaign_holds_enabled`, `reasonable_coverage_contacts`,
   `extreme_threshold_contacts`, `dkim_*`) not in admin UI. Add to the **existing** `admin/settings` / `admin/channels` forms (decide grouping).
5. ◦ LOW — confirm intent for `events.notes`/`with_ai_calls`/`template`.

> Method: every bridge above names the EXISTING form/schema/data-layer file to extend ([[reuse-existing-no-duplication]]).
> This map folds into the master gap plan alongside the two running audits.
