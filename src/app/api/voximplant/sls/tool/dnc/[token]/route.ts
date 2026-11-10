import { processSalesOptOut } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore, jsonNoStore } from '@/lib/voximplant/no-store-response';
import { persistVoxInboxEvent } from '@/lib/voximplant/tool-inbox';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardSalesToolRequest,
    scope: 'vox-sls-dnc',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxMeetingOptOutSchema,
    emptyBodyAsObject: true,
  });
  if (!input.ok) return input.response;
  const { attemptId } = input;

  try {
    await persistVoxInboxEvent({
      eventKind: 'sls_dnc',
      dedupeKey: `vox-sls-dnc:${attemptId}`,
      attemptId,
      payload: input.data,
    });
  } catch {
    return emptyNoStore(500);
  }

  const ok = await okOrFalse(() => processSalesOptOut(attemptId));

  return jsonNoStore({ ok });
}
