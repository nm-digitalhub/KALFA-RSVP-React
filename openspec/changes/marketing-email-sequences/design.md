# Design

## Context

Motivation: proposal.md - Why. Facts measured on 11.10.2026:

- **Consent is live.** `marketing_consent_events` is append-only and readable only by service_role. `currentConsent(userId)`, `latestConsentForEmail` and `recordConsent` live in `src/lib/data/marketing-consent.ts`, and `enqueueMarketingContactSync` lives in `marketing-contact-sync.ts`. The ledger's `source` CHECK allows `signup | settings | provider_unsubscribe | provider_complaint | account_removed`.
- **Templates.** `src/lib/email/templates.ts` builds Hebrew RTL mail with `react-email` (6.11.1) through `createElement` + `render`. It sets `lang`/`dir` on both `<Html>` and `<Body>`, returns `{subject, html, text}`, and does no I/O.
- **Sending.** `EmailSender.send` (`src/lib/email/sender.ts`) calls `resend.emails.send` with `idempotencyKey` and threading headers. It has no way to pass arbitrary headers. Resend's docs (via ctx7) show `headers: {'List-Unsubscribe': …}` on `emails.send`. Resend's own `{{{RESEND_UNSUBSCRIBE_URL}}}` works only in Broadcasts and Automations.
- **Calendar.** `buildJewishCalendar` (`src/lib/outreach/jewish-calendar.ts`) blocks Shabbat and Yom Tov from candle-lighting to havdalah (Yom Kippur is included). `DEFAULT_SEND_POLICY` (`send-policy.ts`) is Sun–Thu 09:00–20:30 and Fri 09:00–12:00. `@hebcal/core` reports Yom HaShoah and Yom HaZikaron (MODERN_HOLIDAY) and Tisha B'Av; I checked this for 2027.
- **Setup.** `computeSetupSteps` (`src/lib/data/setup-steps.ts`) is pure. The step `live` is done once the campaign is `active` or `closed`. `events` and `campaigns` both have `created_at` and `updated_at`.
- **Company details.** These come from `getCompanyLegal()`. The live values are name "נתנאל מבורך קלפה - KALFA RSVP", address "זוהר 23,זוהר", phone "033301505" and email "netanel.kalfa@kalfa.me".

## Goals / Non-Goals

**Goals:** send exactly the three approved emails, only to consenting customers with confirmed addresses, never twice and never outside the window, and make unsubscribing work in one click from any client.

**Non-Goals:** Resend Broadcasts or Automations, holiday campaigns, a marketing admin UI beyond the switch, analytics beyond Resend's own, and the database registration number required by Privacy Law §17ו (a release gate, task 7.2).

## Decisions

**D1. We send through our own path, not Resend Automations.**
- *Why.* Gating has to happen at the moment of sending: the latest consent from our ledger, a confirmed address, the Israeli calendar, and setup state that only our database knows. The templates should also stay in the codebase, next to the transactional ones, and be tested.
- *Alternative rejected.* Resend Automations would move the templates and the timing out of the repo, and would need every gate mirrored into Resend properties.
- *Cost.* We build our own unsubscribe endpoint (D4).

