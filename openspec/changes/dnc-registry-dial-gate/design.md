# Design

Code facts below were read on main at f1067f5d (11.10.2026). Legal facts were read on 11.10.2026 from the statute text (he.wikisource.org, חוק הגנת הצרכן) and from Regulations 10268 (24.7.2022). The authority's business guide (gov.il) could not be read: the download is blocked with HTTP 403, and no archived copy exists.

## D1. Legal basis

| Source | Text | Consequence |
|---|---|---|
| 16ב(א) | "פנייה שיווקית" – פנייה ... במטרה להתקשר בעסקה, בין תוך כדי הפנייה ובין במועד מאוחר יותר, ובכלל זה הצעה לקבל נכס או שירות ללא תמורה, בהנחה או תוך מתן הטבה | The test is the PURPOSE of the call, not who dials it or how |
| 16ג(א), (ג) | עוסק או מי מטעמו לא יפנה בפנייה שיווקית למספר הרשום במאגר; יוודא שהמספר אינו רשום | A check is required before every marketing call |
| Sixth Schedule, item 1 | פנייה לאחר שהצרכן פנה וביקש שיחזרו אליו; נטל ההוכחה על העוסק | A callback request is exempt, but only with proof that it was made |
| Sixth Schedule, items 2–4 | an ongoing transaction (only about that transaction); a separate written consent not obtained by phone (1 year); an explicit consent following the consumer's own initiative (1 year, revocable) | Not used in v1. KALFA records none of these consents today |
| Reg. 3(ב), 3(ו) | the check must fall within the 15 days before the call; a number registered after a valid check is treated as compliant | A stored clean result may be reused for up to 15 days (D6) |
| Reg. 3(ה) | with the check, the business receives the numbers that are NOT registered | Absence from a valid answer means "listed" (D4) |
| Reg. 2(ו) | the registration takes effect 15 days after it is made | Informational only |
| 22ג(16ב) | a financial sanction for a marketing call to a registered number | — |

**Owner ruling, 11.10.2026: RSVP calls are not marketing calls.** The national registry does not gate them. Their script must not carry a commercial offer; if it ever does, the call becomes marketing under 16ב(א).

**Interpretation to confirm with an attorney before go-live:**
- whether a meeting-confirmation call to a prospect is marketing;
- the manual console split between "sales" and "service".

## D2. Policy per dial path

The table extends `DIAL_GATE_POLICY` (`src/lib/data/console-calls.ts:417`) with a `nationalRegistry` field: `'not_applicable' | 'required' | 'exempt_if_requested'`. `exempt_if_requested` means the check is skipped only when an `origin='person_request'` record exists; otherwise the check runs.

| Path | Code | Purpose | nationalRegistry |
|---|---|---|---|
| RSVP campaign, console "AI call this guest", guest callback sweep, workflow RSVP callback | `outreach-calls.ts:181` | RSVP | not_applicable (owner ruling) |
| Sales AI call on a callback request | `sales-call-dispatch.ts:253` | sales | exempt_if_requested |
| Meeting confirmation | `meeting-confirm-dispatch.ts:236` | sales follow-up | required (until an attorney rules otherwise) |
| Workflow `action.start_voice_call` | `voice-purpose-dispatch.ts:138` | configurable | required unless the node declares a non-marketing purpose |
| Console `callback` | `console-calls.ts:716` | the person asked | exempt_if_requested |
| Console `returned_call` | `console-calls.ts:781` | returning a call the person placed to us | not_applicable (owner ruling, see D7) |
| Console `manual` | `console-calls.ts:832` | the agent declares sales or service | required for sales; not_applicable for service |
| Console `guest_service` | `console-calls.ts:857` | a guest of an event | not_applicable |
| Consult / conference leg | `console-calls.ts:1610` | operational | not_applicable |
| Call-me-now (OTP verified) | `call-me-now/verify/route.ts:126` | the person asked now | exempt. The OTP-verified request is the evidence and is stored with the check record |

The local list keeps applying to every product path, exactly as today.

## D3. The shared component

`src/lib/dnc/registry-check.ts` exports `checkRegistry(phoneE164, ctx)`. It is server-only and lives outside `generated/`.

Steps:
1. Run `isDncListed(phoneE164)`. If true, return `local_blocked` and do not call the registry.
2. Normalize with `normalizePhone` (`src/lib/phone.ts`, E.164). A number that does not start with `+972` returns `not_covered`. Otherwise strip `+972` to get the digits without the leading 0; the service requires that form (measured: a leading 0 comes back with errorCode 1).
3. Call `verifyPhoneList({ data: [digits] })`.
4. Validate the answer with Zod: `statusCode === 200`, `transactionId` a uuid, and `data` an array whose items are either a string or `{ phone: string, errorCode: number }`. Any mismatch returns `registry_unavailable`. Today the mutator returns the parsed body as an unchecked cast (`mutator.ts`, `res.json() as T`).
5. Interpret the answer:
   - an item equal to `0` + digits means `registry_clear`;
   - an object item whose `phone` equals the digits sent means `registry_unchecked`, with its errorCode;
   - neither of these means `registry_listed`;
   - any `DncError` means `registry_unavailable`, with its kind and status.
