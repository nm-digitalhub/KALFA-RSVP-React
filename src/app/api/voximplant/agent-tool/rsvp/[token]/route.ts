import { createHash } from 'node:crypto';

import { errorDetail } from '@/lib/error-detail';
import { processCallRsvp } from '@/lib/data/call-result-processing';
import { guardAgentToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore, jsonNoStore } from '@/lib/voximplant/no-store-response';
import { persistVoxInboxEvent } from '@/lib/voximplant/tool-inbox';
import { readToolRequest } from '@/lib/voximplant/tool-route';
import { voxSaveRsvpSchema, voxSaveRsvpStatus } from '@/lib/validation/voximplant';

// POST /api/voximplant/agent-tool/rsvp/{token}
//
// Tier 2: the ElevenLabs conversational agent's `save_rsvp` client tool. The
// Voximplant scenario (which holds the per-call token) forwards the tool call
// here after the guest confirms their answer + counts. Auth = guardAgentToolRequest
// (the shared cb-model guard: opaque per-call access token; identity is the
// resolved call_attempts row, NEVER the body).
//
// PERSIST-THEN-PROCESS + synchronous best-effort: we persist idempotently to
// webhook_inbox (durable retry via the webhook drain → processCallRsvpRow) AND run
// the RSVP write synchronously so the scenario can return a TRUTHFUL ok/fail to
// the agent (which only claims "נרשם" on ok:true). A sync failure still leaves the
// durable row for the drain, so the RSVP is never lost.

const MAX_BODY_BYTES = 16 * 1024; // a save_rsvp body is tiny; reject anything larger

// D1 (value-hash dedupe): each DISTINCT answer is a distinct inbox row (a mid-call
// correction persists as its own durable row and is processed after the earlier
// one → the latest confirmed answer wins), while a re-send of the SAME values is a
// no-op via UNIQUE(provider, dedupe_key).
function valueHash(status: string, adults: number, children: number): string {
  return createHash('sha256')
    .update(`${status}:${adults}:${children}`)
    .digest('hex')
    .slice(0, 16);
}

// A failure in either stage is logged with its cause (errorDetail: the Supabase/
// Postgres code behind the data layer's Hebrew message) and the attempt id — never
// the token or the answer. Without it a persist failure left no trace at all, and
// a sync failure the drain later recovered from was invisible.
function logStageFailure(stage: 'persist' | 'sync_apply', attemptId: string, error: unknown): void {
  console.error('[vox-rsvp] save_rsvp stage failed', { stage, attemptId, detail: errorDetail(error) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardAgentToolRequest,
    scope: 'vox-rsvp',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxSaveRsvpSchema,
  });
  if (!input.ok) return input.response;
  const { attemptId, data: body } = input;
  const status = voxSaveRsvpStatus(body);

  // Persist durably first (idempotent per distinct answer — D1 value-hash).
  try {
    await persistVoxInboxEvent({
      eventKind: 'call_rsvp',
      dedupeKey: `vox-rsvp:${attemptId}:${valueHash(status, body.adults, body.children)}`,
      attemptId,
      payload: body,
    });
  } catch (error) {
    // Nothing stored and no drain behind it: this log line is the only record.
    logStageFailure('persist', attemptId, error);
    return emptyNoStore(500); // nothing stored — a non-200, which the scenario answers to the agent as 'error'
  }

  // Synchronous best-effort apply so the agent gets a TRUTHFUL confirmation.
  // The response distinguishes three outcomes; HTTP 200 alone never means the
  // RSVP was saved (it only means we accepted and durably captured the intent):
  //
  //   saved    — applied. The ONLY value that may be voiced as "נרשם".
  //   rejected — submit_rsvp refused on business grounds. Terminal; retrying
  //              cannot change it. The agent must not imply a later save.
  //   queued   — a transient failure. The durable row above IS retried by the
  //              drain, so this promise is real.
  //
  // `ok` is retained for backward compatibility with a consumer that reads only
  // the boolean, and is true only for `saved`.
  let applyStatus: 'saved' | 'rejected' | 'queued' = 'queued';
  let reason: string | undefined;
  try {
    const outcome = await processCallRsvp(attemptId, body);
    applyStatus = outcome.status;
    if (outcome.status === 'rejected') reason = outcome.reason;
  } catch (error) {
    // Thrown = transient (RPC/transport). The durable row drives the retry, so
    // the answer stays 'queued'; the failure itself is logged.
    logStageFailure('sync_apply', attemptId, error);
    applyStatus = 'queued';
  }

  return jsonNoStore(
    {
      ok: applyStatus === 'saved',
      status: applyStatus,
      ...(reason ? { reason } : {}),
    },
  );
}
