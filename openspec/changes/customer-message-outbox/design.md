# Design

## Context

See proposal.md (Why). The facts this design rests on, each read in the code on 18.10.2026:

- **Resolve order today** (`resolveCancellationRequest`, `src/lib/data/event-cancellation.ts`):
  - With a package refund: refund, then e-mail, then SMS, then close the campaign and the event, then record the request as resolved (`.eq('status','pending')`).
  - Without a refund: e-mail first, and its failure aborts the resolve, with nothing recorded.
  - The SMS runs only with `sms_consent` and a profile phone, inside `catch {}`.
  - A resumed resolve e-mails again.
- **Transports:**
  - `getEmailSender()` uses Resend or SMTP (`EMAIL_PROVIDER`). It throws `EmailConfigError` or `EmailSendError` and logs the provider's reason.
  - Resend's error carries `statusCode` and `name`, and the sender already accepts an `idempotencyKey` (Resend remembers it 24 hours).
  - Resend returns a message id (`data.id`), which `send()` discards today.
  - `getSmsSender()` uses ExtrA. It returns ExtrA's message `id`, and throws `SmsConfigError` or `SmsSendError` (transport failure, a non-200 status, or `success:false` with `errors[]`).
- **E-mail delivery reports already arrive.**
  - `/api/webhooks/resend` verifies Resend's signature and stores `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained` and `email.failed` in `webhook_inbox`.
  - `processEmailDelivery` (`src/lib/data/webhook-processing.ts`) acts only on a hard bounce (a Slack alert) and on a complaint (a marketing-consent withdrawal). Its comment records that "send-time tagging to join events back" was deliberately not built.
  - Each event carries `data.email_id` (Resend's types, `BaseEmailEventData`).
  - ExtrA's delivery reports are not consumed anywhere.
- **pg-boss 12** gives, per job:
  - retries with exponential backoff and jitter (`retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`);
  - expiry of a job whose handler died (`expireInSeconds`);
  - deterministic job ids.

  The project already uses them through retry constants, `isFinalDelivery()`, `deterministicJobId()` and `guardedWorker` in `worker/main.ts`, and shows every job's state on `/admin/jobs` (the pg-boss dashboard). Job payloads carry ids only.
- **Two approvals of one request at once are already safe, and this change keeps it so.** The refund's pending ledger row is written before the clearing company is called. Two unique indexes stop a second one:
  - `payment_operations_cancellation_uq`: one live money operation per cancellation request;
  - `payment_operations_one_pending_uq`: one pending operation per campaign and kind.

  A concurrent approval fails at that insert (23505 → `alreadyInProgress`), before anything is sent. The final request update stays guarded by `status = 'pending'`. A message's dedupe key protects only the message, not the refund.
- **Admin customer page:** `/admin/users/[id]` is gated by `manage_staff`. Another customer's details load only after a break-glass reason and are audited (`getUserDetail` → `recordStaffAccess`). The cancellation page is gated by `manage_billing`.

## Goals / Non-Goals

**Goals:**
- one record that any flow and any channel can write to;
- sending that survives a failed provider, a lost job and a crash, without ever sending a message twice by itself;
- staff can see every message and every state, including delivery where the provider reports it.

**Non-Goals:**
- SMS delivery reports (ExtrA's are not researched or consumed);
- delivery reports for e-mail sent over SMTP (none exist);
- moving the other flows (later changes, each on this record);
- changing any message text.

**Nothing is hand-written that the stack already does:**
- scheduling, backoff, expiry and retry counting are pg-boss's;
- delivery events are the existing Resend route's;
- duplicate e-mail protection is Resend's idempotency key.

## Decisions

**D1. One table, `customer_messages`, open to every flow and channel.** Each row records:
- **who and where:** `recipient_user_id` (the customer), `event_id` when there is one, and the flow item it belongs to as `subject_type` + `subject_id` (here `event_cancellation_request` + the request id);
- **what:** `purpose` (here `cancellation.resolved`), `channel`, `destination` (the address or phone), `subject`, `body_text`, and `body_html` for e-mail;
- **state:** `status`, `skip_reason`, `attempts`, `last_attempt_at`, `sent_at`, `provider`, `provider_message_id`, `last_error_kind`, `last_error_code`;
- **delivery:** `delivery_status` (the provider's own event name, free text) and `delivery_at`;
- **identity:** `dedupe_key` (unique), `job_id` (the pg-boss job currently responsible for the row: the first one, or the latest resend's), plus `created_at` and `updated_at`.

The rules on its columns:
- `purpose`, `subject_type` and `delivery_status` are free text, so a new flow or a new provider event needs no migration.
- `channel` has a CHECK of the channels a sender exists for (`email`, `sms`). A row for a channel nothing can send would wait forever, and adding a channel adds its sender and widens the CHECK in the same change.
- The text is rendered when the row is written. The record then shows exactly what was sent, and a retry sends the same thing.
- *Alternative:* a template key plus parameters, rendered at send time. Rejected: the screen could not show what was actually sent, and a template edit would change a pending message.

**D2. The row's states mirror what happened. pg-boss decides when.**

| State | Meaning |
|---|---|
| `queued` | Waiting for its job. |
| `sending` | Claimed by one delivery of the job. |
| `sent` | Accepted by the provider. |
| `retry_wait` | A temporary failure; pg-boss holds the next attempt. |
| `failed` | A refusal, or pg-boss's last delivery failed. |
| `unknown` | It may have gone out; nothing resends it by itself. |
| `skipped` | Never sendable, with a `skip_reason`: `no_consent`, `no_phone`, `no_email`. |

- A claim is one compare-and-set UPDATE: `queued` or `retry_wait` → `sending`, `attempts + 1`.
- A job delivery that finds its row already `sending` knows the previous delivery died mid-send, because pg-boss retried it after `expireInSeconds`. That is the one case pg-boss cannot judge:
  - an e-mail over Resend is sent again with the row id as `idempotencyKey`, so Resend drops a duplicate within 24 hours;
  - an SMS, or an e-mail over SMTP, is marked `unknown` and the job ends without sending.
- `expireInSeconds` is 120, well above the 30-second transport timeouts. A live send is therefore never taken over: the overlap described in `queues.ts` for workflow runs.

**D3. Failure classes come from each provider's own signal.** What happened and what to do next are kept apart:

| Provider | Temporary | Refused | Channel unavailable |
|---|---|---|---|
| Resend | HTTP 429 and 5xx | Other 4xx | — |
| SMTP | Reply codes 4yz (RFC 5321), and connection failures with no reply | Reply codes 5yz | — |
| ExtrA | Transport failure, HTTP 429 and 5xx | `success:false`, and other non-200 statuses | HTTP 401 |
| Any | — | — | `EmailConfigError`, `SmsConfigError` |

- For ExtrA, reading `success:false` as a refusal is our rule, not ExtrA's: it is not documented as permanent.
- **Next action:**
  - temporary → the row goes to `retry_wait`, and the handler throws, so pg-boss retries;
  - refused → the row goes to `failed`, and the handler returns, so no retry;
  - channel unavailable → like temporary, plus a staff alert (a person must fix the settings);
  - a temporary failure on the last delivery (`isFinalDelivery`) → `failed`, with an alert.
- **What is stored:** the provider code only (Resend `name`/`statusCode`, the SMTP reply code, ExtrA's HTTP status and error codes). Provider text can name the recipient.
- **The change to the transports:** the senders throw an error that carries this class and code, and the e-mail sender returns Resend's message id.

**D4. Writing the cancellation's messages with its decision, in one transaction.**
- A new SECURITY DEFINER function, `resolve_cancellation_request_with_messages`, executable by `service_role` only, does both:
  - updates the request to resolved, with the same fields and the same `status = 'pending'` guard as today;
  - inserts its message rows with `ON CONFLICT (dedupe_key) DO NOTHING`.
- It returns whether this call resolved the request, and the ids of the rows it inserted. The existing "already handled" answer stays.
- The dedupe key is `event_cancellation_request:<id>:cancellation.resolved:<channel>`. A resumed resolve therefore writes nothing new.
- *Alternative:* insert the rows from the app, then update the request. Rejected: a failure between the two leaves either a message about a decision never recorded, or a decision with no message.

**D5. The new resolve order.**
1. All the existing checks.
2. **New:** the e-mail channel must be configured (`readEmailSettings` is `ok`), or the resolve stops before any money moves.
3. The refund, unchanged.
4. Closing the campaign and the event, unchanged.
5. The texts are rendered with the existing templates and the refund's real amount and receipt link.
6. The function in D4 runs.
7. One job per inserted row is enqueued, best-effort.

- The resolve no longer sends anything and no longer fails on a send.
- The SMS row is always written: queued with consent and a phone, otherwise skipped with its reason.

**D6. The queue, configured, not hand-built.**
- `QUEUES.customerMessageSend` carries the payload `{ messageId }` and the job id `deterministicJobId('customer-message:' + messageId)`, so one row has one job.
- Its retry constant is `CUSTOMER_MESSAGE_RETRY = { retryLimit: 6, retryDelay: 300, retryBackoff: true, retryDelayMax: 21600 }`: pg-boss's exponential backoff from 5 minutes, capped at 6 hours, about 5 hours in all. It has `expireInSeconds: 120` and no `deadLetter`, for the reason `queues.ts` gives (`QUEUES.dead`'s consumer expects an outreach step).
- The sweep `QUEUES.customerMessageSweep` (every 5 minutes) sends nothing itself. It does two things:
  - **Never enqueued:** it re-enqueues a row still `queued` with `attempts = 0` after 2 minutes, one whose enqueue in D5 failed. The deterministic job id makes a second enqueue a no-op.
  - **Left in flight:** for a row in `sending` or `retry_wait` it asks pg-boss for the row's `job_id` (`getJobById`). When that job has ended (completed, failed, cancelled, or no longer found) while the row still says in flight, the last delivery died before our handler could record it:
    - `sending` becomes `unknown`;
    - `retry_wait` becomes `failed`, with an alert.

    A job still created, retrying or active is left alone.
- Both run in `worker/main.ts` under `guardedWorker`. Their jobs show on `/admin/jobs` like every other queue.

**D7. Delivery reports, joined in the existing route's processing.**
- `processEmailDelivery` also looks up the row whose `provider = 'resend'` and `provider_message_id = data.email_id`. It sets `delivery_status` to the event type and `delivery_at` to the event's `created_at`, only when that is later than the stored `delivery_at`, since reports can arrive out of order.
- The existing bounce alert and complaint handling are unchanged.
- The comment saying send-time tagging was not built is updated: this is that tagging.
- An event with no matching row (an inquiry e-mail, a message from before go-live) changes nothing.

**D8. Access.**
- RLS is on, with no policy and no grant to `anon` or `authenticated`. Every read and write goes through server code with the admin client, after a permission check. The table holds addresses, phones and texts, including a receipt link with an access code.
- **The customer page:** the "תקשורת" list loads in the same gated path as the customer's details, after the reason, under the same `recordStaffAccess` audit.
- **The cancellation page** (`manage_billing`): it lists the request's messages and offers "שלח שוב" on `failed` and `unknown` rows.
  - A resend is a server action under `manage_billing`. It moves the row back to `queued` (the same text), enqueues a fresh job with a new deterministic id per resend, stores that id in `job_id`, and writes `logActivity` with who asked.
  - **An `unknown` row needs an explicit confirmation.** Before resending it, the page shows that the customer may already have received the message and would get it twice, and staff confirm in the page. The server action refuses an `unknown` row unless the request carries that confirmation. The check is the server's, not only the screen's. A `failed` row was never accepted by the provider and needs no confirmation.
  - Resend lives on the flow's page and under the flow's permission: the permission belongs to the flow that produced the message.

**D9. What the screen says.**
- Each state has its own Hebrew label. `sent` with no report is "נמסר לספק", with the time and the provider id.
- A delivery report is shown by its event: `email.delivered` "הגיע", `email.bounced` "נדחה אצל הנמען", `email.complained` "סומן כספאם", `email.delivery_delayed` "מתעכב", `email.failed` "נכשל אצל הספק".
- An event name the map does not know is shown raw, never hidden.
- A skipped row shows its reason. A failed row shows the class and the provider code.
- The full text opens on demand.
- Labels come from one map keyed by state, event and purpose. An unknown purpose shows its raw key.

**D10. Retention.** Rows follow the customer: `recipient_user_id` references the profile `ON DELETE CASCADE`, so deleting an account deletes its messages. `subject_id` is not a foreign key (it can point at any flow's table). `event_id` is `ON DELETE SET NULL`, so a purged test event leaves the row with its subject.

## Risks / Trade-offs

- **Approval no longer fails on an e-mail failure.** → The failure is visible on the request and on the customer page, staff are alerted when retries run out, and a missing e-mail configuration still blocks the approval up front (D5).
- **A message is sent a little later than today** (the job runs within seconds). → Accepted. Nothing in the flow waits on the send.
- **A double send** after a crash mid-send. → An e-mail over Resend carries the row id as its idempotency key; an SMS and an SMTP e-mail go to `unknown` and wait for staff (D2). A staff resend of an `unknown` row needs an explicit confirmation of that risk (D8).
- **A row stuck in flight when pg-boss's last delivery dies.** → The sweep reads the job's state and settles the row (D6).
- **No delivery status while `EMAIL_PROVIDER` is `smtp`.** → The screen shows "נמסר לספק"; delivery appears once Resend is the transport. Which transport is live is read from the environment, which this plan did not inspect.
- **Personal data in a new table.** → It is server-only, permission-gated, audited on the customer page, deleted with the account, and kept out of jobs and logs.
- **ExtrA's refusal codes are not documented as permanent or temporary.** → Labelled as our rule (D3). Staff can resend a failed row.

## Migration Plan

1. Migration: the table, indexes on (`recipient_user_id`, `created_at desc`), (`subject_type`, `subject_id`), (`provider`, `provider_message_id`) and a partial index for `queued` rows with `attempts = 0`, RLS, and the D4 function. The owner applies it, then `gen:types`.
2. The code: senders, module, worker queues, resolve flow, delivery join, and screens, deployed together (the worker and the app).
3. Verification on production: one test cancellation approved by the owner, then the rows, the job on `/admin/jobs`, a delivery report and the screens are checked.

**Rollback:** revert the code. The old resolve sends directly and ignores the table, which can stay or be dropped by a follow-up migration.
