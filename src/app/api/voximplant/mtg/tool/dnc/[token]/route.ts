import { NextResponse } from 'next/server';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import { processMeetingOptOut } from '@/lib/data/callback-voice-processing';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
import type { Database } from '@/lib/supabase/types';
import { voxMeetingOptOutSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/mtg/tool/dnc/{token}
//
// The meeting-booking agent's `mark_opt_out` tool (plan §4, legally
// critical): the lead asked not to be called again. Upserts into
// call_dnc_list — the SAME table/key the RSVP agent's mark_dnc/processCallDnc
// already use (§4's correction: not a new column). PERSIST-THEN-PROCESS,
// unlike this table's other 3 tools: a lost opt-out is a real spam-law
// exposure, not merely a lost log entry, so it gets the same durable-retry
// backstop as the RSVP surface's own DNC tool — via event_kind='mtg_dnc', its
// OWN drain case (never 'call_dnc'), so this can never touch call_attempts/
// RSVP/billing processing code (plan §7's isolation requirement).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

type WebhookInboxInsert = Database['public']['Tables']['webhook_inbox']['Insert'];
type Json = WebhookInboxInsert['payload'];

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardMeetingToolRequest(req, token, {
    scope: 'vox-mtg-dnc',
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

  // One opt-out per attempt is enough — a repeat in the same call is a no-op
  // (same reasoning as the RSVP surface's agent-tool/dnc route).
  try {
    const row: WebhookInboxInsert = {
      provider: 'voximplant',
      event_kind: 'mtg_dnc',
      dedupe_key: `vox-mtg-dnc:${attemptId}`,
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
    ({ ok } = await processMeetingOptOut(attemptId));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200, headers: NO_STORE });
}
