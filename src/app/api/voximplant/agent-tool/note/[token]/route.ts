import { processOwnerNote } from '@/lib/data/call-result-processing';
import { guardAgentToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore, jsonNoStore } from '@/lib/voximplant/no-store-response';
import { persistVoxInboxEvent } from '@/lib/voximplant/tool-inbox';
import { readToolRequest } from '@/lib/voximplant/tool-route';
import { ownerNoteHash } from '@/lib/voximplant/agent-tool-hash';
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

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardAgentToolRequest,
    scope: 'vox-note',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxNotifyOwnerSchema,
  });
  if (!input.ok) return input.response;
  const { attemptId, data: body } = input;

  // Distinct notes in the same call are distinct rows; an exact resend is a no-op.
  const noteHash = ownerNoteHash(body);
  try {
    await persistVoxInboxEvent({
      eventKind: 'call_owner_note',
      dedupeKey: `vox-note:${attemptId}:${noteHash}`,
      attemptId,
      payload: body,
    });
  } catch {
    return emptyNoStore(500);
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

  return jsonNoStore(
    { ok: status === 'recorded', status },
  );
}
