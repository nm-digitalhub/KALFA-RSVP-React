import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import {
  findConsoleCallForEvent,
  mapEndedReasonToStatus,
  recordConsoleCallSessionAccess,
  recordNoAgentCallback,
  resolveAgentIdByVoxUsername,
  updateConsoleCallStatus,
} from '@/lib/data/console-calls';
import { consoleEventBodySchema } from '@/lib/validation/console-calls';

// POST /api/voximplant/console/event   called BY both scenarios' reportEvent()
// (ConsoleDial.voxengine.js:153-178, ConsoleInbound.voxengine.js:125-150).
// Best-effort, fire-and-forget from the scenario's side (there is no HTTP
// reply channel inside a live VoxEngine session — AppEvents.HttpRequest has
// none — so the scenario never blocks or branches on this response). This
// route therefore ALWAYS answers 202 once the secret/shape checks pass, and
// every DB write inside is best-effort: a lost report degrades the
// console_calls row's bookkeeping, never a live call's audio path.
//
// call_kind='internal' is intentionally NOT persisted (see the comment in
// the handler below) — logged only. call_kind ∈ {'outbound','inbound'}
// resolve to their pre-created console_calls row via
// findConsoleCallForEvent() and update it per event type.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 4_096;
// Coarse per-IP flood guard only — see authorize/route.ts's identical note.
// Looser than authorize: a single live call can emit several events
// (started/ringing/connected/ended, sometimes transfer_*).
const RATE = { limit: 300, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const ACK = { ok: true } as const;

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`vox-console-event:${ip}`, RATE).allowed) {
    return json(ACK, 429);
  }

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return json(ACK, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(ACK, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(ACK, 400);
  }
  const parsed = consoleEventBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(ACK, 400);
  const body = parsed.data;

  const expected = process.env.KALFA_CONSOLE_SECRET;
  if (!expected) return json(ACK, 503);
  if (!safeTokenEqual(body.secret, sha256Hex(expected))) {
    return json(ACK, 401);
  }

  // Internal (agent↔agent) legs are deliberately NOT tracked as a
  // console_calls row in V1: the scenario's internal branch never sends the
  // CALLING agent's own identity in this event stream (only the callee's
  // vox_username, via `token`) — see ConsoleDial.voxengine.js's
  // handleInternal/CallAlerting handler. A row with agent_id permanently
  // NULL would misrepresent "who called whom" on a ledger whose whole point
  // is that attribution. Ops-knobs decision 4 also scopes "record
  // everything" to customer-facing legs only. PII-free, non-blocking log
  // only. (Open item for whoever owns internal-call history: the scenario
  // would need to also send state.operatorUsername for this to be
  // attributable.)
  if (body.call_kind === 'internal') {
    console.log(`[console/event] internal ${body.event} session=${body.session_id}`);
    return json(ACK, 202);
  }

  let callId: string | null;
  try {
    callId = await findConsoleCallForEvent({
      sessionId: body.session_id,
      direction: body.call_kind,
      token: body.call_kind === 'outbound' ? body.token : undefined,
      callId: body.call_kind === 'inbound' ? body.call_id : undefined,
    });
  } catch {
    return json(ACK, 202); // best-effort — never fail the ack over a lookup error
  }
  if (!callId) {
    console.log(
      `[console/event] unresolved ${body.call_kind} ${body.event} session=${body.session_id}`,
    );
    return json(ACK, 202);
  }

  try {
    switch (body.event) {
      case 'started':
        // Session-link side effect already happened inside
        // findConsoleCallForEvent() above. The only other thing 'started'
        // carries is the command-channel capability (stage 7) — best-effort,
        // persisted only when the scenario actually sent it.
        if (body.access_url || body.access_secure_url) {
          await recordConsoleCallSessionAccess({
            callId,
            accessUrl: body.access_url ?? null,
            accessSecureUrl: body.access_secure_url ?? null,
          });
        }
        break;

      case 'ringing':
        await updateConsoleCallStatus({
          callId,
          status: 'ringing',
          onlyIfLive: true,
          // Inbound: the disclosure has already played (ConsoleInbound only
          // reports 'ringing' after PlaybackFinished). Outbound: 'ringing'
          // fires BEFORE the guest leg exists, let alone the disclosure —
          // that flips at 'connected' instead.
          ...(body.call_kind === 'inbound' ? { disclosurePlayed: true } : {}),
        });
        break;

      case 'connected': {
        // Inbound only: the serial ring resolves a winner only now — this is
        // the FIRST point the row learns who is on the call (outbound already
        // set agent_id at creation, dial-intent's ctx.userId). Best-effort and
        // additive only: an unresolvable vox_username just leaves agent_id
        // unset (never writes null over a value another path may have set).
        const resolvedAgentId =
          body.call_kind === 'inbound' && body.agent
            ? await resolveAgentIdByVoxUsername(body.agent).catch(() => null)
            : null;
        await updateConsoleCallStatus({
          callId,
          status: 'connected',
          onlyIfLive: true,
          answeredNow: true,
          ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
          // Outbound: 'connected' fires only after the guest leg's
          // disclosure PlaybackFinished. Inbound already flipped this at
          // 'ringing'.
          ...(body.call_kind === 'outbound' ? { disclosurePlayed: true } : {}),
        });
        break;
      }

      case 'ended':
        await updateConsoleCallStatus({
          callId,
          status: mapEndedReasonToStatus(body.reason),
          endedReason: body.reason,
          durationSec: body.duration_s,
          recordingUrl: body.recording_url,
          endedNow: true,
        });
        // The scenario already TOLD the caller "נחזור אליכם בהקדם" when the
        // ring order ran out; this is what makes that true. Hour-agnostic:
        // the ring exhausts at 03:00 because nobody is awake and at 14:00
        // because everyone is busy, and both deserve a callback.
        if (body.reason === 'no_agent') {
          await recordNoAgentCallback({ consoleCallId: callId });
        }
        break;

      case 'transfer_started': {
        const targetAgentId = await resolveAgentIdByVoxUsername(body.target);
        if (targetAgentId) {
          await updateConsoleCallStatus({ callId, transferredToAgentId: targetAgentId });
        }
        break;
      }

      case 'transferred':
        // transferred_to_agent_id was already set optimistically at
        // transfer_started — this event carries no target identity of its
        // own to confirm against (request_id only), so there is nothing
        // further to persist here.
        break;

      case 'transfer_failed':
        // Revert the optimistic write from transfer_started.
        await updateConsoleCallStatus({ callId, transferredToAgentId: null });
        break;

      // ── Stage 2 (consult-before-transfer) ──────────────────────────────
      case 'consult_started': {
        const consultAgentId = await resolveAgentIdByVoxUsername(body.target);
        if (consultAgentId) {
          await updateConsoleCallStatus({ callId, consultAgentId });
        }
        break;
      }

      case 'consult_connected':
        // The PRIVATE operator<->target bridge is now actually live (the
        // target answered). THIS is the moment "complete transfer" becomes a
        // true statement — consult_agent_id was already set optimistically at
        // consult_started, while the target was still ringing, and gating the
        // button on that made it clickable up to 20s early for a no-op (the
        // save_rsvp 'queued' pattern; see the 20260813064814 migration).
        // Stamped as its own column rather than by moving the consult_agent_id
        // write here, so the CANCEL affordance stays available from the first
        // moment — and so no scenario edit is needed (this report carries only
        // request_id; the row is already resolved from the linked session).
        await updateConsoleCallStatus({ callId, consultConnected: true });
        break;

      case 'conference_started':
        // Dialing the 3rd participant has begun. No DB write — nothing in
        // console_calls or the UI keys off the dialing phase (the "בוועידה"
        // badge only reads conference_agent_ids, written on conference_joined,
        // and the caller stays normally bridged throughout the dial, so
        // there is no silence/honesty gap here the way there is for
        // consult). Recognized only so the event is acknowledged instead of
        // failing validation — see consoleEventBodySchema.
        break;

      case 'consult_cancelled':
      case 'consult_failed':
        // Either way the consult attempt is over without a transfer having
        // happened — clear the optimistic write from consult_started AND the
        // connected stamp, so a later consult on this same call starts from
        // an honest "not connected yet" again.
        await updateConsoleCallStatus({ callId, consultAgentId: null, consultConnected: null });
        break;

      case 'consult_completed': {
        // The actual warm transfer: the consult target is now bridged to the
        // customer, the original operator has been released. `target` is
        // resolved directly here (not read back from the row's own
        // consult_agent_id) so this event has no ordering dependency on
        // consult_started's report having already landed.
        const targetAgentId = await resolveAgentIdByVoxUsername(body.target);
        await updateConsoleCallStatus({
          callId,
          consultAgentId: null,
          consultConnected: null,
          ...(targetAgentId ? { transferredToAgentId: targetAgentId } : {}),
        });
        break;
      }

      // ── Stage 2 (3-way conference) ──────────────────────────────────────
      case 'conference_joined': {
        const targetAgentId = await resolveAgentIdByVoxUsername(body.target);
        if (targetAgentId) {
          await updateConsoleCallStatus({ callId, conferenceAgentIds: [targetAgentId] });
        }
        break;
      }

      case 'conference_failed':
        // Dialing the conference target never succeeded — nothing was ever
        // written to conference_agent_ids, so there is nothing to revert.
        // Logged only (via the best-effort report itself reaching this far).
        break;

      case 'conference_ended':
        await updateConsoleCallStatus({ callId, conferenceAgentIds: [] });
        break;
    }
  } catch {
    // Best-effort — see module header.
  }

  return json(ACK, 202);
}
