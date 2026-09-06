// Pure readers over a persisted webhook_inbox payload for the admin inspector.
// No I/O, no PII logging — the caller decides what to render and how to mask.
//
// Identity: with Meta's usernames/BSUID rollout an inbound message may carry
// NO phone at all (`from` omitted) and identify the user only by
// `from_user_id` (business-scoped user id) plus the `contacts[0]` block the
// route now persists as `sender_contact` / `recipient_contact` (profile name,
// username, wa_id, user_id, parent_user_id). The inspector must show whatever
// identifier exists and say explicitly when the phone was not shared.

export interface WebhookIdentity {
  role: 'sender' | 'recipient';
  phone: string | null;
  phoneMissing: boolean;
  bsuid: string | null;
  parentBsuid: string | null;
  profileName: string | null;
  username: string | null;
}

export interface WebhookContentSummary {
  type: string | null;
  text: string | null;
  replyId: string | null;
  replyTitle: string | null;
  fileName: string | null;
  contactCount: number | null;
  systemBody: string | null;
}

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function extractWebhookIdentity(
  eventKind: string,
  payload: unknown,
): WebhookIdentity | null {
  const p = dict(payload);
  if (!p) return null;
  if (eventKind !== 'message' && eventKind !== 'status') return null;

  const role: WebhookIdentity['role'] = eventKind === 'message' ? 'sender' : 'recipient';
  const contact = dict(eventKind === 'message' ? p.sender_contact : p.recipient_contact);
  const profile = contact ? dict(contact.profile) : null;

  const phone =
    (eventKind === 'message' ? str(p.from) : str(p.recipient_id)) ??
    (contact ? str(contact.wa_id) : null);
  const bsuid =
    (eventKind === 'message' ? str(p.from_user_id) : str(p.recipient_user_id)) ??
    (contact ? str(contact.user_id) : null);
  const parentBsuid =
    (eventKind === 'message'
      ? str(p.from_parent_user_id)
      : str(p.recipient_parent_user_id)) ?? (contact ? str(contact.parent_user_id) : null);

  return {
    role,
    phone,
    phoneMissing: phone === null,
    bsuid,
    parentBsuid,
    profileName: profile ? str(profile.name) : null,
    username: profile ? str(profile.username) : null,
  };
}

// What the message carried, decoded to the one line an admin needs — the
// typed text, the button/list id a guest tapped, the CSV name, the number of
// shared contact cards — without re-implementing any business rule.
export function summarizeWebhookContent(payload: unknown): WebhookContentSummary {
  const p = dict(payload) ?? {};
  const type = str(p.type);
  const text = dict(p.text);
  const button = dict(p.button);
  const interactive = dict(p.interactive);
  const buttonReply = interactive ? dict(interactive.button_reply) : null;
  const listReply = interactive ? dict(interactive.list_reply) : null;
  const document = dict(p.document);
  const system = dict(p.system);
  const contacts = Array.isArray(p.contacts) ? p.contacts : null;

  return {
    type,
    text: text ? str(text.body) : null,
    replyId:
      (button ? str(button.payload) : null) ??
      (buttonReply ? str(buttonReply.id) : null) ??
      (listReply ? str(listReply.id) : null),
    replyTitle:
      (button ? str(button.text) : null) ??
      (buttonReply ? str(buttonReply.title) : null) ??
      (listReply ? str(listReply.title) : null),
    fileName: document ? str(document.filename) : null,
    contactCount: type === 'contacts' && contacts ? contacts.length : null,
    systemBody: system ? str(system.body) : null,
  };
}
