# Design

## Context

See proposal.md (Why) for the failures. The facts the design rests on, each read in code or measured on 18.10.2026:

**What 5119 means**
- `5119` comes with the description "עסקה ממתינה או לא הושלמה" on all ten recent rows. It does not tell "still in progress" from "ended without payment".

**What CardCom's script does**
- Its master frame (`OpenFields.ts`, v5.0.9784.18617) posts `HandleSubmit` only when the charge answered `IsSuccess`.
- It posts `HandleEror` on every refusal, 3D Secure failure, timeout or fetch error. After `HandleEror` its own `isProcessing` is false: nothing of that page is still in flight.
- The same LowProfile can be submitted again from the same frames. The script does not end a session after an error.

**What CardCom's guide says about the webhook**
- CardCom reports to the webhook "after a transaction is completed".
- Declined deals are reported only when the terminal's "Always report transaction" option is on.
- The webhook route already treats a non-zero answer as final. This design keeps that.

**What our page and server do today**
- The page settles on every frame result with `submitted: true`, and the server then closes on any non-zero answer (`cardcom-settle.ts:320-329`). Its poll loop (`MAX_POLLS`, 6 × 4 s) can only ever end on an error or `none`, never on `in_progress`.
- The page cannot see a tap inside CardCom's Google Pay frame: the frame is cross-origin and posts nothing to the page until a result.
- The ledger permits one pending row per campaign and kind (`payment_operations_one_pending_uq`). Its once-rule counts pending, review and succeeded rows (`payment_operations_once_uq`). `completeOperation` moves a row only from `pending` or `review`, so a failed row can never be re-opened.

## Goals / Non-Goals

**Goals:**
- A payment that CardCom may still complete is never written as failed by the page.
- No second session opens while the first could still be paid.
- The page notices a wallet payment that reported nothing.

**Non-Goals:**
- Diagnosing why CardCom answers 5119 (ticket to CardCom; `add-google-pay-cardcom` tasks 8.3, 8.4 and 8.6).
- Re-opening a failed ledger row, or any change to the ledger's columns or functions.
- Apple Pay. Card-entry validation messages.

## Decisions

**D1. The page says which kind of report it got; the server closes only on an error.** The settle body gains `report: 'success' | 'error'`, set from the frame message. The default for an old browser is `'error'`, today's behaviour. The server passes `finalizeUnpaid: report === 'error'`. On `'success'` with a non-zero answer, the route answers `in_progress`, so the page's existing poll loop finally does what its comment says, and then shows "being checked".
- *Alternative rejected:* never finalize from the page and leave every unpaid session to the webhook and the sweeper. An error on the page would then leave the buyer unable to retry for an hour, and CardCom's master is idle after `HandleEror`, so closing then is safe.

**D2. The browser may name its own session; the server checks it belongs to the campaign.** The body gains `lowProfileId`. The route looks it up in `cardcom_payment_sessions` and accepts it only when its operation's `campaign_id` is the guarded campaign. Otherwise it falls back to the newest session, as today.
- This is safe because `guardCampaignRoute` has already proved the caller owns the campaign. A named session of the same campaign gives the caller nothing they could not already settle.
- *Alternative rejected:* keep "newest only". That is the two-tab failure.

**D3. A wallet interaction is detected from focus, and the check is read-only.**
- *Detection:* a tap inside a cross-origin frame moves focus into it, so the page's `window` fires `blur` with `document.activeElement` equal to the Google Pay `<iframe>`. That is the signal; the browser behaviour is to be confirmed in task 1.1.
- *Checks:* from then until a frame result, the page calls the settle route with no `submitted`, which is the existing read-only path (`finalizeUnpaid: false`, `unpaid` → `in_progress`). It checks on `focus` and on `visibilitychange` to visible, and every 5 s for at most 2 minutes. On `paid`, it handles the result as `finishReturnedPayment` does. When the time is up, it says the payment has not completed yet, keeps the frames, and stops.
- *Cost:* at most 24 GetLpResult reads per wallet attempt, plus the focus checks, which are de-duplicated while one is in flight.
- *With the 3D Secure lock* (`add-google-pay-cardcom` task 8.11, 18.10.2026): a 3D Secure step already puts the form in `paying`. The same read-only checks therefore also run from the first step on. When the time is up, the form stays locked, because CardCom's script may still be running on that session. It never re-enables Google Pay on the same session, which would bring back the second payment over the first. Task 5.1 tests this case too.
- *Alternative rejected:* polling from the moment the form opens. That costs CardCom reads for buyers who never touch the wallet.

**D4. `resolvePending` replaces a pending session only outside the replace window.** It still asks CardCom first.
- Paid: `already_paid`, unchanged.
- Unreadable: `in_progress`, unchanged.
- Not paid and the row is older than `CARDCOM_REPLACE_AFTER_MINUTES`: closed as replaced, and a new session opens, as today.
- Not paid and younger: a new outcome, `previous_pending`. The page shows "ניסיון תשלום קודם עדיין נבדק" with the time to wait, and offers no form.
- An error on the page closes its own row (D1). The buyer's normal "try again" in the same tab therefore never meets the window; only a reload or another tab during an unreported attempt does.
- *Alternative rejected:* resuming the earlier session in the new page. `add-google-pay-cardcom` D13 retired that as a deviation from CardCom's "new LowProfile per submission".

**D5. The replace window: owner's decision, proposed 15 minutes.**
- It must cover the longest time a payment can still complete after the page lost track of it: a 3D Secure challenge left open, or a slow return from Google.
- 15 minutes is a proposal, not a measurement. CardCom documents neither a LowProfile lifetime (pilot plan, U3) nor a 3D Secure timeout.
- It is one constant, so changing it later is a one-line change with its tests.

**D6. Sentences.** A new `purchase_not_completed` replaces `purchase_declined` where the form shows a closed-as-failed result without a 3D Secure code: "התשלום לא הושלם ולא בוצע חיוב. אפשר לנסות שוב."
- New sentences for "being checked" and for `previous_pending`.
- `purchase_declined` stays only if another caller still uses it. Task 4.3 checks that and retires it otherwise.

**D7. Nothing else moves.**
- The webhook keeps `finalizeUnpaid: true`.
- The sweeper keeps its 60-minute abandon rule.
- `flagPaymentAfterFailure` keeps alerting on a payment that lands on a failed row. Its hard-coded `'ChargeOnly'` (`cardcom-settle.ts:228`) is corrected to the row's own `provider_operation`, because D4 relies on that alert for the case it cannot prevent.

## Risks / Trade-offs

- **A buyer waits up to the window after a reload during an unreported attempt.** → The page says why and for how long; the read-only check (D3) still turns a late payment into the paid screen.
- **A late success after the window, or on a session closed after an error.** It lands on a failed row. → It is caught, as today: the alert (D7) and the payment-after-failure check. It is not prevented; preventing it needs ledger re-opening, a non-goal.
- **The focus signal may not fire on every browser** (task 1.1). → Return-from-hidden (`visibilitychange`) is the second trigger. A buyer whose page shows nothing can reload, which D4 then handles safely.
- **More GetLpResult reads.** → Bounded per attempt (D3); no reads without a wallet interaction.
- **An old cached page without `report`.** → It defaults to `'error'`, exactly today's behaviour.

## Migration Plan

1. Code and tests (tasks 1–5); the owner runs lint, typecheck, test and build, and deploys.
2. No database step. Rollback is a normal revert.
3. The first real attempts after deploy are read from the ledger notes and the access log, with identifiers only.

## Open Questions

- The replace window's value (D5): the owner's decision, needed before task 3.1. It changes a constant, not the spec.
