import { processSalesNotifyOwner } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
import { voxNotifyOwnerSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/note/{token}
//
// The sales-closing agent's `notify_owner` tool — reused tool_id, sales-
// scoped route. Synchronous only (unlike the DNC tool, a lost note is a
// missed follow-up, not a spam-law exposure) — same discipline as
// callback-voice-processing.ts's processMeetingEscalate.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardSalesToolRequest,
    scope: 'vox-sls-note',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxNotifyOwnerSchema,
  });
  if (!input.ok) return input.response;

  const ok = await okOrFalse(() => processSalesNotifyOwner(input.attemptId, input.data));

  return jsonNoStore({ ok });
}
