# Tasks

## 1. Policy

- [x] 1.1 Add the `nationalRegistry` field to `DIAL_GATE_POLICY` and set each row as in design D2.
- [x] 1.2 Declare the policy for every other dial path: sales, meeting-confirm, voice-purpose, call-me-now, consult/conference.
- [ ] 1.3 Add a purpose choice (sales / service) to the manual console dial. Pass it to the gate. Default to "service" only for `guest_service`.
- [ ] 1.4 Add a non-marketing purpose declaration to the workflow `action.start_voice_call` node schema. Undeclared means `required`.
- [ ] 1.5 Before go-live, record the attorney's confirmation of the interpretive rows in D1.

## 2. Callback-request origin

- [x] 2.1 `npx supabase migration new callback_requests_origin`: add `origin text not null default 'unknown'`, and backfill from the creation path where it is known (design D7). Verified live in a rolled-back block: 9 missed_call, 9 person_request. The workflow node that could also create rows has never run.
- [x] 2.2 Set `origin` in every writer:
  - `recordMissedCallCallback` → `missed_call`
  - the inbound request path → `person_request`
  - `guest-actions.ts` → `workflow`
  - the web inquiry form (`inquiry-intake.ts`) and call-me-now → `person_request`
  - staff creation → `staff`
- [x] 2.3 Regenerate types (`npm run gen:types`, after the owner pushes the migration).

## 2b. Call-compliance settings out of app_settings (owner decision 11.10.2026)

- [x] 2b.1 `npx supabase migration new call_compliance_settings`: a single-row `call_compliance_settings` table with `call_consent_required` (copied from `app_settings`) and `dnc_registry_gate_enabled` (default false). Same access model as `app_settings`. Verified live in a rolled-back block: the value was copied (false), and a non-staff customer can neither see, update nor insert a row.
- [x] 2b.2 Read and write `call_consent_required` from the new table in `outreach-engine.ts` (`callConsentRequired`) and `admin/voximplant-channel.ts` (load and toggle), and update their tests.
- [x] 2b.3 The registry gate reads `dnc_registry_gate_enabled` from the new table. A read error counts as enabled, because the check protects the person called.
- [x] 2b.4 After the code from 2b.2 is deployed: `npx supabase migration new drop_app_settings_call_consent_required` drops the old column. Comments that name `app_settings.call_consent_required` are updated.

## 3. Shared component

- [x] 3.1 `src/lib/dnc/registry-check.ts`, implementing D3: local list, then conversion, then `verifyPhoneList`, then Zod validation, then interpretation.
- [x] 3.2 Unit tests built on the saved real answers (`openapi/DNC-API/samples/`), covering:
  - a clear number
  - a listed number (absent from the answer)
  - an errorCode for the number
  - a malformed answer
  - every `DncError` kind
  - a foreign number
  - a locally blocked number (the registry must not be called)

## 4. Decision record

- [x] 4.1 `npx supabase migration new dnc_registry_checks`, as in design D8:
  - RLS on
  - `revoke all` from `anon` and `authenticated`
  - an append-only trigger
  - the indexes
- [x] 4.2 Test as `authenticated`, inside an aborted transaction: insert, update and delete must all be refused. (Verified live 11.10.2026: a customer's insert and select are refused, and the trigger refuses update and delete even for the server.)
- [x] 4.3 The writer is called from the gate. A failed write blocks the dial, because the decision must be provable.

## 5. Gate wiring and waiting

- [x] 5.1 Call `checkRegistry` from `evaluateSharedConsentGates` when the policy requires it (or when an exemption lacks its evidence). Map the results as in D4.
- [x] 5.2 Add the `registry_pending` result to the sales, meeting-confirm and voice-purpose dispatchers, returned before any attempt row is created.
- [ ] 5.3 In `worker/main.ts`, re-send on `registry_pending` with `startAfter: 600`, a `registryWaits` counter and a wait-specific job id. After 6 waits, settle as skipped `registry_pending`.
- [x] 5.4 Add `registry_pending` to the result unions of the sales, meeting-confirm and voice-purpose dispatchers and to their worker handlers. `call_dispatch_status` and the Android app are not affected (design D5).
- [ ] 5.5 Show the three states "נחסם מקומית", "נחסם לפי המאגר" and "ממתין לבדיקת המאגר" on the call screens.
- [ ] 5.6 Tests:
  - no dial after a failed check
  - exactly one dial after recovery from a wait
  - two concurrent jobs for the same request dial once

## 6. Scripts

- [x] 6.1 Add the `VOX_TEST_NUMBERS` env list. Register it in `.env.example` and `env-validation.ts`.
- [x] 6.2 In `bridge-call.ts`, `test-call.ts`, `meeting-confirm-call.ts` and `sales-close-call.ts`, refuse any `--to` that is not on the list. Run the product gates when there is no override.
- [x] 6.3 Remove the `test-call.ts` default of rule 1494311.

## 7. Admin screen

- [x] 7.1 Rebuild `/admin/dnc` with three tabs as in D9, keeping `requirePlatformPermission('manage_voice')`.
- [x] 7.2 The check action rate-limits through the existing `rateLimit`, never dials, and never returns secret values.
- [x] 7.3 Paginate and search the local list on the server.
- [x] 7.4 Connection status: credentials configured yes or no, last success, last error.

## 8. Comments and docs

- [x] 8.1 Correct the stale comments listed in design D11.
- [x] 8.2 Document the operator-session `mcp__voximplant__start_call` bypass in `docs/`.

## 9. Verification and rollout

- [x] 9.1 Run `npm run lint`, `npx tsc --noEmit`, the relevant focused tests, then the full `npx vitest run`.
- [ ] 9.2 The owner pushes the migrations and runs the build and deploy.
- [ ] 9.3 Controlled enablement: `call_compliance_settings.dnc_registry_gate_enabled` turns on the registry gate for sales paths. Before turning it on, show that no dial followed a failed check and that no retry produced a second dial.
