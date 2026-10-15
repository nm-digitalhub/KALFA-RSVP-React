# Design

## Context

Facts measured on 11.10.2026 that shape the approach (motivation: proposal.md - Why):

- **One signup path.** `signup()` in `src/app/auth/actions.ts` → `supabase.auth.signUp`. The `sales_referral` link lands on the same form. There is no OAuth or magic-link signup in `src`. Duplicate signups are detected by `isExistingUserSignup(data)`. There is no session until the email is confirmed in `confirmOtp()` (`src/app/auth/confirm/actions.ts`), which handles both `signup` and `email_change`.
- **`profiles` is user-writable in every column.** `own_profile_write` is FOR ALL, and authenticated holds UPDATE on every column. This was proved with an aborted write test. Supabase's column-level-security guide recommends a dedicated table over column privileges. `signup_terms_acceptances` (migration `20261011062921`) is the precedent: server-only writes and immutable rows.
- **Account deletion.** The only code path is `unconfirmed-signup-cleanup.ts` → `auth.admin.deleteUser`, which applies to unconfirmed accounts only. Staff can also delete from the Supabase dashboard.
- **Resend.** SDK 6.28.1 is installed. `contacts.create/update/remove` exist, and so does the `WebhookEvent` type `contact.updated`. That event's payload carries `email`, `unsubscribed` and `updated_at`, but not topic state (per the Resend docs read via ctx7). A Topic's `defaultSubscription` cannot be changed after creation. The webhook route (`src/app/api/webhooks/resend/route.ts`) verifies the signature, persists to `webhook_inbox`, and handles only `email.*`. `email.complained` is stored and then ignored.
- **Client IP.** `rdpClientIp` (`src/lib/rdp-access/client-ip.ts`) reads `x-real-ip` and validates it with `isIP`. nginx sets that header from `$remote_addr` (`/etc/nginx/conf.d/beta-proxy.conf:36`). `getClientIp` in `rate-limit.ts` trusts the first `x-forwarded-for` entry, which the client controls.
- **Jobs.** pg-boss queues (`src/lib/queue/queues.ts`) with deterministic job ids. The `signup-reminder-sweep` is the existing pattern for a scheduled sweep.

## Goals / Non-Goals

**Goals:**
- The consent record can be produced in a claim: it is complete, ordered, and unalterable by the customer.
- The provider list never holds a subscribed address without a current, confirmed grant.
- No customer-facing action fails because the provider is down.

**Non-Goals:**
- Topics or several consent categories. One consent, one box (see D4).
- Any marketing send, template or broadcast.
- Reading consent history on the customer's screen beyond the current on/off state.
- Re-permission of existing accounts.

## Decisions

**D1. A dedicated append-only table, `marketing_consent_events`.** Columns: `id`, `user_id uuid`, `email text not null`, `action` (`grant` | `withdraw`), `source` (`signup` | `settings` | `provider_unsubscribe` | `provider_complaint` | `account_removed`), `wording text`, `wording_version text` (both required for grants), `ip inet`, `user_agent text`, `provider_event_id text` (unique when present), `occurred_at timestamptz default now()`.
- RLS on, with no policies. `revoke all` from `anon`, `authenticated` and `service_role`. Then grant `service_role` SELECT and INSERT only. A trigger blocks UPDATE and DELETE.
- *Alternative rejected:* a column on `profiles` or `user_settings`. Both are user-writable (measured). This is the same problem as `phone_verified_*`.

**D2. `user_id` has no foreign key.** With `on delete cascade`, deleting the account would delete the evidence. With `on delete set null`, the cascade's UPDATE would hit the no-UPDATE trigger and break `auth.admin.deleteUser`. With RESTRICT, account deletion stops working altogether. A plain `uuid`, plus the `email` stored on every row, keeps the evidence and leaves deletion working. Indexes are on `(user_id, occurred_at desc)` and `(lower(email), occurred_at desc)`.

**D3. The server writes the grant at signup, after the duplicate check.** `signup()` inserts the grant with the service-role client, and only after `isExistingUserSignup` returns false. That way a duplicate signup is never recorded against a fake id.
- *Alternative rejected:* pass the consent through `user_metadata` and let `handle_new_user()` write it. The IP would then live forever in `auth.users.raw_user_meta_data`. Also, anyone holding the anon key can call `signUp` with arbitrary metadata, so the trigger could not tell a real form apart.

