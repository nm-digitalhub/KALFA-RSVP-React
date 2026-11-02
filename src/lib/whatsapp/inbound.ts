// Pure classifier for a single persisted inbound WhatsApp message (no I/O). A
// HUMAN message (text/button/interactive/reaction) is the billable "reached"
// signal (§4.1). Statuses (sent/delivered/read/failed) and system/unsupported
// messages are NOT billable — only op-status progress.
//
// No message is read as an opt-out: RSVP messages are not marketing, so there is
// no removal request in this product (owner, 01.11.2026). The text itself never
// leaves this module.

import type { components } from '@/lib/whatsapp/generated/incoming-webhook';

// Meta's own shapes, generated from its published webhook spec
// (`npm run meta:types`, whatsapp-incoming-webhook-payload).
type Webhook = components['schemas'];
type IncomingMessageType = Webhook['IncomingMessage']['type'];

// Typed by Meta's message-type enum: a name Meta does not send fails to compile.
const BILLABLE_MESSAGE_TYPES = new Set<IncomingMessageType>([
  'text',
  'button',
  'interactive',
  'reaction',
]);

// A single raw inbound message object, as persisted in webhook_inbox.payload by
// the (B2) persist-then-process route. Structurally a documented subset of the
// provider ServerMessage — the fields we inspect plus `from` (the sender wa_id),
// used only as the phone-resolution fallback when a reply carries no Meta
// context.id. The phone never leaves the resolver.
//
// Each field is Meta's (the generated webhook types), made optional: the row is
// read back from jsonb, so any of them may be missing.
export type InboundMessagePayload = {
  type?: string;
  from?: Webhook['BaseMessageProperties']['from'];
  text?: Partial<Webhook['TextMessage']['text']>;
  // A template quick-reply tap arrives as type:"button" with `payload` carrying
  // the OPAQUE action id we set on the outbound template (`text` is its label).
  button?: Partial<Webhook['ButtonMessage']['button']>;
  // An interactive reply carries the human label (`title`) and the OPAQUE action
  // id (`id`) we set on the button/list row.
  interactive?: {
    button_reply?: Partial<Webhook['InteractiveButtonReplyContent']['button_reply']>;
    list_reply?: Partial<Webhook['InteractiveListReplyContent']['list_reply']>;
  };
};

// Pull the OPAQUE action id of a quick-reply tap, when present. Template
// quick-reply buttons echo it as button.payload; interactive replies as
// interactive.button_reply.id / list_reply.id. Returns null for shapes that
// carry no reply id (plain text, reactions). This id is the value WE set on the
// outbound template — never free text the guest typed — so it is safe to surface
// and route on; it is the only field exposed from a reply (the labels stay in).
export function extractReplyId(m: InboundMessagePayload): string | null {
  return (
    m.button?.payload ??
    m.interactive?.button_reply?.id ??
    m.interactive?.list_reply?.id ??
    null
  );
}

// Is this message type one of the billable "human reached" signals (§4.1)?
// Single source for the type gate, reused by the per-row webhook processor.
export function isBillableMessageType(type: string | undefined | null): boolean {
  return !!type && [...BILLABLE_MESSAGE_TYPES].some((t) => t === type);
}

// Classify ONE persisted inbound message into the billing-/routing-relevant
// signals: whether it is a billable reach, and the opaque reply id of a
// quick-reply tap (used to route an RSVP from a button). Only the boolean and the
// opaque id leave this module (PII-safe). This is the single inbound classifier
// (the worker's only path); there is no parallel batch classifier.
export function classifyMessagePayload(message: InboundMessagePayload): {
  billable: boolean;
  replyId: string | null;
} {
  const billable = isBillableMessageType(message.type);
  const replyId = billable ? extractReplyId(message) : null;
  return { billable, replyId };
}
