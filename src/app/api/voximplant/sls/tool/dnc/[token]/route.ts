import { NextResponse } from 'next/server';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import { processSalesOptOut } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import type { TablesInsert } from '@/lib/supabase/types';
import { voxMeetingOptOutSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/dnc/{token}
//
// The sales-closing agent's `mark_dnc` tool — reused tool_id, sales-scoped
// route (script draft §3: "reused unchanged from RSVPAgent's existing
// registered tools", same schema/behavior). PERSIST-THEN-PROCESS, same real
// spam-law weight as agent-tool/dnc and mtg/tool/dnc.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

type WebhookInboxInsert = TablesInsert<'webhook_inbox'>;
type Json = WebhookInboxInsert['payload'];

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardSalesToolRequest(req, token, {
    scope: 'vox-sls-dnc',
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

  const parsed = voxMeetingOptOutSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  try {
    const row: WebhookInboxInsert = {
      provider: 'voximplant',
      event_kind: 'sls_dnc',
      dedupe_key: `vox-sls-dnc:${attemptId}`,
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
    ({ ok } = await processSalesOptOut(attemptId));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200, headers: NO_STORE });
}