**D2. `EmailSender.send` gains optional `headers`.**
- *Why.* It is the existing wrapper, with idempotency and error handling already in place.
- *How.* The marketing path passes `List-Unsubscribe: <https://…/api/marketing/unsubscribe?t=…>` (HTTPS only: Reply-To is the owner's own inbox, `netanel.kalfa@kalfa.me` per the live `smtp_from`, which nothing processes automatically, so a `mailto:` unsubscribe would be lost) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. `idempotencyKey` is the send-ledger row id, so a retried job cannot send twice at Resend either.
- *Constraint.* Transactional callers are unchanged.

**D3. A send ledger, `marketing_email_sends`.**
- *Columns.* `id`, `user_id`, `email`, `template` (`welcome | setup_reminder | how_it_works`), `template_version`, `event_id` (setup reminder only), `status` (`claimed | sent | failed | skipped`), `skip_reason`, `provider_message_id`, `created_at`, `sent_at`.
- *No closed lists in the database.* `template` and `status` are plain text, validated in code (a TS union plus Zod at the write), not DB CHECKs — the owner's rule against closed schemas (memory `no-rigid-schemas-broaden-scope`). A new template is a code change only.
- *Uniqueness.* A unique index on `(user_id, template)` where `event_id is null`, and one on `(user_id, template, event_id)` where `event_id is not null`. The sweep **claims** a row by INSERT before sending, so a second sweep's insert fails with 23505 and it moves on. This follows the same claim pattern as `contact_interactions`.
- *Access.* Server-only: RLS on with no policy, and grants of SELECT, INSERT and UPDATE (status only) to service_role.
- *Alternative rejected.* A flag on `profiles`. It is user-writable, and that is the earlier lesson.

**D4. The unsubscribe token is an HMAC with a key id, not a stored secret.**
- *Format.* `t = "v1." + kid + "." + base64url(userId) + "." + base64url(HMAC-SHA256(key[kid], "mkt-unsub:v1:" + userId))`, compared with `timingSafeEqual`.
- *No expiry.* An unsubscribe link has to work forever.
- *Keys.* `MARKETING_UNSUBSCRIBE_KEYS` is server-only: `kid:secret` pairs, the first signs and all verify. It is added to `src/lib/relocation/env-validation.ts` like the other keys. A rotation adds a key and keeps the old ones, so every link ever sent keeps working.
- *Responses.* A bad token withdraws nothing and never claims success: the page says the link could not be verified and tells the visitor how to unsubscribe anyway (account settings, or replying to the email). It reveals nothing about any customer.
- *Abuse.* The route is rate-limited with the existing `rateLimit` helper.
- *Alternative rejected.* A random token column. It needs a new table and a lookup, and gains nothing for a one-way, idempotent action.

**D5. GET shows a page, POST acts.**
- POST with body `List-Unsubscribe=One-Click` (RFC 8058) records the withdrawal and returns 200.
- GET of the footer link renders `/unsubscribe?t=…`, a page with one confirm button that POSTs. Mail security scanners prefetch links with GET, so GET must never withdraw. This is the same reason `/auth/confirm` verifies on POST.
- The withdrawal is `recordConsent({action:'withdraw', source:'email_unsubscribe'})` followed by `enqueueMarketingContactSync`.
- The ledger's `source` CHECK is dropped in this change's migration rather than widened (same owner rule). `ConsentSource` in `marketing-consent.ts` stays the one list of allowed values, and the server write path is the only writer.

**D6. One sweep, every 15 minutes, gated by `marketing_emails_enabled`.**
- *Outside the window* (D7), the sweep returns at once.
- *Inside the window,* it finds the due customers. It reads consent from the ledger (latest row per user is a grant), confirmation and the email from `auth.users` via the admin API, and events and campaigns for the reminder.
- *Per customer, in order:*
  1. Re-check the gates.
  2. Claim a row.
  3. Render.
  4. Send.
  5. Mark the row `sent` with the message id, or `failed`.
- *A failed send* stays `failed` and is not retried automatically. A marketing email that is late or lost is acceptable, and a duplicate is not. The failure is alerted through `sendSlackAlert` with ids only.
- *Rules per template* (the values the owner can change):
  - **welcome:** the latest grant has `source = 'signup'` and the email is confirmed.
  - **setup_reminder:** applies to each event of the customer that meets all of these:
    - created ≤ 14 days ago;
    - not past;
    - setup not finished (`live` step not done);
    - `greatest(events.updated_at, campaigns.updated_at)` ≥ 24 h ago.
    The email names the event and the label of the current step from `computeSetupSteps`.
  - **how_it_works:** a `welcome` was sent ≥ 3 days ago, and no event of the customer has a finished setup.

**D7. The window is the outreach policy plus the marketing blackout days.**
- `DEFAULT_SEND_POLICY` hours, with `buildJewishCalendar` for Shabbat and Yom Tov.
- Add the whole Israel-time day of Yom HaZikaron, Yom HaShoah and Tisha B'Av from `@hebcal/core`, plus the eve from sunset. These days come from hebcal each year and are never hard-coded.
- This lives in a pure `isMarketingSendAllowed(ms)` with tests that pin known dates.

**D8. Templates live in `src/lib/email/marketing-templates.ts`.**
- *Shape.* One function per template returning `{subject, html, text, version}`.
- *Shared footer.* One component, fed by `getCompanyLegal()`. The phone is formatted for display from the stored digits (033301505 → 03-3301505); the address is shown as stored, so the owner corrects "זוהר 23,זוהר" in the company settings to match the approved design. If the name or address is missing, the send is skipped with `skip_reason = 'company_details_missing'`.
- *Legal marking.* The subject is built as `'פרסומת | ' + …` in one helper so no template can drop it. A test asserts the prefix and the body marker for every template.
- *Accessibility.* The CTA is a link, the logo an inline `<img>` from the site's `/icons/icon.svg` URL with `alt`, and Arial/Tahoma is the fallback after Heebo.

## Risks / Trade-offs

- [A Shabbat or holiday computed wrong could send at a forbidden time.] → The pure window function is tested against fixed dates (a Friday 12:30, a Saturday, 2027 Yom HaZikaron), and the hours reuse the outreach policy that is already in production.
- [The reminder reads setup state that the in-flight change `separate-event-setup-from-management` is reshaping.] → The reminder uses only `computeSetupSteps` and the `live` step, not step names, and its test builds the input through the same function.
- [A signing key could leak.] → Anyone holding it could unsubscribe any customer, but nothing more: the action only withdraws. Rotation adds a key; old links keep working.
- [A send that fails after the claim is not retried.] → Accepted (D6): a lost marketing email is the safe failure.
- [Low volume: Gmail bulk-sender rules (5,000 a day) do not apply yet.] → One-click headers are included anyway, because Yahoo requires them regardless of volume.

## Migration Plan

1. Run `supabase migration new marketing_email_sends`. It creates the table, indexes, RLS, grants, the `app_settings.marketing_emails_enabled` column (default false), and drops the `source` CHECK on `marketing_consent_events`. Dry-run it, push with approval, then run `gen:types` and `types:check`.
2. Add `MARKETING_UNSUBSCRIBE_KEYS` to `.env.local` on the server. The owner generates it, or approves my generating it.
3. Deploy with sending off. Send each template to the owner's address through a guarded admin-only test path, and the owner approves the rendered emails.
4. The owner turns on `marketing_emails_enabled`.

Rollback: turn the switch off. The sends ledger is kept as history.

## Open Questions

- None. The database registration number (Privacy Law §17ו) is a release gate in task 7.2: the owner decides before sending is switched on.
