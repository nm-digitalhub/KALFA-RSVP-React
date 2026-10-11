# Design

## Context

Motivation: proposal.md - Why. Facts measured on 11.10.2026:

- **Consent is live.** `marketing_consent_events` is append-only and readable only by service_role. `currentConsent(userId)`, `latestConsentForEmail` and `recordConsent` live in `src/lib/data/marketing-consent.ts`, and `enqueueMarketingContactSync` lives in `marketing-contact-sync.ts`. The ledger's `source` CHECK allows `signup | settings | provider_unsubscribe | provider_complaint | account_removed`.
- **Templates.** `src/lib/email/templates.ts` builds Hebrew RTL mail with `react-email` (6.11.1) through `createElement` + `render`. It sets `lang`/`dir` on both `<Html>` and `<Body>`, returns `{subject, html, text}`, writes the text version by hand, and does no I/O. `toPlainText` is exported by the installed `react-email` (checked at runtime); react.email/docs/utilities/render documents `toPlainText(html)` and `data-skip-in-text`.
- **Sending.** `EmailSender.send` (`src/lib/email/sender.ts`) has a Resend path and an SMTP path, chosen by `EMAIL_PROVIDER` (`selectedEmailProvider()`). The Resend path passes `idempotencyKey`. It returns nothing, and it throws `EmailSendError` on every `error`, without distinguishing a definite rejection from a transport failure. It cannot pass arbitrary headers or tags. Resend's docs show `headers` (`List-Unsubscribe`) and `tags` on `emails.send`. Resend keeps idempotency keys for 24 hours only (resend.com/docs/dashboard/emails/idempotency-keys). Its own `{{{RESEND_UNSUBSCRIBE_URL}}}` works only in Broadcasts and Automations.
- **Resend webhooks** (resend.com/docs/webhooks/*):
  - The retry schedule runs from immediately up to 10 hours. Replays are possible, and an endpoint that keeps failing is disabled.
  - The docs do not promise in-order delivery.
  - `email.delivered` carries the event's `created_at` plus `data.email_id`, `data.created_at` and `data.tags`.
  - Our route persists every event to `webhook_inbox` and a drain processes it (`processWebhookEvent`). No code in `src` deletes `webhook_inbox` rows (checked).
- **Calendar.** `buildJewishCalendar` (`src/lib/outreach/jewish-calendar.ts`) blocks Shabbat and Yom Tov from candle-lighting to havdalah (Yom Kippur is included). `DEFAULT_SEND_POLICY` (`send-policy.ts`) is Sun–Thu 09:00–20:30 and Fri 09:00–12:00. `@hebcal/core` reports Yom HaShoah and Yom HaZikaron (MODERN_HOLIDAY) and Tisha B'Av; I checked this for 2027.
- **Setup.** `computeSetupSteps` (`src/lib/data/setup-steps.ts`) is pure. The step `live` is done once the campaign is `active` or `closed`.
  - `events.updated_at` and `campaigns.updated_at` also move on background writes, such as admin and exchange actions.
  - Owner setup actions are recorded in `activity_log` with the `event_id`. The live data includes `event.created`, `event.updated`, `event.setup_confirmed` and `campaign.package_chosen`.
- **Company details.** These come from `getCompanyLegal()`. The live values are name "נתנאל מבורך קלפה - KALFA RSVP", address "זוהר 23,זוהר", phone "033301505" and email "netanel.kalfa@kalfa.me".

## Goals / Non-Goals

**Goals:** send exactly the three approved emails, only to consenting customers with confirmed addresses, never twice and never outside the window, and make unsubscribing work in one click from any client.

**Non-Goals:** Resend Broadcasts or Automations, holiday campaigns, editing template content in the admin (templates stay in code; an editor with drafts and versions is a separate change), a resend control, the SMTP path for marketing (D2), analytics beyond Resend's own, and the database registration number required by Privacy Law §17ו (a release gate, task 7.2).

## Decisions

**D1. We send through our own path, not Resend Automations.**
- *Why.* Gating has to happen at the moment of sending: the latest consent from our ledger, a confirmed address, the Israeli calendar, and setup state that only our database knows. The templates should also stay in the codebase, next to the transactional ones, and be tested.
- *Alternative rejected.* Resend Automations would move the templates and the timing out of the repo, and would need every gate mirrored into Resend properties.
- *Cost.* We build our own unsubscribe endpoint (D4) and our own delivery tracking (D9).

**D2. Marketing mail is Resend-only, through the existing wrapper.**
- *Sender changes.* `EmailSender.send` gains optional `headers` and `tags`, and returns `{providerMessageId}`. The SMTP path returns its Message-ID.
- *Error classes.* It reports one of two failure classes, by Resend's documented error codes (resend.com/docs/api-reference/errors):
  - **rejected:** only a definite refusal, where Resend did not send. That is HTTP 400, 401, 403, 404, 405, 422 and 429 (validation, key, domain, quota, rate limit).
  - **unknown:** everything else. That covers 5xx (`application_error`, `service_unavailable`), 409 (`concurrent_idempotent_requests`: another request with the same key is in flight; `invalid_idempotent_request`: the key was already used, so the first one may have been sent), and no status at all (network or timeout). Resend may have accepted the mail.
  The split is a conservative reading of the error list, not a promise by Resend about what a server error did.
- *Transactional callers.* Unchanged: they keep treating any throw as a failure.
- *Headers.* The marketing path passes:
  - `List-Unsubscribe: <https://…/api/marketing/unsubscribe?t=…>`. HTTPS only: Reply-To is the owner's own inbox (`netanel.kalfa@kalfa.me`, the live `smtp_from`), which nothing processes automatically, so a `mailto:` unsubscribe would be lost.
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  - A tag `mkt_send=<send row id>`.
  - `idempotencyKey = marketing/<send row id>`.
- *Resend required.* The SMTP path has no delivery events and no tags. If `EMAIL_PROVIDER` is not `resend`, the sweep sends nothing and the readiness check shows sending as blocked.
- *Resend's idempotency* lasts 24 hours, so it does not replace our ledger. The ledger's unique claim (D3) is what prevents duplicates.

**D3. A send ledger, `marketing_email_sends`.**
- *Columns.*
  - Identity: `id`, `user_id`, `email`, `template`, `template_version`, `event_id` (setup reminder only).
  - State: `status`, `skip_reason`, `failure_class`.
  - Provider: `provider_message_id`, `provider_status_at` (the `created_at` of the newest provider event applied), `provider_accepted_at` (the `created_at` of the first `email.sent` or `email.delivered` event).
  - Times: `eligible_since` (when the rule became true, from the definition, D11), `claimed_at`, `handed_off_at` (when the send call returned with an id).
- *Statuses.*
  - `claimed`: pending.
  - `accepted`: handed to the provider.
  - `delivered`.
  - `failed`.
  - `unknown`: the outcome after hand-off is uncertain.
  - `skipped`: stopped, with a reason.
- *No closed lists in the database.* `template`, `status` and `skip_reason` are plain text, validated in code (a TS union plus Zod at the write), not DB CHECKs — the owner's rule against closed schemas (memory `no-rigid-schemas-broaden-scope`). A new template is a code change only.
- *Uniqueness.* A unique index on `(user_id, template)` where `event_id is null`, and one on `(user_id, template, event_id)` where `event_id is not null`. The sweep claims a row by INSERT before sending, so a second sweep's insert fails with 23505 and it moves on. This follows the same claim pattern as `contact_interactions`.
- *Access.* Server-only: RLS on with no policy. service_role gets SELECT and INSERT, plus UPDATE on the state, provider and time columns only.
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
- *Stops.* The sweep returns at once when sending is off, when any technical readiness gate fails (D10, evaluated on every run, not only when sending is turned on), or when it is outside the window (D7). A template whose current version has no approval is skipped on its own, while the others still send.
- *Inside the window,* it asks each definition (D11) for its due customers. It reads consent from the ledger (latest row per user is a grant), confirmation and the email from `auth.users` via the admin API, and events, campaigns and the activity log for the reminder.
- *Per customer, in order:*
  1. Re-check the definition's gates.
  2. Claim a row with `eligible_since`.
  3. Render.
  4. Send.
  5. Mark the row:
     - a success becomes `accepted`, with `provider_message_id` and `handed_off_at`. This is a single conditional UPDATE (`where id = … and status in ('claimed','unknown')`), so a `delivered` or `failed` that a webhook already wrote is never overwritten;
     - a rejection becomes `failed` (`failure_class = rejected`);
     - any other failure becomes `unknown` (`failure_class = unknown`), because Resend may have accepted it, and a later webhook resolves it by tag (D9). Both are conditional on `status = 'claimed'` for the same reason.
- *No automatic retry* of a `failed` or `unknown` row: a lost marketing email is acceptable, a duplicate is not. `sendSlackAlert` reports both with ids only.
- *Rules per template* (the values the owner can change, defined once in D11):
  - **welcome:**
    - the latest grant has `source = 'signup'`;
    - the address is confirmed;
    - `eligible_since` is the later of the grant time and the confirmation time.
  - **setup_reminder:** applies to each event of the customer that meets all of these:
    - created ≤ 14 days ago;
    - not past;
    - setup not finished (`live` step not done);
    - the last setup progress (below) is ≥ 24 hours old.
    The last setup progress is the latest of these times. Every one is written by the server, and a customer cannot change it (RLS on, no customer write policy, checked live on 11.10.2026):
    - `events.created_at`: the event was created;
    - `campaigns.created_at`: the campaign row was created, which happens when a package is chosen (`choosePackageAction` → `createCampaign`). Campaign writes go through the service-role client, and customers have SELECT only;
    - the newest `signed_agreements.signed_at` for the event: terms approved or agreement signed. `campaigns.approved_at` was checked as an alternative and is not added. `approveCampaign` (`campaigns.ts:554`) writes it once, guarded by `status = 'pending_approval'`, and only `recordSignedAgreement`/`recordPackageApproval` call it (`agreements.ts:324`, `:457`), right after the agreement row. In all 4 approved campaigns it trails `signed_at` by under one second;
    - the newest `payment_operations.recorded_at` for the event, **only** for `kind in ('package_purchase','authorize')` and `source = 'app'`: a purchase or card hold opened by the owner in the setup flow. The live table also holds `charge`, `refund` and `release` rows and `provider_sync`/`manual_backfill` sources. These are background or post-setup money, and they would otherwise push the reminder back. `recorded_at` is the write time, and a trigger keeps it unchanged (`20261004105957_payment_operations_expand.sql:201`). The table has no `created_at`.
    **`activity_log` is not a timing source.** A signed-in user holds INSERT on every column, including `action` and `created_at` (column privileges, checked live). Even with the D12 policy, an owner could add a fabricated action and time to their own event. It stays the audit history and never decides when a reminder goes out.
    `events.updated_at` and `campaigns.updated_at` are not used either, because background writes move them. Edits to event details therefore do not delay the reminder, and that is accepted: no server-written time records them.
    `eligible_since` is the last progress plus 24 hours. The email names the event and the label of the current step from `computeSetupSteps`.
  - **how_it_works:**
    - the customer's `welcome` row is `accepted` or `delivered`;
    - its start time is ≥ 3 days ago. The start time is `handed_off_at`, or, when the send call never returned and a later event resolved the row, `provider_accepted_at`. That is the `created_at` of the first `email.sent` or `email.delivered` event for it. A time is never invented;
    - no event of the customer has a finished setup.
    A `failed`, `skipped`, or still `unknown` welcome does not start the clock.

**D7. The window is the outreach policy plus the marketing blackout days.**
- `DEFAULT_SEND_POLICY` hours, with `buildJewishCalendar` for Shabbat and Yom Tov.
- Add the whole Israel-time day of Yom HaZikaron, Yom HaShoah and Tisha B'Av from `@hebcal/core`, plus the eve from sunset. These days come from hebcal each year and are never hard-coded.
- This lives in a pure `isMarketingSendAllowed(ms)` and `nextMarketingWindow(ms)` with tests that pin known dates.

**D8. Templates live in `src/lib/email/marketing-templates.ts`. One render serves the preview and the send.**
- *Shape.* One React Email component per template.
- *Render.* `renderMarketingEmail(template, data)` runs `render()` once and derives the text version with `toPlainText(html)`; it is never written twice. Decorative parts use `data-skip-in-text`. The admin preview calls the same function with sample data and shows its HTML in a sandboxed `<iframe srcdoc>`. No copy of the email exists in the admin.
- *Shared footer.* One component, fed by `getCompanyLegal()`. The phone is formatted for display from the stored digits (033301505 → 03-3301505). The address is shown as stored, so the owner corrects "זוהר 23,זוהר" in the company settings to match the approved design. If the name or address is missing, the send is skipped with `skip_reason = 'company_details_missing'`.
- *Legal marking.* The subject is built as `'פרסומת | ' + …` in one helper so no template can drop it. A test asserts the prefix and the body marker for every template.
- *Accessibility.* The CTA is a link, the logo an inline `<img>` from the site's `/icons/icon.svg` URL with `alt`, and Arial/Tahoma is the fallback after Heebo.

**D9. Provider results arrive through the existing inbox, by our own tag.**
- *Route.* Resend `email.sent`, `email.delivered`, `email.bounced`, `email.failed` and `email.suppressed` reach `webhook_inbox` through the existing route. `email.suppressed` is added to the handled events. `email.sent` ("the API request was successful") is the earliest proof of hand-off, and it resolves an `unknown` row to `accepted`.
- *Matching.* The drain (`processEmailDelivery`) matches a marketing row by `data.tags.mkt_send`, our row id. It does not use `email_id` as the primary key.
  - *Source.* resend.com/docs/llms-full.txt (read 11.10.2026): the `email.sent`, `email.delivered`, `email.bounced`, `email.failed` and `email.suppressed` payload examples all carry `data.tags` as an object keyed by tag name. A tag name and value may contain only ASCII letters, digits, `_` and `-`, up to 256 characters, so `mkt_send` and a UUID row id are valid.
  - *Fallback.* An event with no `mkt_send` tag is matched by `data.email_id` against `provider_message_id`. If neither matches, the event is a non-marketing email and is left alone. This means an event that arrives before `provider_message_id` was saved, or after a transport failure left the row `unknown`, still finds its row.
- *Order is not guaranteed.* Resend's FAQ says delivery is at-least-once and "delivery order is not guaranteed", and recommends sorting by the payload's `created_at` and deduping on `svix-id`. That is what this design does.
- *Explicit transitions, separate from data completion.* A provider event never jumps a status by rank. It applies only along these edges:

  | from | event | to |
  |---|---|---|
  | `claimed`, `unknown` | `email.sent` | `accepted` |
  | `claimed`, `unknown`, `accepted` | `email.delivered` | `delivered` |
  | `claimed`, `unknown`, `accepted`, `delivered` | `email.bounced`, `email.failed`, `email.suppressed` | `failed` |

  A bounce can follow a delivery, so `delivered` → `failed` is allowed. Nothing leaves `failed` or `skipped`, and `delivery_delayed` changes no status.
  - *Atomic.* Each edge is one UPDATE whose `where` names the allowed `from` set, and also requires the event's `created_at` to be newer than `provider_status_at` (or that one to be null). An event older than the last one applied changes no status.
  - *Data completion is separate.* `provider_message_id` (from `data.email_id`) and `provider_accepted_at` (the first `email.sent`/`delivered` time) are filled by a second UPDATE `where <column> is null`, whatever the status or the event's age. A late or same-status event still completes missing data and never overwrites it.
  - *The sweep's own writes* (D6) are the edges `claimed` → `accepted` | `failed` | `unknown`, written the same way. Neither writer reads and then writes.
  - *Duplicates.* Redelivery is already deduped by the inbox's `svix-id` key.
- *Who it touches.* Non-marketing mail is untouched, since it has no tag.
- *Unknown outcome.* A row in `unknown`, or in `claimed` for more than 15 minutes, is shown as unknown outcome until an event resolves it.

**D10. The admin page.** It lives at `/admin/marketing-email` in the "קמפיינים ושליחה" group (`src/components/admin-shell.tsx`). Every read goes through a server data layer with `requirePlatformPermission`, never the browser.
- *Permissions.*
  - Viewing needs `view_customer_data`, because consent and emails are personal data.
  - A test send needs `manage_settings`.
  - Turning sending on or off needs `requirePlatformOwner` and is recorded with `logActivity`.
- *One state, no "paused".* Sending is on or off; the page says which, and when the next window opens. A separate "paused" state would need a second stored fact. One switch plus the activity log (who turned it off, and when) says the same thing without one.
- *Readiness is computed, not ticked.* Technical gates are evaluated live on every view and on every sweep run (D6). Turning sending on is not the only time they are checked: a gate that fails later stops sending while the switch stays on, and the page says so.
  - the unsubscribe keys are present and sign and verify;
  - `EMAIL_PROVIDER` is `resend` with an API key;
  - **webhook intake works:**
    - `RESEND_WEBHOOK_SECRET` is set. Without it the route answers 200 and stores nothing (`route.ts`), so subscriptions alone prove nothing;
    - the Resend webhook (`webhooks.get`) is `enabled`, points at this deployment's `/api/webhooks/resend`, and is subscribed to `email.sent`, `email.delivered`, `email.bounced`, `email.failed`, `email.suppressed` and `contact.updated`;
    - a signed event from a test send (tag `mkt_test=<id>`, D10 test send) was stored in `webhook_inbox` after the latest change to the keys or the secret;
  - the company name, address, phone and email are present;
  - the consent switch is on;
  - the sweep queue is scheduled and has run within its staleness limit (the existing `QUEUE_EXPECTED_MAX_MINUTES` check).
  A gate whose check itself fails (Resend unreachable, a read error) is shown as **unverifiable**, never as passed, and it blocks like an open gate.
- *Approvals are records, not flags.* Human decisions are append-only rows in `marketing_email_approvals`, each with the approver, the time, the kind, the template key and version, and a free-text note:
  - each template approved at its version;
  - one-click unsubscribe tested;
  - the §17ו decision, as text.
  A template approval counts only for the version currently in code. A new version reopens the gate.
- *Enabling.* It is refused while any gate is open. It shows the current candidate count and the next sweep time before confirming.
- *Candidates.* They come from the definitions' read-only selection (D11) and are labelled as a forecast.
- *Lists.* All lists are paginated on the server.
- *Recipients.* The side panel reads the consent ledger, Auth confirmation, the Resend contact (one read when the panel opens) and the sends. It has no control that grants consent.
- *Timeline.* Each step shows only a recorded time:
  - eligibility: `eligible_since`;
  - claimed: `claimed_at`;
  - handed off: `handed_off_at`;
  - the provider events from `webhook_inbox`, matched by tag, with their own `created_at`.
  A step with no recorded time is shown as not recorded, never estimated.
- *Look.* It reuses the admin shell's tables and side sheet, in RTL, with every state written in text.

**D11. One definition per email, read by the sweep and the admin.** `src/lib/marketing/email-definitions.ts` holds, for each template:
- its key and version;
- its plain-language condition and stop rules (the admin's copy);
- `selectDue(ctx)`, a read-only query that returns candidates with `eligible_since`;
- `check(customer)`, the send-time gate, which returns `eligible` or a `skip_reason`;
- the progress sources and the payment kind/source filter (reminder only);
- its render function (D8).

The sweep, the admin forecast, the recipient eligibility reason and the test send all use these, so nothing is listed or worded twice.

**D12. Activity log: the missing setup entries, and only real access may write.**
- *Measured 11.10.2026.* These setup steps write an `activity_log` row: `event.created`, `event.updated`, `event.setup_confirmed`, `campaign.package_chosen`, `campaign.activated`, and `campaign.package_purchased` (written by the CardCom webhook path with `user_id = null`). These do not: approving the package terms (`approvePackageTermsAction` → `recordPackageApproval`), signing the agreement (`signAgreementAction` → `recordSignedAgreement`), and opening the payment page (`startCardcomPurchase`). In the live data all 5 events have `event.created`, and no setup row has a user other than the event owner.
- *Add three entries,* as audit history only (not a timing source, D6). Each is written after the step succeeded, with ids only in `meta`:
  - `campaign.terms_approved`, after `recordPackageApproval` succeeds;
  - `campaign.agreement_signed`, after `recordSignedAgreement` succeeds;
  - `campaign.payment_started`, after `startCardcomPurchase` creates the session.
- *Close the write hole.* `activity_log` policy `al_owner_insert` checks only `user_id = auth.uid()`. Any signed-in customer can therefore insert a row, such as `event.updated`, for an event they have no access to (measured: the policy's WITH CHECK). All 5 live events belong to an organization, and 3 memberships belong to users who do not own the event. So the rule must handle org roles, and view-only access is not enough.
  - `can_access_event(event_id)` defaults to `events`/`view` (live definition). The new WITH CHECK is `user_id = (select auth.uid()) and (event_id is null or <writer may change this event> or public.is_platform_staff())`.
  - *What "may change" means.* The event owner, or an org member holding any modifying permission on the event's resources: `can_access_event(event_id, r, 'edit')` for `r` in `events`, `guests`, `contacts`, `campaigns`, or `campaigns`/`manage`.
  - *Why.* A view-only member does not change an event, so they do not write its history. The app's own logging always follows a change the same user was allowed to make.
- *The time is the server's: column-level grants.* Today `authenticated` holds table-level INSERT and UPDATE on every column of `activity_log`, `created_at` included (checked live). The migration narrows the grants, which is separate from the row policy above:
  - `revoke insert, update, delete on public.activity_log from anon, authenticated`, then `grant insert (user_id, event_id, action, meta) on public.activity_log to authenticated`.
  - *Why it works.* Postgres INSERT docs: "If a column list is specified, you only need INSERT privilege on the listed columns". Unlisted columns take their default, so `id` and `created_at` (default `now()`) are always the server's. A request that names `created_at` fails with 42501. The GRANT docs add that a table-level grant is not narrowed by revoking one column, which is why the table-level INSERT is revoked first.
  - *Supabase's own guidance* (row-level-security, column-level-security, via ctx7): grants decide whether a role may run an operation at all, policies only filter rows ("adding policies doesn't take those grants back"). So revoke all, then grant back only what each role needs. SELECT stays as it is.
  - `logActivity` inserts exactly `event_id, user_id, action, meta` with no `.select()` (`src/lib/data/activity.ts`), so it keeps working. Service-role writers are unaffected. UPDATE and DELETE are revoked because no code path updates or deletes audit rows as a customer; the current policies already refuse them, and the grant now agrees.
  - *What still remains.* An owner or org editor can still write an entry with any `action` text on their own event, at the real time. That is accepted, because the log is history, not a timer (D6). A closed list of allowed actions is not added (owner rule against closed schemas).
- *Not made authoritative.* The policy stops writes to someone else's event. It does not prove that an owner's row on their own event describes something that happened, which is why D6 does not use it for timing.
- *Before pushing.* A read-only query lists existing rows the new rule would have refused (measured 0 on 11.10.2026 for the `can_access_event` form; to be re-run for the edit form). Every `logActivity` caller that passes an `eventId` under a session is listed, with the permission its action already required. A refused insert only logs an error (best-effort), so a missed caller would lose its audit row silently. Policy tests cover owner, an org editor, a view-only org member, staff and a stranger.

## Risks / Trade-offs

- [A Shabbat or holiday computed wrong could send at a forbidden time.] → The pure window function is tested against fixed dates (a Friday 12:30, a Saturday, 2027 Yom HaZikaron), and the hours reuse the outreach policy that is already in production.
- [The reminder reads setup state that the in-flight change `separate-event-setup-from-management` is reshaping.] → The reminder uses only `computeSetupSteps` and the `live` step, not step names, and its test builds the input through the same function. 
- [A signing key could leak.] → Anyone holding it could unsubscribe any customer, but nothing more: the action only withdraws. Rotation adds a key; old links keep working.
- [A transport failure or a non-definitive Resend error after hand-off leaves the outcome open.] → The row is `unknown`, never `failed` and never retried. A later tagged `email.sent` or `email.delivered` resolves it and records `provider_accepted_at`.
- [Setup timing ignores event-detail edits.] → Only server-written times count (D6). An owner who edits details but takes no other step gets the reminder 24 hours after their last server-recorded step. A missed nudge is acceptable; a forgeable timer is not.
- [Tightening `al_owner_insert` could refuse a legitimate audit row we did not foresee.] → Before the push, existing rows are checked against the new rule and every session caller with an `event_id` is listed. Policy tests cover owner, org member, staff and stranger. A refused row is logged with its action name, so a miss is visible in the server log.
- [Low volume: Gmail bulk-sender rules (5,000 a day) do not apply yet.] → One-click headers are included anyway, because Yahoo requires them regardless of volume.

## Migration Plan

1. Run `supabase migration new marketing_email_sends`. It:
   - creates `marketing_email_sends` (D3) and `marketing_email_approvals` (D10, append-only, server-only), with their indexes, RLS and grants;
   - adds `app_settings.marketing_emails_enabled` (default false);
   - drops the `source` CHECK on `marketing_consent_events`.
   A separate migration, `supabase migration new activity_log_insert_scope`, replaces `al_owner_insert` (D12). So this change has two migrations, and each dry-run lists exactly the migrations not yet pushed. It is pushed only with approval, after the read-only check of existing rows.
   Dry-run it, push with approval, then run `gen:types` and `types:check`.
2. Add `MARKETING_UNSUBSCRIBE_KEYS` to `.env.local` on the server. The owner generates it, or approves my generating it.
3. Add `email.suppressed` to the Resend webhook subscription, through the API with the owner's approval, as was done for `contact.updated`.
4. Deploy with sending off. Send each template to the owner's address through the admin test send. The owner records the approvals.
5. The owner turns sending on in the admin page.

Rollback: turn the switch off. The sends ledger and the approvals are kept as history.

## Open Questions

- None. The database registration number (Privacy Law §17ו) is a release gate: the owner records the decision in the approvals before sending can be turned on.
