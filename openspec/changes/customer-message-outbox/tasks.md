# Tasks

Planning approved by the owner on 18.10.2026 ("כן" to the plan and to the communication screen). Implementation needs its own go-ahead. The migration is applied by the owner; nothing is sent to a real customer by this work.

## 1. The record

- [ ] 1.1 Write the migration (with `supabase migration new`): the `customer_messages` table per design D1 and D10, its indexes (Migration Plan step 1), RLS on with no policy, no grant to `anon` or `authenticated`, and the `resolve_cancellation_request_with_messages` function per D4, executable by `service_role` only. Verify: inside a rolled-back block on a branch or local database, as `authenticated` a select returns nothing and an insert is refused; the function resolves a pending request and writes its rows once, and a second call writes nothing and reports "already handled".
- [ ] 1.2 After the owner applies it, regenerate the types (`npm run gen:types`). Verify: `npm run types:check` matches the linked database.

## 2. Failure classes in the senders

- [ ] 2.1 In `src/lib/email/sender.ts`, the thrown send error carries the class (temporary, refused, channel unavailable) and the provider code per design D3: Resend by `statusCode`, SMTP by reply code, a connection failure as temporary. `send()` also returns Resend's message id (`data.id`), `null` over SMTP. Existing callers keep working unchanged. Verify: `sender.test.ts` covers Resend 429, 500, 422, SMTP 4yz and 5yz, a connection error, `EmailConfigError` and the returned id; the error never carries the recipient or the provider's text.
- [ ] 2.2 The same in `src/lib/sms/sender.ts`: transport failure, HTTP 429 and 5xx temporary; HTTP 401 channel unavailable; `success:false` and other statuses refused, with a comment that this is our rule. Verify: the SMS sender tests cover each case; existing callers (OTP, callbacks) behave as before.

## 3. Sending

- [ ] 3.1 A module `src/lib/data/customer-messages.ts` with one job handler, `sendCustomerMessage(job)`:
  - the claim of D2;
  - a row already `sending` handled per D2 (resend over Resend with the row id as `idempotencyKey`, otherwise `unknown`);
  - the send;
  - the outcome per D3: refused → `failed` and return; temporary or channel unavailable → `retry_wait` and throw; final delivery by `isFinalDelivery` → `failed` and an alert.

  Plus `enqueueCustomerMessage` (deterministic job id, `CUSTOMER_MESSAGE_RETRY`), `requeueUnsentMessages` (the D6 sweep), and `resendMessage` (`failed`/`unknown` → `queued` + a fresh job). No scheduling of its own.

  Verify: unit tests with the fake table client and a fake job cover:
  - two concurrent deliveries send once;
  - a delivery finding `sending` resends an e-mail over Resend with the same key, and marks an SMS `unknown` without sending;
  - a refusal returns without throwing;
  - a temporary failure throws;
  - a temporary failure on the final delivery marks `failed` and alerts.

  No address, phone or text appears in a log line, an alert or a job payload.
- [ ] 3.2 Add `customerMessageSend`, `customerMessageSweep` and `CUSTOMER_MESSAGE_RETRY` (D6, with `expireInSeconds: 120`, no `deadLetter`) to `src/lib/queue/queues.ts`. Register both in `worker/main.ts` under `guardedWorker` with `includeMetadata` (for `isFinalDelivery`), and schedule the sweep every 5 minutes. Verify: the worker bundle check (`scripts/check-worker-bundle.mjs`) passes; the queue tests assert the payload carries only the id, and that the expiry is above the transport timeouts.
- [ ] 3.3 In `processEmailDelivery` (`src/lib/data/webhook-processing.ts`), join each Resend event to its row by `data.email_id` per design D7, keeping the latest by event time. Replace the comment that says send-time tagging was not built. Verify: tests show a delivered event updating its row, an older event arriving later changing nothing, an event with no row changing nothing, and the bounce alert and complaint handling unchanged.

## 4. The cancellation flow

- [ ] 4.1 In `resolveCancellationRequest`, per design D5:
  - check the e-mail channel before any money moves;
  - render both texts with the existing templates;
  - write them through the D4 function;
  - enqueue a job per new row;
  - remove the direct e-mail and SMS sends and the empty `catch {}`.

  Verify: `event-cancellation.test.ts` shows:
  - an approval succeeds while the e-mail provider is down, with the row `queued`;
  - an unconfigured e-mail channel refuses before the refund;
  - no consent and no phone give skipped rows with their reasons;
  - a resumed resolve writes no new row;
  - the refund still runs before the rows are written;
  - the receipt link reaches the SMS row.

  Update the comments that described the old order.
- [ ] 4.2 Retire what this supersedes: the e-mail-failure error texts of the resolve that no longer apply, and any doc in `docs/` describing the cancellation e-mail as sent inside the resolve. Verify: grep finds no text that still says approving fails on an e-mail failure.

## 5. The screens

- [ ] 5.1 The admin customer page: a "תקשורת" section in `user-detail-view.tsx`, loaded in the same gated path as the details (after the reason, under the same `recordStaffAccess` audit), newest first. It shows the time, channel, purpose, state, delivery, attempts and last failure class and code; the text opens on demand. The labels per design D9, for every state of D2 and every event of D7; an unknown event shows raw. RTL, keyboard-accessible, with existing components. Verify: page tests render each state, each delivery event, an unknown event and a skipped reason; they show "נמסר לספק" for `sent` without a report, and fail without the reason gate. Plus a check in the browser in both themes.
- [ ] 5.2 The cancellation page: the request's messages with their state, and "שלח שוב" on `failed`/`unknown` rows, a server action under `manage_billing` that calls `resendMessage` and writes `logActivity`. Verify: tests cover the list, the resend of each allowed state, the refusal for other states and without the permission, and the audit entry.

## 6. Integration

- [ ] 6.1 Run `npm run lint`, `npm run typecheck`, the full test suite and `openspec validate customer-message-outbox`. Verify: all pass.
- [ ] 6.2 After the owner applies the migration and deploys: the owner approves one test cancellation. Verify:
  - its two rows exist with the right states;
  - the e-mail is `sent` with a provider id, and its delivery report (when Resend is the live transport) shows on the row;
  - the job is visible on `/admin/jobs`;
  - the SMS is `sent` or skipped as expected;
  - both appear on the customer page and the cancellation page.

  The findings are recorded in design.md.

## Workflow follow-up

- Archive after 6.2 is recorded and the owner approves.
- Later changes, on the same record: agreements, inquiries, OTP, callback SMS; SMS delivery reports.
