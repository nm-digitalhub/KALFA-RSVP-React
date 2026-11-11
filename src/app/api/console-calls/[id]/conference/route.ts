import {
  deliverConsoleCallCommand,
  invalidCallIdResponse,
  loadConnectedCustomerCall,
  resolveCallTarget,
} from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { recordConsoleConferenceAudit } from '@/lib/data/console-calls';
import { noStoreJson } from '@/lib/http/no-store-json';
import { readJsonBody } from '@/lib/http/read-json-body';
import { consoleConferenceBodySchema } from '@/lib/validation/console-calls';

// POST /api/console-calls/{id}/conference   body: { to_agent_id: uuid } | { to_phone: string }
//
// 3-way conference. Mirrors transfer/route.ts and
// consult/route.ts: { id } is a live manual-outbound or inbound-customer
// console_calls row; the browser names the TARGET only — an agent, resolved
// server-side via the same resolveTransferTarget() every other live-call
// action here uses, or an outside number, cleared by resolveExternalDialTarget()
// — then posted as {command:'conference_add', request_id,
// payload:{vox_username}} or payload:{phone}. ConsoleInbound.voxengine.js's
// `conference_add` branch reads either shape; ConsoleDial.voxengine.js's reads
// `vox_username` only.
//
// Unlike consult, the customer is NOT put on hold while the target is dialed
// — the existing operator<->customer bridge stays live through the ring, and
// only once the target answers does the scenario create the mixer
// (VoxEngine.createConference) and rewire customer+operator+target into it
// (RSVPAgent's supervisor-conference primitives, same as its
// attachSupervisor 'takeover' topology). V1 supports exactly one additional
// participant (3-way total) — no queued/stacked
// conference_add while one is already dialing or live.
//
// console_calls.conference_agent_ids bookkeeping is EVENT-driven
// (conference_joined/conference_ended, see /api/voximplant/console/event) —
// this route only validates, resolves, and delivers. 2xx here means
// DELIVERED, never "joined".

const MAX_BODY_BYTES = 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManageVoiceAgent(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id: callId } = await params;
  const badId = invalidCallIdResponse(callId);
  if (badId) return badId;

  const read = await readJsonBody(request, { maxSize: MAX_BODY_BYTES, measure: 'utf8-bytes' });
  if (!read.ok) return read.response;
  const parsed = consoleConferenceBodySchema.safeParse(read.value);
  if (!parsed.success) return noStoreJson({ error: 'גוף הבקשה אינו תקין' }, 400);

  const loaded = await loadConnectedCustomerCall(callId, 'לא ניתן לצרף לשיחה מסוג זה');
  if (!loaded.ok) return loaded.response;

  // Two kinds of target, two authorities — see consult/route.ts for the same
  // split and the reasoning behind resolveExternalDialTarget's gate order.
  const resolved = await resolveCallTarget(parsed.data, ctx.userId, 'לא ניתן לצרף את עצמך');
  if (!resolved.ok) return resolved.response;
  const { target } = resolved;

  const delivery = await deliverConsoleCallCommand(callId, 'conference_add', target.payload, {
    unavailable: 'השיחה אינה זמינה לצירוף כעת',
    undelivered: 'בקשת הצירוף לא נמסרה לשיחה',
  });
  if (!delivery.ok) return delivery.response;

  await recordConsoleConferenceAudit({
    fromAgentId: ctx.userId,
    ...target.audit,
    consoleCallId: callId,
    eventId: loaded.call.eventId,
    requestId: delivery.requestId,
  });

  // Delivered; NOT confirmed. The scenario's own conference_joined /
  // conference_failed report is the truth the panel must watch.
  //
  // The phone number is never echoed back — the response names the KIND of target
  // accepted, so a response body cannot become a second copy of a dialable number.
  return noStoreJson(
    { conferencing: true, request_id: delivery.requestId, ...target.accepted },
    202,
  );
}
