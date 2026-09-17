import { IntegrationRuntimeError } from '../errors';
import type { Capability, ProviderRequest } from '../provider';

export const MICROSOFT_GRAPH_ORIGIN = 'https://graph.microsoft.com';

/**
 * The wire shape a node hands this transport.
 *
 * ⚠️ `to` IS ONE ADDRESS; `cc`, `bcc` AND `replyTo` ARE LISTS — one string each,
 * separated by `,` or `;`. Widening the primary recipient is a separate change
 * with its own contract, so it is deliberately not done here (2026-09-17).
 *
 * Every option below is optional and every default is GRAPH'S OWN, which is what
 * makes this backward compatible by construction: a node saved before these
 * fields existed sends the same bytes it always did.
 */
export type MicrosoftSendMailInput = {
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  body: string;
  contentType?: 'Text' | 'HTML';
  importance?: 'low' | 'normal' | 'high';
  saveToSentItems?: boolean;
};

/** `MicrosoftSendMailInput` after parsing — address strings became address lists. */
type ParsedSendMail = {
  to: string;
  cc: string[];
  bcc: string[];
  replyTo: string[];
  subject: string;
  body: string;
  contentType: 'Text' | 'HTML';
  importance: 'low' | 'normal' | 'high';
  saveToSentItems: boolean;
};

export function microsoftGraphRequest(
  capability: Capability,
  input: unknown,
): ProviderRequest {
  if (capability !== 'mail.send') {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_capability_unsupported',
      `Microsoft Graph operation "${capability}" is not implemented.`,
    );
  }

  const mail = readSendMailInput(input);
  return {
    url: new URL('/v1.0/me/sendMail', MICROSOFT_GRAPH_ORIGIN),
    init: {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          importance: mail.importance,
          body: {
            contentType: mail.contentType,
            content: mail.body,
          },
          toRecipients: [{ emailAddress: { address: mail.to } }],
          // Omitted entirely when empty. Graph treats `ccRecipients: []` as a
          // valid empty list, but sending the key at all says something the
          // node never asked for.
          ...(mail.cc.length > 0 ? { ccRecipients: toRecipients(mail.cc) } : {}),
          ...(mail.bcc.length > 0 ? { bccRecipients: toRecipients(mail.bcc) } : {}),
          ...(mail.replyTo.length > 0 ? { replyTo: toRecipients(mail.replyTo) } : {}),
        },
        saveToSentItems: mail.saveToSentItems,
      }),
    },
  };
}

function readSendMailInput(input: unknown): ParsedSendMail {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalidInput();
  }

  const record = input as Record<string, unknown>;
  const to = typeof record.to === 'string' ? record.to.trim() : '';
  const cc = parseAddresses(record.cc);
  const bcc = parseAddresses(record.bcc);
  const replyTo = parseAddresses(record.replyTo);
  const subject = typeof record.subject === 'string' ? record.subject.trim() : '';
  const body = typeof record.body === 'string' ? record.body : '';
  const contentType = record.contentType === 'HTML' ? 'HTML' : 'Text';
  const importance =
    record.importance === 'high' || record.importance === 'low' ? record.importance : 'normal';
  const saveToSentItems =
    typeof record.saveToSentItems === 'boolean' ? record.saveToSentItems : true;

  // ⚠️ `to` IS SHAPE-CHECKED HERE AND WAS NOT BEFORE. Until now a malformed
  // recipient travelled to Graph and came back as a 400 the owner had to read
  // through a run log. This is the last point at which the value is final —
  // templates resolved before the handler ran — so it is the right place to
  // refuse, and the refusal is permanent: a retry cannot fix a typo.
  if (!to || !looksLikeEmail(to) || !subject || !body.trim()) throw invalidInput();

  return { to, cc, bcc, replyTo, subject, body, contentType, importance, saveToSentItems };
}

/**
 * One string of addresses to a list, refusing anything that is not one.
 *
 * Splits on `,` and `;` — neither may appear in a legal address, so a field that
 * held exactly one address still parses to exactly that one address.
 *
 * Deduplicated, because Graph will happily deliver twice to the same person.
 * Absent or empty is an EMPTY LIST, never an error: the whole point of these
 * fields is that they are optional.
 */
function parseAddresses(value: unknown): string[] {
  if (typeof value !== 'string') return [];

  const unique = [...new Set(value.split(/[;,]/).map((item) => item.trim()).filter(Boolean))];
  for (const address of unique) {
    if (!looksLikeEmail(address)) throw invalidInput();
  }
  return unique;
}

/**
 * A shape check, NOT an RFC 5322 parser, and the distinction is deliberate.
 *
 * A full grammar would reject deliverable addresses that Graph accepts, and this
 * layer is not the authority on what Microsoft will deliver — Graph is. What it
 * catches is the class of mistake worth catching before a network round trip:
 * something with no `@`, with several, with nothing after it, or with a space.
 */
function looksLikeEmail(value: string): boolean {
  if (value.length > 320 || /\s/.test(value)) return false;

  const at = value.indexOf('@');
  return at > 0 && at === value.lastIndexOf('@') && at < value.length - 1;
}

function toRecipients(addresses: readonly string[]) {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

function invalidInput(): IntegrationRuntimeError {
  return new IntegrationRuntimeError(
    'permanent',
    'integration_input_invalid',
    'Microsoft mail.send requires a valid recipient, a subject and a body.',
  );
}