6. Return `{ result, source: 'national_registry' | 'local_list' | 'none', checkedAt, transactionId | null, errorCode | null }`.

## D4. Results and what each one does

| Result | Dial? |
|---|---|
| local_blocked | No, on every path |
| registry_listed | No, on paths where the policy is `required` |
| registry_clear | The other gates decide (consent, hours, caps) |
| registry_unchecked | No: the check did not authorize the dial |
| registry_unavailable | Wait and retry (D5). Never a final block, never written to the local list |
| not_covered | The Israeli registry does not cover the number; the other gates decide |

## D5. Waiting instead of dropping

Measured in `worker/main.ts:172-233` and `:243-288`: every `skipped` result completes the pg-boss job, and the only retried kind is `transient_error`, capped by `CALL_RETRY` (2 retries, at most 60 s; `queues.ts:402`). A registry outage would therefore drop sales calls permanently.

Change:
- The dispatchers return a new result, `{ kind: 'registry_pending' }`, and they return it **before** `createCallAttempt` and `startScenarios`.
- The worker re-sends the same job payload with `startAfter: 600` and a `registryWaits` counter. The deterministic job id gets a suffix that includes the wait count, so a re-send cannot collide with itself.
- After 6 waits (one hour) the job settles as `skipped` with reason `registry_pending`.

Because nothing has dialled yet, a re-send cannot double-dial. The existing dedupe (sales `sales_call_attempts_request_slot_uidx`, meeting-confirm in-flight index, voice-purpose unique) still applies once dialling starts.

`registry_pending` needs no change to `call_dispatch_status` or to the Android app. That table is written only for the RSVP manual AI dial (`api/events/[eventId]/outreach-call/route.ts:152-187`, settled in `call-dispatch-status.ts:160-219`), and the RSVP path is not gated by the registry. The reason is added only to the result unions of the sales, meeting-confirm and voice-purpose dispatchers, and to their worker handlers.

## D6. Freshness

- **v1:** a fresh check before each marketing dial.
- **Reuse (follow-up, owner approval):** Regulation 3(ב) allows relying on a clean result checked within the 15 days before the call. When that window is approved, a `registry_clear` row from `dnc_registry_checks` that is no older than the configured window (at most 15 days) may authorize a dial. `queryPhones` then becomes the bulk pre-check for sales lists.

## D7. Evidence for "the person asked"

`callback_requests` cannot prove a request today. `recordMissedCallCallback` (`console-calls.ts:3421`) and the inbound "please call me" path (`:3491`) write the same row shape, and the workflow writes one too (`guest-actions.ts:316`).

Add `origin text not null`, an open text column rather than a closed enum, with these values:
- `person_request` for a web form, call-me-now, or a voice request;
- `missed_call` for an auto-created row;
- `staff` for a row created by staff;
- `workflow` for a row created by a workflow.

Existing rows are backfilled from their creation path where that path is known. Any row whose path is unknown gets `unknown`, and an `unknown` row is never treated as exempt.

**Owner rulings, 11.10.2026:**
- A callback request that a person submits (web form, call-me-now, voice request) is the evidence, as entered. KALFA does not verify that the typed number belongs to the person who submitted it.
- A person who called KALFA and was not answered has initiated the contact. Returning that call is exempt as well; this matches the owner's earlier ruling recorded at `console-calls.ts:427` ("לקוח שחייג אליי ואני חוזר אליו לא מהווה שום בעיה").

The exemption therefore applies to `person_request` and `missed_call`. Only rows that no person initiated (`staff`, `workflow`, `unknown`) are checked.

## D8. The decision record

None of the existing tables fits (measured):
- `call_attempts` is written only after the gates pass, and has no phone column.
- `activity_log` accepts inserts from any authenticated user with any action, meta and time (`al_owner_insert`).
- `call_dnc_list` keeps one row per phone, overwritten on upsert.

New table `dnc_registry_checks`:

| Column | Notes |
|---|---|
| id | |
| phone_e164 | |
| checked_at | default now(), server time |
| result | text |
| source | text |
| transaction_id | uuid null |
| error_code | int null |
| purpose | the policy row |
| dial_path | e.g. `sales_call`, `console_manual` |
| exemption_ref | e.g. the `callback_requests` id |
| job_id | null |
| attempt_id | null |

Access:
- RLS on.
- `revoke all` from `anon` and `authenticated`, because the public schema's default ACL grants both full privileges. Only the server role writes.
- An append-only trigger, the same pattern as `marketing_consent_events`.
- Indexes on `(phone_e164, checked_at desc)` and `(checked_at desc)`.

