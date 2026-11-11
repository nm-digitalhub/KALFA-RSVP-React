import { recordCallbackRequest, setElConversationId } from '@/lib/data/call-attempts';
import { advanceLegStatus } from '@/lib/data/console-monitor';
import { guardAgentToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore, okNoStore } from '@/lib/voximplant/no-store-response';
import { persistVoxInboxEvent } from '@/lib/voximplant/tool-inbox';
import {
  voxCallbackRequestSchema,
  voxCallbackSchema,
  voxLegStatusSchema,
} from '@/lib/validation/voximplant';

// POST /api/voximplant/cb/{token}
//
// The Voximplant RSVP scenario POSTs call results here (recording_started, then a
// terminal status). Voximplant sends NO signature header and never retries — it
// only logs the response code — so auth is the per-call opaque access token in the
// path (Branch B: the same 128-bit random nonce on the call_attempts row, looked
// up server-side; identity is the resolved row, never the body). PERSIST-THEN-PROCESS: this route
// only VERIFIES + PERSISTS (idempotent, into webhook_inbox) and returns fast; the
// existing webhook drain (processWebhookEvent → processCallResult; the persist
// wakes it, with a 5-minute cron as the fallback) does the RSVP/billing with
// received/processed/failed states + retry, so a processing failure never loses
// the callback. Mirrors src/app/api/webhooks/whatsapp/route.ts.

const MAX_BODY_BYTES = 256 * 1024; // reject anything larger than a real transcript needs

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // The shared cb-model guard: fail-closed rate limit → body-size caps → opaque
  // per-call access token → expiry → capped body read. Every token failure
  // (unknown, expired, a DB error) is the same generic 404.
  const guard = await guardAgentToolRequest(req, token, {
    scope: 'vox-cb',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return emptyNoStore(guard.status);
  const { attemptId, raw } = guard;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return emptyNoStore(400);
  }

  // schedule_callback (combination feature): handled OUT-OF-BAND — persisted
  // directly (activity_log + the attempt's callback_* columns), NOT queued to
  // webhook_inbox, so the drain's processCallResult never sees it (it would
  // otherwise write status:'callback_requested'). Tried BEFORE the shared schema;
  // a normal cb body (completed/…) does not match the literal and falls through.
  //
  // The scenario tells the guest "נחזור אליך" only on a 200, so a 200 here means the
  // request IS recorded. Anything else is a non-200 the scenario relays to the agent
  // as a failure (it then falls back to its tool-failure wording / notify_owner).
  // Nothing is queued for a retry: the request is not in webhook_inbox, so no
  // "queued" is ever promised for it.
  const scheduleReq = voxCallbackRequestSchema.safeParse(json);
  if (scheduleReq.success) {
    try {
      const { applied } = await recordCallbackRequest(
        attemptId,
        scheduleReq.data.callback_when_text,
        scheduleReq.data.callback_iso ?? null,
      );
      if (!applied) return emptyNoStore(404);
    } catch {
      return emptyNoStore(500); // never leak DB detail
    }
    return okNoStore();
  }

  // Human-agent supervisor leg status (monitor / takeover): the RSVPAgent scenario
  // POSTs this OUT-OF-BAND as the leg dials / connects / drops. It advances the
  // human_agent_call_legs row KALFA created, SCOPED to this token's attempt so a
  // token can never move another call's leg. Handled here (not queued to the drain)
  // and tried before the shared schema; a normal cb body falls through.
  const legStatus = voxLegStatusSchema.safeParse(json);
  if (legStatus.success) {
    try {
      await advanceLegStatus(
        attemptId,
        legStatus.data.request_id,
        legStatus.data.leg_status,
        legStatus.data.failure_code,
      );
    } catch {
      /* best-effort — never leak DB detail; the app also watches its own SDK leg */
    }
    return okNoStore();
  }

  // strictObject rejects any field outside the verified contract.
  const parsed = voxCallbackSchema.safeParse(json);
  if (!parsed.success) return emptyNoStore(400);
  const body = parsed.data;

  // invitation_id (if present) MUST match the token's attempt id — it is a
  // sanity check, never the identity source. A mismatch = tampering → reject.
  if (typeof body.invitation_id === 'string' && body.invitation_id !== attemptId) {
    return emptyNoStore(400);
  }

  // Persist idempotently: UNIQUE(provider, dedupe_key) makes a re-delivered
  // (attempt, status) callback a no-op. message_id carries the TOKEN-verified
  // attempt id — the drain resolves identity from this, never from the payload.
  try {
    await persistVoxInboxEvent({
      eventKind: 'call_result',
      dedupeKey: `vox-cb:${attemptId}:${body.call_status}`,
      attemptId,
      payload: body,
    });
  } catch {
    // Persist failed — return 500 (Voximplant only logs it; we did not lose a
    // stored callback because nothing was stored). Never leak DB detail.
    return emptyNoStore(500);
  }

  // ADDITIVE (second link vector): if the ElevenLabs-bridge scenario sent a
  // conversation_id, store it on the token-resolved attempt. Best-effort — a
  // failure never affects the ack, and the token nonce remains the PRIMARY link.
  // Branch B never sends this field, so this path is inert for the DTMF scenario.
  if (typeof body.el_conversation_id === 'string' && body.el_conversation_id.length > 0) {
    try {
      await setElConversationId(attemptId, body.el_conversation_id);
    } catch {
      /* swallow — the durable webhook_inbox row above is the source of truth */
    }
  }

  // Stable, minimal ack. Processing + RSVP/billing happen in the webhook drain.
  return okNoStore();
}
