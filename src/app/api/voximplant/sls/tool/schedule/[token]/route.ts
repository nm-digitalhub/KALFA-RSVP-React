import { processSalesScheduleCallback } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
import { voxRequestRescheduleSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/schedule/{token}
//
// The sales-closing agent's `schedule_callback` tool — reused tool_id,
// sales-scoped route. Same mechanism as mtg/tool/reschedule
// (rescheduleCallbackRequest) — synchronous, the agent's own script already
// falls back to a plain apology if this returns ok:false (§1's error-
// handling section).

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardSalesToolRequest,
    scope: 'vox-sls-schedule',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxRequestRescheduleSchema,
  });
  if (!input.ok) return input.response;

  const ok = await okOrFalse(() => processSalesScheduleCallback(input.attemptId, input.data));

  return jsonNoStore({ ok });
}
