import { NextResponse } from 'next/server';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import { processOwnerNote } from '@/lib/data/call-result-processing';
import { guardAgentToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { ownerNoteHash } from '@/lib/voximplant/agent-tool-hash';
import type { TablesInsert } from '@/lib/supabase/types';
import { voxNotifyOwnerSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/agent-tool/note/{token}
//
// The agent's `notify_owner` client tool (conversation-design §4.2): relay a guest
// question / message / flag to the event owner. The note lands in the event's
// activity log (action=call.owner_note) — guest-authored text only, capped at 500
// chars; never the phone, transcript or recording. Identity = the token's
// call_attempts row, never the body.
//
// PERSIST-THEN-PROCESS like the sibling tools: durable inbox row + synchronous
// best-effort write so the agent's "אעביר לבעלי השמחה" is truthful.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

type WebhookInboxInsert = TablesInsert<'webhook_inbox'>;
type Json = WebhookInboxInsert['payload'];

// Token-bearing URL: explicit no-store on every response (config-layer block
// on /api/voximplant/:path* is defense-in-depth, this is the primary control).
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardAgentToolRequest(req, token, {
    scope: 'vox-note',
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

  const parsed = voxNotifyOwnerSchema.safeParse(json);
  if (!parsed.success) return bad(400);
  const body = parsed.data;

  // Distinct notes in the same call are distinct rows; an exact resend is a no-op.
  const noteHash = ownerNoteHash(body);
  try {
    const row: WebhookInboxInsert = {
      provider: 'voximplant',
      event_kind: 'call_owner_note',
      dedupe_key: `vox-note:${attemptId}:${noteHash}`,
      message_id: attemptId,
      event_at: new Date().toISOString(),
      payload: body as unknown as Json,
    };
    await insertWebhookEvents([row]);
  } catch {
    return bad(500);
  }

  // The business outcome travels in the body, apart from the HTTP status:
  //   recorded — the note is in the event's activity log. That is all it means: this
  //              route has no delivery step, so it is NOT "the owner was notified".
  //   queued   — a transient failure; the durable row above is retried by the drain.
  //   failed   — terminal (no such attempt); never reported as "queued".
  // `ok` is kept for a consumer that reads only the boolean.
  let status: 'recorded' | 'queued' | 'failed';
  try {
    const { ok } = await processOwnerNote(attemptId, body);
    status = ok ? 'recorded' : 'failed';
  } catch {
    status = 'queued';
  }

  return NextResponse.json(
    { ok: status === 'recorded', status },
    { status: 200, headers: NO_STORE },
  );
}
