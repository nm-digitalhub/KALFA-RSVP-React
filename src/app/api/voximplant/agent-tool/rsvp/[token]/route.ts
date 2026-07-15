import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import { processCallRsvp } from '@/lib/data/call-result-processing';
import { guardAgentToolRequest } from '@/lib/voximplant/agent-tool-guard';
import type { Database } from '@/lib/supabase/types';
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
// webhook_inbox (durable retry via the 1-min drain → processCallRsvpRow) AND run
// the RSVP write synchronously so the scenario can return a TRUTHFUL ok/fail to
// the agent (which only claims "נרשם" on ok:true). A sync failure still leaves the
// durable row for the drain, so the RSVP is never lost.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024; // a save_rsvp body is tiny; reject anything larger

type WebhookInboxInsert = Database['public']['Tables']['webhook_inbox']['Insert'];
type Json = WebhookInboxInsert['payload'];

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

const bad = (status: number) => new NextResponse(null, { status });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardAgentToolRequest(req, token, {
    scope: 'vox-rsvp',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);
  const { attemptId, raw } = guard;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxSaveRsvpSchema.safeParse(json);
  if (!parsed.success) return bad(400);
  const body = parsed.data;
  const status = voxSaveRsvpStatus(body);

  // Persist durably first (idempotent per distinct answer — D1 value-hash).
  try {
    const row: WebhookInboxInsert = {
      provider: 'voximplant',
      event_kind: 'call_rsvp',
      dedupe_key: `vox-rsvp:${attemptId}:${valueHash(status, body.adults, body.children)}`,
      message_id: attemptId,
      event_at: new Date().toISOString(),
      payload: body as unknown as Json,
    };
    await insertWebhookEvents([row]);
  } catch {
    return bad(500); // nothing stored — the scenario will get ok:false and can retry
  }

  // Synchronous best-effort write so the agent gets a truthful confirmation. On
  // failure we still return 200 with ok:false — the durable row above lets the
  // drain retry — and the agent softens its wording ("רשמתי, נעדכן").
  let ok = false;
  try {
    ({ ok } = await processCallRsvp(attemptId, body));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200 });
}
