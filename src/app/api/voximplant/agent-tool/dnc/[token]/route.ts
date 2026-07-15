import { NextResponse } from 'next/server';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import { processCallDnc } from '@/lib/data/call-result-processing';
import { guardAgentToolRequest } from '@/lib/voximplant/agent-tool-guard';
import type { Database } from '@/lib/supabase/types';
import { voxMarkDncSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/agent-tool/dnc/{token}
//
// The agent's `mark_dnc` client tool (conversation-design §4.2 — legally critical):
// the guest asked mid-call not to be called again. No body parameters carry any
// identity — the phone is resolved server-side from the token's call_attempts row
// (attempt → contact → normalized_phone) and upserted into call_dnc_list, the same
// canonical key the dispatcher's DNC gate matches on.
//
// PERSIST-THEN-PROCESS like the rsvp tool: the request is durably queued
// (webhook_inbox, event_kind=call_dnc) AND applied synchronously — an opt-out must
// never be lost to a transient failure, so the drain retries whatever the sync
// pass could not complete (the upsert is idempotent).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

type WebhookInboxInsert = Database['public']['Tables']['webhook_inbox']['Insert'];
type Json = WebhookInboxInsert['payload'];

const bad = (status: number) => new NextResponse(null, { status });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardAgentToolRequest(req, token, {
    scope: 'vox-dnc',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);
  const { attemptId, raw } = guard;

  let json: unknown;
  try {
    json = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxMarkDncSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  // One opt-out per attempt is enough — a repeat in the same call is a no-op.
  try {
    const row: WebhookInboxInsert = {
      provider: 'voximplant',
      event_kind: 'call_dnc',
      dedupe_key: `vox-dnc:${attemptId}`,
      message_id: attemptId,
      event_at: new Date().toISOString(),
      payload: parsed.data as unknown as Json,
    };
    await insertWebhookEvents([row]);
  } catch {
    return bad(500);
  }

  let ok = false;
  try {
    ({ ok } = await processCallDnc(attemptId));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200 });
}