Staff read it through the admin DAL, behind `requirePlatformPermission('manage_voice')`. No token and no request headers are stored.

## D9. Admin screen

`src/app/(admin)/admin/dnc/` keeps its gate (`requirePlatformPermission('manage_voice')` in `call-dnc.ts`) and switches to the shared `Tabs` from `src/components/ui/tabs.tsx`, as `callbacks/policy/policy-form.tsx` does.

**Tab 1, "בדיקת מספר".** A phone field and a "בדיקה" button run `checkRegistry` through a server action. The action never dials. The screen shows the result, the source and the time, in fixed wording:
- `registry_clear`: "המספר אינו רשום במאגר. החיוג כפוף לשאר תנאי המערכת."
- `registry_listed`: "המספר רשום במאגר."
- `registry_unchecked` or `registry_unavailable`: "לא ניתן להשלים את הבדיקה. לא בוצע חיוג."
- `local_blocked`: "המספר חסום ברשימה המקומית."
- `not_covered`: "המאגר הישראלי אינו מכסה מספר זה."

Each check is rate-limited with the existing `rateLimit`, because the screen could otherwise be used to enumerate the registry.

**Tab 2, "חסימות מקומיות".** The current list with search and pagination (`Pagination` and `parsePageParam` from `admin/_components.tsx`), showing reason and date.

**Tab 3, "מצב החיבור".** Shows whether `DNC_API_NAME` and `DNC_API_TOKEN` are configured (a yes or no, never their values), plus the last successful check and the last error, read from `dnc_registry_checks`.

The call screens show three states separately: "נחסם מקומית", "נחסם לפי המאגר" and "ממתין לבדיקת המאגר".

## D10. Closing the bypasses

`scripts/voximplant/bridge-call.ts`, `test-call.ts`, `meeting-confirm-call.ts` and `sales-close-call.ts` reach `startScenarios` with no consent or DNC gate (bridge-call `:97,188`; test-call `:85`; the headers admit it).

Change:
- Each script refuses any `--to` that is not in `VOX_TEST_NUMBERS`, a server env list of E.164 numbers.
- `meeting-confirm-call.ts` and `sales-close-call.ts` run the same `evaluateSharedConsentGates` and `checkRegistry` as their product paths when no `--to` override is given.
- `test-call.ts` stops defaulting to rule 1494311, which CLAUDE.md fences off.

The `mcp__voximplant__start_call` tool, available in operator sessions, is outside the repository. The README documents that it bypasses every gate.

## D11. Stale comments to correct

These were found while mapping the paths, and each was checked against the code it describes.

1. `console-calls.ts:1625-1629` says `isDncListed` swallows errors to `false`. In fact it returns `true` on error (`outreach-engine.ts:228-241`).
2. `ConsoleDial.voxengine.js:15-16` says authorize re-checks consent and DNC. `authorize/route.ts` re-checks live-calls only.
3. The alert titles say "deferring" (`outreach-calls.ts:254`, `meeting-confirm-dispatch.ts:246`, `sales-call-dispatch.ts:262`, `voice-purpose-dispatch.ts:149`). In fact the job completes and nothing reschedules it.
4. The DNC page copy (`page.tsx:24-25`, `:12`) understates which calls the local list blocks, and `page.tsx:10-11` still says the RLS is admin-only.
5. `bridge-call.ts:3-5` calls itself "the ONLY path" that places a bridged call.
6. `worker/main.ts:207-211` and migration `20260721100426:14-17` say a pg-boss retry of a manual dial is dial-safe because `createCallAttempt` is idempotent. It is not, for `isManual` jobs (D12).
7. `event-cancellation.ts:55` says it "mirrors how callback_requests customer-facing inserts work". No customer-facing insert into `callback_requests` exists; every writer uses the admin client.

## D12. Out of scope, recorded

Manual console AI dials (`isManual`) take a new touchpoint index on every delivery (`outreach-calls.ts:305`), and `dispatchOutreachCall` never looks the attempt up by `dispatch_id`. A pg-boss redelivery after a confirmed start may therefore dial twice. This contradicts `worker/main.ts:207-211`. Verified by reading the code: `recordDialConfirmed` throws on a DB error (`call-attempts.ts:506`), the throw is rethrown (`outreach-calls.ts:399`), the job is sent with `CALL_RETRY` (`outreach-call/route.ts:166`), and `call_attempts.dispatch_id` is deliberately not unique (`20260721100426:14-17`). It has not been reproduced in a running system. It is unrelated to the registry; the registry wait in D5 happens before any attempt row, so this change does not widen it. It is tracked as its own fix.

## Risks

- The service is a single external dependency. The impact of an outage is bounded by D5: sales calls wait up to an hour, then skip. RSVP calls are unaffected.
- The registry answers within the request (measured at 100–600 ms). The mutator's 30-second timeout bounds a hung call.
