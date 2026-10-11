# Tasks

## 1. Consent ledger (database)

- [x] 1.1 Create the migration with `npx supabase migration new marketing_consent_events`. It adds: table `marketing_consent_events` per design D1/D2 (no FK on `user_id`, CHECKs on `action`/`source`, grant rows require `wording` and `wording_version`, partial unique index on `provider_event_id`, indexes on `(user_id, occurred_at desc)` and `(lower(email), occurred_at desc)`); RLS on with no policy; `revoke all` from anon/authenticated/service_role, then `grant select, insert` to service_role; BEFORE UPDATE OR DELETE trigger that raises; `app_settings.marketing_consent_enabled boolean not null default false`; header with why, rollback and "never drop while evidence exists". Verify: `npx supabase db push --linked --dry-run` lists only this file.
- [x] 1.2 With the owner's approval, push it, run `npm run gen:types` and `npm run types:check`. Verify with live read-only queries: `has_table_privilege` shows no INSERT/UPDATE/DELETE for `authenticated`/`anon`; an aborted block as an authenticated user gets 0 rows / permission denied on insert and update.

## 2. Shared helpers

- [x] 2.1 Move `rdpClientIp` to `src/lib/security/client-ip.ts` (exported as `socketClientIp`), point the RDP code at it and delete `src/lib/rdp-access/client-ip.ts`. Verify: existing RDP tests pass and a new unit test shows a forged `x-forwarded-for` is ignored and a non-IP `x-real-ip` gives null.
- [x] 2.2 Add the consent wording module (`src/lib/marketing/consent-wording.ts`: wording, version) with the draft text from design D9 marked as awaiting approval. Verify: a unit test pins that the version changes whenever the wording changes (hash check).
- [x] 2.3 Add `src/lib/data/marketing-consent.ts`: `recordConsent` (service-role insert, server wording), `currentConsent(userId)` (latest row), `isMarketingConsentEnabled()` (reads the flag). Verify: unit tests for grant/withdraw ordering, no-op when the action equals the current state, and that guest tables are never queried.

## 3. Signup

- [x] 3.1 `signupSchema` gets an optional `marketing_opt_in` (`'on'` or absent; any wording/version field is not part of the schema). Verify: `schemas.test.ts` cases for absent, `'on'`, and junk values.
- [x] 3.2 `signup-form.tsx` renders the unchecked box with the server wording, only when the flag is on, after the terms box. Verify: a component test shows it unchecked by default and absent when the flag is off; RTL layout matches the terms box.
- [x] 3.3 `signup()` records a grant (source `signup`, IP from `socketClientIp`, user agent) only when the box is ticked, the flag is on and `isExistingUserSignup` is false; a ledger failure is logged and never fails the signup. Verify: new `signup()` tests in `src/app/auth/actions.test.ts` (none exist today) for ticked, unticked, duplicate address, forged wording field, and ledger failure.

## 4. Settings

- [x] 4.1 The settings page reads the current consent server-side and shows a marketing-email toggle in the notifications section when the flag is on; a server action records grant/withdraw (source `settings`) only on an actual change and enqueues the sync. Verify: action tests for grant, withdraw, unchanged; page test that the state comes from the ledger, not the browser.

## 5. Resend sync

- [ ] 5.1 Verify in a Resend sandbox (owner-provided test key, test address) that `contacts.create` works without an audience in SDK 6.28.1, and that the unsubscribe link of a test broadcast sets `unsubscribed: true` and fires `contact.updated`. Record the result in the design. Verify: the recorded payloads. **Partly verified live 11.10.2026: `contacts.create` without an audience works, and an update fires `contact.updated`. Still open: the unsubscribe link inside a real broadcast.**
- [x] 5.2 Add `src/lib/email/marketing-contacts.ts` (create/update `unsubscribed`, by email, email only) and the `marketing-contact-sync` pg-boss queue + handler per design D5 (current confirmed email from Auth, latest consent, older ledger addresses unsubscribed). Verify: handler tests with a fake Resend client for grant+confirmed, grant+unconfirmed, withdraw, email changed, Resend error rethrown for retry.
- [x] 5.3 Enqueue the sync from `confirmOtp()` for `signup` and `email_change` after a successful verify, and from the settings action. Verify: tests that the job is enqueued with a deterministic id and that a queue failure does not change the redirect.
- [x] 5.4 Add the daily reconcile sweep (deleted accounts → `account_removed` withdrawal + unsubscribe; drift between ledger and Resend contact state → resync). Verify: sweep tests, including that it reads only `auth.users`/`profiles`/the ledger.

## 6. Provider events back into the ledger

- [x] 6.1 Webhook: add `contact.updated` to the handled events, persisted with `event_kind = 'marketing_contact'`; processing writes a `provider_unsubscribe` withdrawal per design D6 (only `unsubscribed: true`, only if the latest record is an older grant, deduped by `svix-id`). Verify: route and processing tests for unsigned, duplicate, out-of-date, our own echo, and `unsubscribed: false`.
- [x] 6.2 `email.complained` for a customer whose latest record is a grant writes a `provider_complaint` withdrawal and enqueues the sync. Verify: processing test; a complaint for a non-customer address writes nothing.

## 7. Legal text

- [x] 7.1 Draft the privacy-page changes (sections 2, 3, 5 incl. Resend as the email provider, 9 separating guests from consenting customers, update date) and a terms clause if the lawyer wants one; keep them out of production until approved. Verify: the owner's written approval of wording and text is recorded in this change. **Recorded 11.10.2026: the owner approved the consent wording (version 2026-10-11.1) and the privacy passages, and ruled that no lawyer review is needed.**

## 8. Release

- [x] 8.1 Run `npm run lint`, `npx tsc --noEmit`, `npm run build` and the full test suite; run the runtime check of the signup form and settings toggle with the flag on in a test account. Verify: all green and screenshots of both screens. **Done 11.10.2026: lint/tsc clean, 12,427 tests pass, build passed in the owner's deploy. Live with the flag on: the signup page serves the `marketing_opt_in` box; the owner granted then withdrew in settings — two ledger rows (settings, version 2026-10-11.1, socket IP and user agent), two sync jobs completed, the Resend contact was created subscribed and then set unsubscribed, and Resend's contact.updated echo was stored and processed without adding a row.**
- [ ] 8.2 Owner: subscribe the Resend webhook to `contact.updated`, approve wording and privacy text, then turn `marketing_consent_enabled` on. Verify: a test signup with the box ticked shows a grant row and, after confirmation, a subscribed Resend contact. **11.10.2026: webhook subscribed to contact.updated (via API, owner approved), wording approved, flag on. The test went through settings because the test address already had an account; a fresh signup has not been tested live.**

## Workflow follow-up

- Archive the change after release and review.
- Next change (not this one): the actual marketing sequences, built only for customers with a current grant.
