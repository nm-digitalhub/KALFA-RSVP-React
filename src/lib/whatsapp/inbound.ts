// Pure classifier for a single persisted inbound WhatsApp message (no I/O). A
// HUMAN message (text/button/interactive/reaction) is the billable "reached"
// signal (§4.1). Statuses (sent/delivered/read/failed) and system/unsupported
// messages are NOT billable — only op-status progress.
//
// D4: a human reply may ALSO express a removal/opt-out intent. We surface that
// as a per-message `removal` boolean (derived from the message text) so the
// webhook can bill the reach AND then stop future outreach. Only the boolean
// leaves this module — the raw text is never returned or logged (PII-safe).

const BILLABLE_MESSAGE_TYPES = new Set([
  'text',
  'button',
  'interactive',
  'reaction',
]);

// Opt-out keywords matched as whole tokens (case-insensitive) against the
// message text. Curated Hebrew + English set; only a CLEAR opt-out trips it.
// Nuanced/implicit phrasing is intentionally NOT detected (conservative: we
// bill + stop only on an explicit request).
const REMOVAL_KEYWORDS = new Set([
  // Hebrew
  'הסר',
  'הסירו',
  'הסירני',
  'תסיר',
  'תסירו',
  'להסיר',
  'הסרה',
  'הפסיקו',
  'תפסיקו',
  // English
  'stop',
  'remove',
  'unsubscribe',
]);

// A single raw inbound message object, as persisted in webhook_inbox.payload by
// the (B2) persist-then-process route. Structurally a documented subset of the
// provider ServerMessage — the text-bearing fields we inspect plus `from` (the
// sender wa_id), used only as the phone-resolution fallback when a reply carries
// no Meta context.id. Declared here so the raw text is extracted and matched in
// ONE place and never leaves this module; the phone never leaves the resolver.
export type InboundMessagePayload = {
  type?: string;
  from?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

// Pull the human-readable text from the message shapes that carry one (text
// body / template button label / interactive reply title). Internal — the text
// never leaves this module.
function extractText(m: InboundMessagePayload): string {
  return (
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    ''
  );
}

// True when the text contains an explicit opt-out keyword (whole-token,
// case-insensitive). Pure + exported for reuse/testing.
export function isRemovalIntent(text: string): boolean {
  if (!text) return false;
  for (const token of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (token && REMOVAL_KEYWORDS.has(token)) return true;
  }
  return false;
}

// Is this message type one of the billable "human reached" signals (§4.1)?
// Single source for the type gate, reused by the per-row webhook processor.
export function isBillableMessageType(type: string | undefined | null): boolean {
  return !!type && BILLABLE_MESSAGE_TYPES.has(type);
}

// Classify ONE persisted inbound message into the two billing-relevant signals:
// whether it is a billable reach, and whether it carries an explicit opt-out.
// The raw text is matched here and discarded — only the booleans leave this
// module (PII-safe). This is the single inbound classifier (the worker's only
// path); there is no parallel batch classifier.
export function classifyMessagePayload(message: InboundMessagePayload): {
  billable: boolean;
  removal: boolean;
} {
  const billable = isBillableMessageType(message.type);
  const removal = billable ? isRemovalIntent(extractText(message)) : false;
  return { billable, removal };
}
