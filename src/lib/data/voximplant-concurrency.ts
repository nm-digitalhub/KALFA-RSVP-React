import 'server-only';

import { countActiveCalls } from '@/lib/data/call-attempts';
import { countActiveCallbackDispatches } from '@/lib/data/callback-request-attempts';
import { countActiveSalesDispatches } from '@/lib/data/sales-call-attempts';

// The combined pre-terminal call count across EVERY Voximplant dispatch
// surface that shares this account's balance and concurrency ceiling.
//
// call_attempts (RSVP campaign dials, outreach-calls.ts),
// callback_request_attempts (callback_requests-scoped meeting-confirmation
// dials, meeting-confirm-dispatch.ts) and sales_call_attempts
// (callback_requests-scoped sales-closing dials) are separate tables by
// design — see each table's own migration comment for why — but a real
// concurrent-call limit on the Voximplant account does not care which of our
// tables tracks a given call. Counting only one (or two) would let the
// dispatchers each believe they are under
// app_settings.voximplant_max_concurrent_calls while jointly exceeding it on
// the same account.
//
// Every dispatcher that enforces a concurrency cap against this account MUST
// call this function — never countActiveCalls(), countActiveCallbackDispatches()
// or countActiveSalesDispatches() alone for that purpose. outreach-calls.ts
// (RSVP campaign dials) was wired to this function on 2026-08-22, closing the
// gap noted here at this file's introduction — all three dispatchers now
// share one combined count.
export async function countActiveCallsAllSurfaces(): Promise<number> {
  const [rsvp, meeting, sales] = await Promise.all([
    countActiveCalls(),
    countActiveCallbackDispatches(),
    countActiveSalesDispatches(),
  ]);
  return rsvp + meeting + sales;
}
