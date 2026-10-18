# Tasks

Nothing here is deployed, pushed, charged or switched on without the owner's explicit approval. Billing logic: every group needs the owner's go-ahead to apply. Builds, deploys and real payments are the owner's.

## 1. Facts to confirm before code

- [ ] 1.1 Confirm in a real browser (desktop Chrome and Android Chrome) that tapping inside CardCom's Google Pay frame fires `blur` on the page's `window` with `document.activeElement` equal to that `<iframe>`, and that the return fires `focus` or `visibilitychange`. Verify: the result for each browser is recorded in design.md D3; if a browser gives neither signal, D3 is revised before group 5.
- [ ] 1.2 Find every caller of `purchase_declined` and of the settle route's body. Verify: the list is recorded in design.md D6, and it says whether `purchase_declined` can be retired.

## 2. The server closes only on an error report (D1, D7)

- [ ] 2.1 The settle route accepts `report: 'success' | 'error'` (Zod, defaulting to `'error'`, used only with `submitted`) and passes `finalizeUnpaid: report === 'error'`; a non-zero answer after `'success'` becomes `in_progress`. Verify: route tests for success-unpaid → `in_progress` with the row still pending, error-unpaid → `declined` with the row failed, a missing or invalid `report` → today's behaviour, and paid → paid in both cases.
- [ ] 2.2 `flagPaymentAfterFailure` compares CardCom's `Operation` with the row's own `provider_operation` (null = `ChargeOnly`), not a fixed `'ChargeOnly'`. Verify: cardcom-settle tests show an alert for a paid `ChargeAndCreateToken` session on a failed row, and none for an unpaid one.

## 3. A recent unpaid session is not replaced (D4, D5)

- [ ] 3.1 Record the owner's replace window in design.md D5, then add `CARDCOM_REPLACE_AFTER_MINUTES` beside `CARDCOM_ABANDON_AFTER_MINUTES`. Verify: the value and the date of the owner's decision are in D5.
- [ ] 3.2 `resolvePending` returns `previous_pending` for a pending session younger than the window that CardCom reports unpaid. It leaves the row pending and opens nothing; older sessions are replaced as today. `startCardcomPurchase` and the purchase route carry the new outcome. Verify: tests for young-unpaid (nothing closed, nothing opened), old-unpaid (replaced, new session), paid (`already_paid`) and unreadable (`in_progress`), with the window edge tested on both sides.
- [ ] 3.3 Update `add-google-pay-cardcom`'s spec requirement "Every opening of the payment form gets a new session" and its design D13 to point to this change's requirement "A recent unpaid session is not replaced". Verify: `openspec validate` passes for both changes, and neither spec says a young pending session is replaced on sight.

## 4. The page names its session and its report (D1, D2, D6)

- [ ] 4.1 The settle route accepts `lowProfileId` and settles it only when its session's operation belongs to the guarded campaign; otherwise it settles the newest session. Verify: route tests for own-campaign (that session settled), another campaign's id (ignored, newest settled), an unknown id (newest settled) and no id (newest settled).
- [ ] 4.2 The form sends `report` from the frame message (`HandleSubmit` → `success`, `HandleEror` → `error`) and its own `lowProfileId` with every settle call. On `in_progress` after a success report, it shows the "being checked" sentence. Verify: form tests for both bodies, and for the sentence after the polls end.
- [ ] 4.3 The new sentences go in `package-purchase-errors.ts`: not completed, being checked, previous attempt still being checked. The form shows "not completed" where it showed "declined" for a non-3D Secure failure, and the screen for `previous_pending`. `purchase_declined` is retired if task 1.2 found no other caller. Verify: tests for each sentence, and a check that no buyer-facing path still says "נדחה על ידי חברת האשראי" for a CardCom 5119.

## 5. The check after a wallet interaction (D3)

- [ ] 5.1 The form detects a wallet interaction (window `blur` with the Google Pay frame focused). From then until a frame result, it checks read-only on `focus` and on `visibilitychange` to visible, and every 5 s for at most 2 minutes, never two checks at once. Paid → the paid path; time up → the "not completed yet" sentence with the form kept. Verify: form tests (fake timers) for a paid check, the time-up sentence, the checks stopping on a frame result, no checks without a wallet interaction, and never a body with `submitted`.

## 6. Verification

- [ ] 6.1 Run the focused tests of every file touched, then `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` (the owner runs the last four). Fix every failing test, whoever's change caused it. Verify: all pass.
- [ ] 6.2 After the owner deploys, the first real attempt is read from the ledger (outcome, status code, note) and the access log (settle and webhook calls), with identifiers only. Verify: the report states which requirement each attempt exercised and whether its row ended as the spec says.

## Workflow follow-up

- Archive after every task is verified and the owner approves.
