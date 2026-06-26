// Pure classifier for an inbound WhatsApp webhook `value` object (no I/O). A
// HUMAN message (text/button/interactive/reaction with a real `from`) is the
// billable "reached" signal (§4.1). `statuses[]` (sent/delivered/read/failed)
// and system/unsupported messages are NOT billable — only op-status progress.

const BILLABLE_MESSAGE_TYPES = new Set([
  'text',
  'button',
  'interactive',
  'reaction',
]);

export type WhatsAppWebhookValue = {
  messages?: Array<{ id?: string; from?: string; type?: string }>;
  statuses?: Array<{ id?: string; status?: string }>;
};

export type InboundClassification = {
  billableMessages: Array<{ providerId: string; from: string }>;
  statuses: Array<{ providerId: string; status: string }>;
};

export function classifyInbound(
  value: WhatsAppWebhookValue,
): InboundClassification {
  const billableMessages = (value.messages ?? [])
    .filter(
      (m) => !!m.id && !!m.from && !!m.type && BILLABLE_MESSAGE_TYPES.has(m.type),
    )
    .map((m) => ({ providerId: m.id as string, from: m.from as string }));

  const statuses = (value.statuses ?? [])
    .filter((s) => !!s.id && !!s.status)
    .map((s) => ({ providerId: s.id as string, status: s.status as string }));

  return { billableMessages, statuses };
}
