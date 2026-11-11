import { processSalesEscalate } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
import { voxSalesEscalateSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/escalate/{token}
//
// The sales-closing agent's `escalate_to_human` tool (script draft §3):
// checks/transfers to a live rep if one is reachable, and is HONEST when
// none is — `transferred` is only ever true for a REAL bridged leg (same
// discipline as save_rsvp's "queued" false-promise fix; see
// docs/voice-agent/production-wiring-audit-2026-07-20.md). v1 has no
// live-transfer mechanism wired for this token surface (same non-goal as the
// meeting-booking plan's escalate_to_queue), so this always returns
// `transferred: false` and instead raises the SAME
// contact_messages/Slack queue notify_owner uses — never silently
// pretending a handoff happened.

const MAX_BODY_BYTES = 2 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardSalesToolRequest,
    scope: 'vox-sls-escalate',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxSalesEscalateSchema,
  });
  if (!input.ok) return input.response;

  const ok = await okOrFalse(() => processSalesEscalate(input.attemptId, input.data));

  // No live-transfer path in v1 — see file header. `ok` reflects whether the
  // queue notification itself succeeded; `transferred` is always false.
  return jsonNoStore({ transferred: false, notified: ok });
}
