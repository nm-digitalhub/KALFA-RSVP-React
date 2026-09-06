// Place ONE outbound RSVP call to an existing guest, now (ops tool).
//
//   npm run outreach:call -- --event-id <uuid> --guest-id <uuid> --confirm
//
// WHY THIS EXISTS: every gate and every dial mechanic for a campaign RSVP call
// already ships — dispatchOutreachCall (src/lib/data/outreach-calls.ts) is the
// worker's own dispatcher. What was missing is a way to ASK for one on demand.
// The API route POST /api/events/{id}/outreach-call does exactly that, but it
// authenticates with a console-agent Bearer JWT and its client — the browser
// call-centre — was never built, so no human can reach it. Until that client
// exists this is the only on-demand path, and it is the sibling of
// bridge-call.ts / meeting-confirm-call.ts, which exist for the same reason.
//
// IT ADDS NO BYPASS. The route's own body is reproduced here — resolve the ONE
// active campaign, resolve guest → contact → dialable phone from OUR data (never
// a phone passed on the command line), run the already-reached preflight — and
// then hands the identical job to dispatchOutreachCall, which re-checks all
// twelve gates itself: outreach master switch, credentials, live-calls toggle,
// consent, DNC, already-reached, campaign-active, event-closed, concurrency,
// hourly cap, balance reserve, owner-already-on-a-call. A refusal is printed as
// its typed reason, never swallowed.
//
// Unlike the route it dials SYNCHRONOUSLY rather than through pg-boss: an
// operator running this wants the verdict in the terminal, not a job id to go
// and look up. The dispatcher is the same either way — the worker calls it from
// the queue handler, this calls it directly.
//
// SAFETY:
//   * A REAL outbound call. Voximplant minutes and ElevenLabs credits are spent.
//     Nothing happens without --confirm.
//   * There is NO quiet-hours gate on this path. Send windows and the Jewish
//     calendar are applied by the PLANNER when it schedules a touchpoint; a
//     manual dial bypasses the planner by definition. It will ring at 03:00.
//   * An answered call bills as a reached contact, exactly like a scheduled one.
//   * Never prints a token, a secret, or the dialled number's owner.

import { isContactReached } from '@/lib/data/outreach-engine';
import { dispatchOutreachCall } from '@/lib/data/outreach-calls';
import type { OutreachCallRequest } from '@/lib/queue/queues';
import { createAdminClient } from '@/lib/supabase/admin';

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

async function main(): Promise<void> {
  if (flag('confirm') !== '__present__') {
    console.error(
      'ERROR: this places a REAL outbound call (Voximplant minutes + ElevenLabs ' +
        'credits) and is disabled by default. Re-run with --confirm after approval.',
    );
    process.exitCode = 1;
    return;
  }

  const eventId = val('event-id');
  const guestId = val('guest-id');
  if (!eventId || !guestId) {
    console.error('ERROR: --event-id and --guest-id are required (non-empty).');
    process.exitCode = 1;
    return;
  }

  const admin = createAdminClient();

  // Exactly one ACTIVE campaign, or refuse — the route's rule, and for its
  // reason: dispatchOutreachCall hard-refuses a non-active campaign, so picking
  // "the first" of several would dial on behalf of a campaign nobody chose.
  const { data: campaigns, error: cErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'active');
  if (cErr) {
    console.error('ERROR: campaign lookup failed.');
    process.exitCode = 1;
    return;
  }
  if (!campaigns || campaigns.length === 0) {
    console.error('ERROR: the event has no active campaign.');
    process.exitCode = 1;
    return;
  }
  if (campaigns.length > 1) {
    console.error('ERROR: the event has more than one active campaign — cannot choose.');
    process.exitCode = 1;
    return;
  }

  const { data: guest } = await admin
    .from('guests')
    .select('contact_id, event_id')
    .eq('id', guestId)
    .maybeSingle();
  if (!guest || guest.event_id !== eventId || !guest.contact_id) {
    console.error('ERROR: guest not found on this event.');
    process.exitCode = 1;
    return;
  }

  const { data: contact } = await admin
    .from('contacts')
    .select('normalized_phone')
    .eq('id', guest.contact_id)
    .maybeSingle();
  if (!contact?.normalized_phone) {
    console.error('ERROR: the guest has no dialable phone.');
    process.exitCode = 1;
    return;
  }

  // The route's one preflight: refuse a contact already billed as reached, with
  // its typed code, instead of handing the dispatcher a dial it will refuse.
  if (await isContactReached(eventId, guest.contact_id)) {
    console.error('ERROR: already_reached — this contact was already billed for this event.');
    process.exitCode = 1;
    return;
  }

  // isManual: the touchpoint index is allocated atomically by the dispatcher
  // (next_manual_touchpoint, under an advisory lock), so re-dialling the same
  // guest is allowed instead of colliding with the previous attempt's row.
  const job: OutreachCallRequest = {
    campaignId: campaigns[0].id,
    eventId,
    contactId: guest.contact_id,
    normalizedPhone: contact.normalized_phone,
    // Inert: three call sites write it, none read it. Kept consistent with the
    // route and the callback sweep rather than inventing a value that means
    // nothing.
    scriptKey: 'rsvp_v1',
    touchpointIndex: 0,
    isManual: true,
    // dispatchId is deliberately omitted: it exists so the CONSOLE can poll for
    // an attempt row that did not exist when its 202 was answered. This process
    // dials synchronously and prints the verdict, so there is nothing to poll.
  };

  console.log(`dialling — campaign=${job.campaignId} contact=${job.contactId}`);
  const result = await dispatchOutreachCall(job);
  console.log('result:', JSON.stringify(result));
  // A skip/block is a REFUSAL, not a success: exit non-zero so a caller (or a
  // person reading the terminal at 3am) cannot mistake one for a placed call.
  if (result.kind !== 'dialed') process.exitCode = 1;
}

void main();
