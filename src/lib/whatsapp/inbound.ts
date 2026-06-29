// Pure classifier for an inbound WhatsApp webhook `value` object (no I/O). A
// HUMAN message (text/button/interactive/reaction with a real `from`) is the
// billable "reached" signal (§4.1). `statuses[]` (sent/delivered/read/failed)
// and system/unsupported messages are NOT billable — only op-status progress.
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

export type WhatsAppWebhookValue = {
  messages?: Array<{
    id?: string;
    from?: string;
    type?: string;
    text?: { body?: string };
    button?: { text?: string; payload?: string };
    interactive?: {
      button_reply?: { title?: string };
      list_reply?: { title?: string };
    };
  }>;
  statuses?: Array<{ id?: string; status?: string }>;
};

type InboundMessage = NonNullable<WhatsAppWebhookValue['messages']>[number];

export type InboundClassification = {
  billableMessages: Array<{
    providerId: string;
    from: string;
    removal: boolean;
  }>;
  statuses: Array<{ providerId: string; status: string }>;
};

// Pull the human-readable text from the message shapes that carry one (text
// body / template button label / interactive reply title). Internal — the text
// never leaves this module.
function extractText(m: InboundMessage): string {
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

export function classifyInbound(
  value: WhatsAppWebhookValue,
): InboundClassification {
  const billableMessages = (value.messages ?? [])
    .filter(
      (m) => !!m.id && !!m.from && !!m.type && BILLABLE_MESSAGE_TYPES.has(m.type),
    )
    .map((m) => ({
      providerId: m.id as string,
      from: m.from as string,
      removal: isRemovalIntent(extractText(m)),
    }));

  const statuses = (value.statuses ?? [])
    .filter((s) => !!s.id && !!s.status)
    .map((s) => ({ providerId: s.id as string, status: s.status as string }));

  return { billableMessages, statuses };
}
