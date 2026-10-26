// Create ONE call attempt on the permanent test event, for a bridge test call (ops tool).
//
//   npm run test-call:attempt -- --event-id <uuid> --guest-id <uuid> [--confirm]
//
// then
//
//   npm run bridge:call -- --attempt-id <printed id> --to <guest's number> --from <printed caller id> \
//     [--branch agtbrch_…] --confirm
//
// WHY THIS EXISTS: bridge-call.ts dials an EXISTING attempt, and nothing else creates one outside the worker's
// dispatcher. A test call needs the same row a guest's call has — so ctx serves the real guest and event, and
// save_rsvp writes to the real guest — without the dispatcher's campaign gates, which the test event never passes
// (its campaign is never activated, so the worker never dials it). openspec/changes/voice-test-environment, D5.
//
// The row is created exactly as dispatchOutreachCall creates it: a manual-band touchpoint from
// nextManualTouchpoint (atomic in the database), a 16-byte hex access token, the 2-hour token expiry, and a
// correlation nonce, through createCallAttempt.
//
// SAFETY:
//   * Only a staff-marked test event (public.test_events), while it can still record an answer, and only for a guest
//     whose number is on VOX_TEST_NUMBERS — testAttemptRefusal in src/lib/voximplant/dial-preconditions.ts.
//   * Without --confirm it checks everything and writes nothing.
//   * Never prints the access token or the nonce.

import { randomBytes } from 'node:crypto';

import { createCallAttempt, nextManualTouchpoint } from '@/lib/data/call-attempts';
import { getGuestsForContact } from '@/lib/data/interactions';
import { CALL_TOKEN_TTL_SEC } from '@/lib/data/outreach-calls';
import { getCampaignContext } from '@/lib/data/outreach-engine';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { testAttemptRefusal } from '@/lib/voximplant/dial-preconditions';
import { allowedTestDestination } from '@/lib/voximplant/test-numbers';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '__present__';
}
function val(name: string): string | undefined {
  const v = flag(name);
  return v && v !== '__present__' ? v : undefined;
}

function refuse(message: string): void {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const eventId = val('event-id');
  const guestId = val('guest-id');
  if (!eventId || !guestId) return refuse('--event-id and --guest-id are required (non-empty).');

  const admin = createAdminClient();

  const { data: marker, error: mErr } = await admin
    .from('test_events')
    .select('event_id')
    .eq('event_id', eventId)
    .is('purged_at', null)
    .maybeSingle();
  if (mErr) return refuse('test-event lookup failed.');

  // The event's one non-cancelled campaign (campaigns_event_noncancelled_uidx). Its status is not gated: the test
  // campaign is never activated, which is what keeps the worker from dialling the test guest.
  const { data: campaign, error: cErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .maybeSingle();
  if (cErr) return refuse('campaign lookup failed.');
  if (!campaign) return refuse('the event has no campaign.');

  const { data: guest } = await admin
    .from('guests')
    .select('contact_id, event_id')
    .eq('id', guestId)
    .maybeSingle();
  if (!guest || guest.event_id !== eventId || !guest.contact_id) return refuse('guest not found on this event.');

  const { data: contact } = await admin
    .from('contacts')
    .select('normalized_phone')
    .eq('id', guest.contact_id)
    .maybeSingle();
  const to = contact?.normalized_phone ? allowedTestDestination(contact.normalized_phone) : null;

  const refusal = testAttemptRefusal({
    markedAsTest: marker !== null,
    event: await getCampaignContext(campaign.id),
    guestCount: (await getGuestsForContact(eventId, guest.contact_id)).length,
    phoneAllowed: to !== null,
  });
  if (refusal) return refuse(`refusing to create a test-call attempt — ${refusal}.`);

  const config = await getVoximplantConfig();
  if (!config?.callerId) return refuse('no Voximplant caller id is configured.');

  if (flag('confirm') !== '__present__') {
    console.log('checks passed — nothing written. Re-run with --confirm to create the attempt.');
    process.exitCode = 1;
    return;
  }

  const touchpointIndex = await nextManualTouchpoint(campaign.id, guest.contact_id);
  const created = await createCallAttempt({
    eventId,
    campaignId: campaign.id,
    contactId: guest.contact_id,
    guestId,
    touchpointIndex,
    accessToken: randomBytes(16).toString('hex'),
    tokenExpiresAt: new Date(Date.now() + CALL_TOKEN_TTL_SEC * 1000).toISOString(),
    elCorrelationNonce: randomBytes(16).toString('hex'),
  });
  if (!created) return refuse('attempt not created (an attempt already holds this touchpoint).');

  console.log(`attempt_id       : ${created.id}`);
  console.log(`touchpoint_index : ${touchpointIndex}`);
  console.log(`to               : ${to}`);
  console.log(`from (caller id) : ${config.callerId}`);
  console.log(`the token expires in ${CALL_TOKEN_TTL_SEC / 3600} hours; place the call with npm run bridge:call before then.`);
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
