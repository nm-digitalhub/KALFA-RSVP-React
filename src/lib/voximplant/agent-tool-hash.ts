import { createHash } from 'node:crypto';

// One notify_owner note, identified by its content. The agent-tool route uses it as
// the webhook_inbox dedupe key (an exact resend is a no-op), and processOwnerNote
// stamps it on the activity_log row so the route's synchronous write and the
// drain's re-application of the durable row cannot both land. Kept out of the
// processing module so the route can import it without pulling the DB layer in.
export function ownerNoteHash(note: { kind: string; text: string }): string {
  return createHash('sha256')
    .update(`${note.kind}:${note.text}`)
    .digest('hex')
    .slice(0, 16);
}

// One schedule_callback request, identified by what the guest asked for. processing
// stamps it on the call.callback_requested activity row; the lookup is always scoped
// to the attempt id as well, so the same words in a DIFFERENT call are a different
// request and are never dropped.
export function callbackRequestHash(request: {
  whenText: string;
  iso: string | null;
}): string {
  return createHash('sha256')
    .update(`${request.whenText}|${request.iso ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}
