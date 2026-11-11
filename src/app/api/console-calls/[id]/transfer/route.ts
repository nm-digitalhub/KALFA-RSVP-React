import {
  deliverConsoleCallCommand,
  invalidCallIdResponse,
  loadConnectedCustomerCall,
  resolveAgentCallTarget,
} from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { recordConsoleTransferAudit } from '@/lib/data/console-calls';
import { noStoreJson } from '@/lib/http/no-store-json';
import { readJsonBody } from '@/lib/http/read-json-body';
import { consoleTransferBodySchema } from '@/lib/validation/console-calls';

// POST /api/console-calls/{id}/transfer   body: { to_agent_id: uuid }
//
// Blind agent-to-agent transfer (V1 = scenario-side, no consult).
// { id } is a console_calls row (a live manual-outbound or inbound-customer
// call — NEVER an ai_handoff row or an internal call, which this route does
// not touch at all). The browser names the TARGET AGENT only; the route
// resolves it to a routable vox_username server-side (never trusts a
// Voximplant identity from the client) and posts the SAME
// {command:'transfer', request_id, payload:{vox_username}} envelope
// ConsoleDial.voxengine.js / ConsoleInbound.voxengine.js already dispatch on
// (both scenarios' `transfer` branch, verbatim).
//
// console_calls.transferred_to_agent_id bookkeeping is EVENT-driven — the
// scenario's own transfer_started/transferred/transfer_failed reports
// (POST /api/voximplant/console/event) already own that write. This route
// never touches console_calls itself: it only validates, resolves, and
// delivers. 2xx here means DELIVERED to the live session, never "the
// transfer happened" — the scenario answers that out-of-band via those
// events, which the panel watches, exactly like the AI-command channel.
//
// Auth mirrors every other live-call console route: requireConsoleAgent
// (Bearer + staff) + manage_voice at the route (the call-floor authority,
// not per-agent ownership — same model as /monitor and /agent-command, which
// let any manage_voice holder act on any live call).

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
  const parsed = consoleTransferBodySchema.safeParse(read.value);
  if (!parsed.success) return noStoreJson({ error: 'גוף הבקשה אינו תקין' }, 400);
  const { to_agent_id: toAgentId } = parsed.data;

  // Only a call with a live bridge (operator + remote both connected) can be
  // transferred — the scenario's own startTransfer() silently no-ops
  // otherwise (no transfer_failed report either), so gating on the
  // narrower 'connected' state (not the wider LIVE_STATUSES) keeps the
  // 202/404/409 contract honest instead of returning "delivered" for a
  // command the scenario will drop on the floor.
  const loaded = await loadConnectedCustomerCall(callId, 'לא ניתן להעביר שיחה מסוג זה');
  if (!loaded.ok) return loaded.response;

  const resolved = await resolveAgentCallTarget(toAgentId, ctx.userId, 'לא ניתן להעביר שיחה לעצמך');
  if (!resolved.ok) return resolved.response;

  const delivery = await deliverConsoleCallCommand(callId, 'transfer', resolved.target.payload, {
    unavailable: 'השיחה אינה זמינה להעברה כעת',
    undelivered: 'בקשת ההעברה לא נמסרה לשיחה',
  });
  if (!delivery.ok) return delivery.response;

  // Best-effort — never blocks the response. The console_calls row itself
  // (via the event-driven transferred_to_agent_id) remains the primary durable
  // record; this is the "who initiated" trail the consent-matrix audit
  // established a precedent for (recordConsoleDialAudit).
  await recordConsoleTransferAudit({
    fromAgentId: ctx.userId,
    toAgentId,
    consoleCallId: callId,
    eventId: loaded.call.eventId,
    requestId: delivery.requestId,
  });

  // Delivered; NOT confirmed. The scenario reports transfer_started ->
  // transferred | transfer_failed asynchronously via the event route, which
  // is what the panel must watch (console_calls realtime) — never this 202.
  return noStoreJson(
    { transferring: true, request_id: delivery.requestId, to_agent_id: toAgentId },
    202,
  );
}
