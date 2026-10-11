# Proposal

## Why

KALFA cannot send marketing email to its customers today: no customer has ever been asked, and the database records no consent to marketing email anywhere (measured 11.10.2026: no marketing column in any public table; the only consent records are WhatsApp, call, cookie and signup-terms). Israeli anti-spam law (Communications Law §30A) requires express prior written consent, and in a claim the advertiser has to prove it. The privacy policy also says the opposite today: section 3 limits data use "אך ורק לאספקת השירות" and section 9 says "ללא תוכן פרסומי של KALFA".

This change builds the consent half only. No marketing email is sent by it.

## What Changes

- **Consent at signup.** The signup form gets an optional, unchecked box for KALFA marketing email. The server, not the browser, decides the wording shown and its version.
- **Consent in settings.** A customer can grant or withdraw marketing-email consent at any time from `/app/settings`.
- **A consent record no user can alter.** Every grant and every withdrawal is an append-only row written only by the server. Each row holds who, which email, what action, from where (signup, settings, Resend unsubscribe, complaint), the exact wording and its version, the IP, the user agent and the time. Supabase recommends a dedicated table for this rather than columns on `profiles`, and the project verified on 11.10.2026 that the user can write every column of their own `profiles` row.
- **Only proved addresses reach the mailing list.** A consent is pushed to Resend only after the email address is confirmed. Withdrawal, account email change and account deletion are pushed as well.
- **Unsubscribes come back.** An unsubscribe in a Resend email, and a spam complaint, are recorded as a withdrawal in the consent record. The Resend webhook currently drops every `contact.*` event.
- **Guests are excluded by construction.** The sync reads only customers (`auth.users` and `profiles`), never the `contacts` or `guests` tables.
- **Privacy policy text** (sections 2, 3, 5, 9 and the update date) is rewritten to describe marketing email to consenting customers. The final consent wording and policy text are approved by the owner, after legal review, before release.

## Capabilities

### New Capabilities
- `marketing-consent`: how a customer grants and withdraws consent to KALFA marketing email, and how each change is recorded as evidence.
- `marketing-contact-sync`: how recorded consent is reflected in the email provider's contact list, and how unsubscribes and complaints from the provider flow back into the consent record.

### Modified Capabilities
None. `openspec/specs/` has no capabilities yet.

## Impact

- **Database:** one new append-only table, created with `supabase migration new`. RLS on, no write grant to `anon`, `authenticated` or `service_role`; a trigger blocks UPDATE and DELETE. Pushed only with the owner's approval.
- **Code:** `src/app/auth/signup/signup-form.tsx`, `src/app/auth/actions.ts` (`signup`), `src/lib/validation/schemas.ts`, `src/app/auth/confirm/actions.ts`, `src/app/(customer)/app/settings/*`, `src/app/api/webhooks/resend/route.ts`, `src/lib/data/webhook-processing.ts`, a new `src/lib/data/marketing-consent.ts`, and a new Resend contacts module next to `src/lib/email/`.
- **Resend:** the installed `resend` SDK (6.28.1) already exposes Contacts and the `contact.updated` webhook type, so no upgrade. The owner must subscribe the webhook to `contact.updated` in the Resend dashboard.
- **Legal text:** the privacy page, and possibly the terms page.
- **Out of scope:** writing or sending any marketing email, broadcasts, sequences, holiday calendars, and re-permission of the 6 existing accounts.
