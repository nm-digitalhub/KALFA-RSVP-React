# Proposal

## Why

A message to a customer that fails to go out is lost today, and nobody can see what the customer was told. In the cancellation flow (`src/lib/data/event-cancellation.ts`, read 18.10.2026):
- the e-mail goes out inside the resolve. When it fails after a refund, the request stays open and the admin is told to approve again. Nothing reminds anyone if nobody does;
- the SMS goes out inside an empty `catch {}`: no log line, no record. Only the SMS transport's own generic Slack alert fires, without the request, and not even that when SMS is switched off;
- no table records a sent message. The admin customer page (`/admin/users/[id]`) shows details, organisations and benefits, but not one message.

The owner asked on 18.10.2026 for a central record that retries failed sends, and for a screen that shows every message sent to a customer.

## What Changes

- **A message record (outbox).** Every customer e-mail and SMS of a covered flow is written as a row before it is sent: who to, through which channel, why, the exact text, and its state. A row that cannot be sent (no consent, no phone, channel switched off) is recorded as skipped, with the reason.
- **Sending moves to the worker.** A pg-boss job sends each row through the existing transports (`src/lib/email/sender.ts`, `src/lib/sms/sender.ts`).
  - pg-boss's own retries, backoff and expiry handle a failure the provider marks as temporary. Nothing is hand-written for scheduling.
  - A refusal stops the row.
  - A send whose outcome is unknown is never sent again automatically: staff decide.
  - A small sweep enqueues only a row whose job was never created.
- **Retrying a message never repeats the action behind it.** A failed cancellation e-mail is retried alone; the refund is not touched.
- **The cancellation flow is the first one covered.** Its e-mail and SMS become rows written together with the request's resolution.
  - **BREAKING (admin behaviour):** approving a request no longer fails because the e-mail failed. It is recorded, and the e-mail is retried and shown as failed if it never goes out.
  - Approving still stops before any money moves when the e-mail channel is not configured at all, so a customer is never refunded without a way to be told.
- **A "תקשורת" section on the admin customer page.** It lists every recorded message of that customer: when, channel, why, the text, its state, attempts and the last failure reason. It sits behind the page's existing reason gate and access audit.
- **The cancellation page shows its own messages** and their state.
- **Delivery comes from the provider's own report.** Resend's delivery events already arrive at `/api/webhooks/resend` and are stored. Today nothing joins them to what was sent. They will update the matching message (delivered, bounced, complained, delayed).
  - Without such a report (an SMS, or an e-mail sent over SMTP), the screen says "נמסר לספק", never "הגיע".
- **Not in this change:** agreements, inquiries, OTP and callback SMS (later changes, on the same record); WhatsApp to guests; SMS delivery reports; marketing e-mail. History starts on go-live: past sends were never recorded.

## Capabilities

### New Capabilities

- `customer-messages`: how a message to a customer is recorded, sent, retried and shown to staff, whatever flow or channel it comes from.

### Modified Capabilities

None (`openspec/specs/` is empty).

## Impact

- **Database:** a new table with RLS on and no client access, plus a function that records a cancellation's resolution and its messages in one transaction.
- **Code:**
  - `src/lib/data/event-cancellation.ts` (the resolve flow);
  - a new module for the record and its sending;
  - small additions to both senders, so a failure carries the provider's own classification and the e-mail sender returns Resend's message id;
  - a new pg-boss queue and sweep in `src/lib/queue/queues.ts` and `worker/main.ts`;
  - the existing Resend event processing (`src/lib/data/webhook-processing.ts`);
  - the admin customer page and the cancellation page.
- **Templates:** unchanged (`src/lib/email/templates.ts`, `src/lib/data/cancellation-sms.ts`).
- **Personal data:** the record holds addresses, phone numbers and message texts, including the link to a refund receipt. It is readable only on the server, behind staff permissions. No personal data goes into pg-boss jobs or logs.
- **Deploy:** a migration (owner-applied), then the worker and the app together.