**D4. One consent, mapped to Resend's contact-level `unsubscribed` flag, with no Topics.** That flag is the one field `contact.updated` reports. Topic changes are not in the payload, and whether they emit a webhook at all is unverified. A Topic's default cannot be changed later. Topics can come in a later change, when there is more than one kind of marketing mail. The Resend contact holds the email address only, no name: the minimum data needed.

**D5. Sync is one idempotent job plus a daily reconcile.**
- **The job:** each consent change, each email confirmation and each email change enqueues `marketing-contact-sync` for the user, with a deterministic id per user and minute. The job reads the user's current confirmed email (`auth.admin.getUserById`) and their latest consent. It then sets Resend to match: subscribed when the latest action is a grant and the email is confirmed, unsubscribed otherwise. It also unsubscribes every older address of that user found in the ledger. pg-boss retries on failure, so the customer's action never waits on Resend.
- **The daily reconcile** handles drift. It covers accounts deleted from the dashboard (a ledger email with no user and a latest grant: unsubscribe, and record an `account_removed` withdrawal) and any failed job that ran out of retries.
- *Alternative rejected:* call Resend inline in the action. A Resend outage would then either fail the customer's action or silently lose the update.

**D6. A provider unsubscribe can only withdraw, never grant.**
- `contact.updated` with `unsubscribed: true` records a `provider_unsubscribe` withdrawal, but only if the user's latest record is a grant older than the event's `updated_at`. Our own push therefore echoes back as a no-op.
- `unsubscribed: false` is ignored: consent comes only from the customer, through our forms.
- Repeat delivery is ignored through the unique `provider_event_id` (the `svix-id`).
- Persist-then-process stays as it is: the event is stored in `webhook_inbox` with a new `event_kind`, `marketing_contact`.

**D7. A complaint is a withdrawal.** `email.complained` for an address whose latest record is a grant writes a `provider_complaint` withdrawal and enqueues the sync. This is conservative: a complaint about any KALFA email ends marketing consent.

**D8. One client-IP helper.** `rdpClientIp` moves to a shared module (`src/lib/security/client-ip.ts`). RDP access imports it from there, and the old file is deleted. This avoids a second copy.

**D9. The wording is server-side, versioned, and released only after approval.** The wording and its version live in one module. The form renders the module's wording, and the action records the module's wording, so the browser never supplies either. The checkbox and the settings toggle ship behind `app_settings.marketing_consent_enabled` (default false, the same pattern as `whatsapp_consent_required`), so the code can deploy before the wording is approved. The wording below was approved by the owner on 11.10.2026 (no lawyer review needed, owner ruling):
> "אני מאשר/ת לקבל מ-{company} עדכונים, טיפים והצעות בדוא״ל. אפשר להסיר בכל עת בלחיצה על "הסרה" בכל הודעה או בהגדרות החשבון."

`{company}` is `company_profile.company_legal_name` (live value 11.10.2026: "נתנאל מבורך קלפה - KALFA RSVP"); the recorded wording is the rendered text.

## Risks / Trade-offs

- [The ledger keeps an email address after account deletion. That is personal data kept under the Privacy Protection Law.] → It is kept only as evidence of consent. Its retention period is a question for the lawyer (attorney-questions list). Nothing else is kept.
- [Resend's hosted unsubscribe flow could change Topic state instead of `unsubscribed`.] → D4 uses no Topics. Before release, a sandbox test confirms that the unsubscribe link in a test broadcast sets `unsubscribed: true` and fires `contact.updated`.
- [The webhook subscription to `contact.updated` is a dashboard setting.] → It is a release task for the owner. The daily reconcile also reads Resend's contact state, so a missed event is caught within a day.
- [A grant written at signup belongs to an unconfirmed address.] → It is stored, but never synced until confirmation (D5). The unconfirmed-signup cleanup deletes the account and leaves the ledger row, which never reaches Resend.
- [A spam complaint on a transactional email also ends marketing consent.] → Accepted on purpose (D7).

## Migration Plan

1. Migration (`supabase migration new marketing_consent_events`): the table, grants, trigger, indexes, and the `app_settings.marketing_consent_enabled` column (default false). Run a dry-run, push with approval, then `gen:types` and `types:check`.
2. Deploy the code with the flag off. Nothing changes for customers.
3. Owner tasks: approve the wording and the privacy text; subscribe the Resend webhook to `contact.updated`; run the sandbox unsubscribe test.
4. Turn the flag on in admin settings.

Rollback: turn the flag off. The data stays. The table's rollback (`drop table`) is written in the migration header, but it is never run while evidence exists in the table.

## Open Questions

- How long to keep consent records after an account is deleted. This is a lawyer's answer; the code keeps them until a retention job is added.
