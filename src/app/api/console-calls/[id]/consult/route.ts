import {
  deliverConsoleCallCommand,
  invalidCallIdResponse,
  loadConnectedCustomerCall,
  resolveCallTarget,
} from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { recordConsoleConsultAudit } from '@/lib/data/console-calls';
import { noStoreJson } from '@/lib/http/no-store-json';
import { readJsonBody } from '@/lib/http/read-json-body';
import { consoleConsultBodySchema } from '@/lib/validation/console-calls';

// POST /api/console-calls/{id}/consult   body: { to_agent_id: uuid } | { to_phone: string }
//
// Consult-before-transfer, step 1. Mirrors
// transfer/route.ts almost verbatim: { id } is a live manual-outbound or
// inbound-customer console_calls row (never ai_handoff/internal); the
// browser names the TARGET only — an agent, which the route resolves
// server-side via the SAME resolveTransferTarget() blind transfer already uses
// (routable = provisioned + ready, never self), or an outside number, cleared
// by resolveExternalDialTarget() — and posts
// {command:'consult_start', request_id, payload:{vox_username}} or
// payload:{phone}. ConsoleInbound.voxengine.js's `consult_start` branch reads
// either shape; ConsoleDial.voxengine.js's reads `vox_username` only.
//
// Unlike a blind transfer, this does NOT end the call for the original
// operator: the scenario puts the customer on hold (looped hold music, with a
// spoken cue as the fallback — see the scenario's startHoldAudio) and privately
// bridges operator<->target
// so the customer hears neither side of the consultation. The operator then
// either POSTs .../consult/cancel (return to the customer) or
// .../consult/complete (the actual warm transfer: drop the operator, bridge
// customer<->target).
//
// console_calls.consult_agent_id bookkeeping is EVENT-driven, exactly like
// transferred_to_agent_id — this route only validates, resolves, and
// delivers. 2xx here means DELIVERED to the live session, never "the
// consultation started" — the scenario's own consult_started/consult_failed
// reports (POST /api/voximplant/console/event) are the truth the panel
// watches (console_calls realtime).
//
// Auth mirrors every other live-call console route: requireConsoleAgent
// (Bearer + staff) + manage_voice (the call-floor authority, not per-agent
// ownership).

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
  const parsed = consoleConsultBodySchema.safeParse(read.value);
  if (!parsed.success) return noStoreJson({ error: 'גוף הבקשה אינו תקין' }, 400);

  // Same reasoning as transfer/route.ts: only a live-bridged call has
  // anything for the scenario's consult_start guard to act on.
  const loaded = await loadConnectedCustomerCall(callId, 'לא ניתן להתייעץ על שיחה מסוג זה');
  if (!loaded.ok) return loaded.response;

  // Two kinds of target, resolved by two different authorities, and neither
  // trusts the browser with a Voximplant identity or a dialable number: an agent
  // becomes a vox_username via resolveTransferTarget, an outside number is cleared
  // by resolveExternalDialTarget (E.164 + country allowlist + per-agent rate limit
  // + DNC — see its kdoc for the order and why). A rate-limited outside number is
  // 429, so a client can tell "wait" from "this will never work"; every other
  // refusal is a rejected target (409).
  const resolved = await resolveCallTarget(parsed.data, ctx.userId, 'לא ניתן להתייעץ עם עצמך');
  if (!resolved.ok) return resolved.response;
  const { target } = resolved;

  const delivery = await deliverConsoleCallCommand(callId, 'consult_start', target.payload, {
    unavailable: 'השיחה אינה זמינה להתייעצות כעת',
    undelivered: 'בקשת ההתייעצות לא נמסרה לשיחה',
  });
  if (!delivery.ok) return delivery.response;

  await recordConsoleConsultAudit({
    fromAgentId: ctx.userId,
    ...target.audit,
    consoleCallId: callId,
    eventId: loaded.call.eventId,
    requestId: delivery.requestId,
    phase: 'start',
  });

  // Delivered; NOT confirmed. The scenario reports consult_started ->
  // consult_failed asynchronously via the event route — that (console_calls
  // realtime) is what the panel must watch, never this 202.
  // The phone number is NEVER echoed back, even to the agent who typed it — the
  // response says which KIND of target was accepted and nothing more, so a
  // response body cannot become a second copy of a dialable number.
  return noStoreJson(
    { consulting: true, request_id: delivery.requestId, ...target.accepted },
    202,
  );
}
