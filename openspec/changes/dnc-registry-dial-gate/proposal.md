# Proposal

## Why

KALFA makes sales calls: AI calls on `callback_requests` rows, meeting-confirmation calls, workflow voice calls, and console dials. Today no outbound path checks Israel's national Do-Not-Call registry ("אל תתקשר אליי"). Every product path checks only the local `call_dnc_list`, which holds removal requests made to KALFA.

The law (verified 11.10.2026 against the statute and Regulation 3, see design D1) sets out the obligation:
- **16ג(ג)**: a business that wants to make a marketing call must first verify that the number is not in the registry.
- **16ב(א)**: a marketing call is a call "במטרה להתקשר בעסקה", including a free or discounted offer.
- **22ג(16ב)**: calling a registered number exposes the business to a financial sanction.

The client for the registry is already in the repository (`src/lib/dnc/generated/`, commit f1067f5d), but nothing calls it.

Two further gaps, found while mapping the dial paths:
- Four operations scripts reach the telephony provider with no consent or DNC gate at all, and two of them accept any number (`scripts/voximplant/bridge-call.ts`, `test-call.ts`).
- A missed inbound call is stored as a `callback_requests` row, the same as a real request to be called back. The data cannot prove which one it is, and the burden of proof is on the business (Sixth Schedule, item 1).

## What Changes

- **A per-purpose registry policy.** Each dial path states whether its call is marketing. Owner ruling 11.10.2026: RSVP calls are not marketing. Sales calls are. A call the person explicitly requested is exempt, but only with stored evidence.
- **One shared server component** (`src/lib/dnc/registry-check.ts`, outside the generated folder). It does five things:
  1. checks the local list first;
  2. converts the number to the registry's format;
  3. calls `verifyPhoneList`;
  4. validates the answer at runtime with Zod;
  5. returns an explicit result, with its source and time.
- **Explicit results:**
  - `local_blocked`
  - `registry_listed`
  - `registry_clear`
  - `registry_unchecked`: the service refused this one number.
  - `registry_unavailable`: the call failed or the answer was invalid.
  - `not_covered`: a non-Israeli number.

  A number counts as listed only when it is absent from a fully validated answer.
- **Gate wiring:**
  - Sales-purpose paths call the component before the provider, inside the gates that already exist.
  - A temporary registry failure waits and retries a bounded number of times, before any dial. It is not recorded as a final skip.
- **Each callback request records where it came from.** `callback_requests` gets an `origin` column. A request the person made, or a call they placed to us that went unanswered, is exempt; a row created by staff or a workflow is not.
- **The bypassing scripts are closed.** They dial only numbers on an explicit test allowlist.
- **A decision record.** One table, `dnc_registry_checks`, written only by the server, holds every check used for a dial decision. It holds no token and no headers.
- **The admin DNC screen gets three tabs:** check a number, local blocks, and connection status.
- **Stale comments found on these paths are corrected** (design D11).

## Capabilities

### New Capabilities
- `dnc-registry-check`: how a dial decision consults the national registry, how answers are interpreted, which call purposes it applies to, and how each check is recorded.
- `dnc-admin`: the admin screen for checking a number, the local list, and connection status.

### Modified Capabilities
None. `openspec/specs/` has no capabilities yet.

## Impact

- **Database.** Every migration is created with `supabase migration new` and pushed only with the owner's approval. There are two:
  - a new table `dnc_registry_checks`, with RLS on and `revoke all` from `anon` and `authenticated`;
  - a new `callback_requests.origin` column;
- **Code:**
  - `src/lib/dnc/`
  - `src/lib/data/console-calls.ts` (`DIAL_GATE_POLICY`, `evaluateSharedConsentGates`)
  - `sales-call-dispatch.ts`, `meeting-confirm-dispatch.ts`, `voice-purpose-dispatch.ts`
  - `src/app/api/call-me-now/verify/route.ts`
  - `worker/main.ts`
  - `scripts/voximplant/*`
  - `src/app/(admin)/admin/dnc/*`
  - `src/lib/data/admin/call-dnc.ts`
- **Not touched:** the RSVP campaign path (`outreach-calls.ts`). It keeps the local list only.
- **Out of scope:**
  - Bulk pre-checks with `queryPhones`. Planned as a follow-up, once a reuse window is approved (design D6).
  - The pre-existing double-dial risk on manual console AI dials. Recorded in design D12 as a separate fix.
  - Automatically copying registry results into the local list.
