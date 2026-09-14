import { normalizePhone } from '@/lib/phone';

// Pure routing rules for the two-number WhatsApp setup (the RSVP outreach
// number vs. the dedicated guest-import number). No I/O, no `server-only`:
// imported by the worker path (webhook-processing / whatsapp-import) AND by
// admin/customer server code, and unit-tested directly.
//
// Both numbers share one Meta app, one WABA, one token and one app secret —
// the ONLY thing that differs is the phone_number_id a message arrived at
// (webhook_inbox.phone_number_id) or is sent from (/{phone_number_id}/messages).

export type WhatsAppSender = {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string | null;
};

export type ChannelNumbers = {
  phoneNumberId: string; // the RSVP outreach number
  importPhoneNumberId: string | null; // null = split not configured (legacy)
};

export type InboundChannel = 'import' | 'rsvp' | 'unknown';

// Which path an inbound row belongs to. Legacy (no import number, or no config
// at all) is deliberately 'rsvp' for EVERY phone_number_id — exactly today's
// behaviour — so deploying this before the owner assigns the
// `whatsapp_import_sender` role changes nothing. Once the import number is
// resolved: the import number → import only; the RSVP number (or a row without
// metadata) → RSVP; anything else → unknown (ignored + alerted by the caller,
// never billed).
//
// ⚠️ The caller must not hand this a `numbers` whose importPhoneNumberId was
// defaulted to null by a FAILED lookup. 'rsvp' is the billing path, so a
// fail-safe null here is a fail-OPEN null: it would bill import traffic. See
// resolveImportSenderStrict in provider-numbers-resolve.ts — the router's
// source throws on a read error rather than answering null.
export function classifyInboundChannel(
  rowPhoneNumberId: string | null,
  numbers: ChannelNumbers | null,
): InboundChannel {
  if (!numbers?.importPhoneNumberId) return 'rsvp';
  if (rowPhoneNumberId === numbers.importPhoneNumberId) return 'import';
  if (rowPhoneNumberId === null || rowPhoneNumberId === numbers.phoneNumberId) {
    return 'rsvp';
  }
  return 'unknown';
}

// The sender to use for import replies.
//
// ⚠️ THE NUMBER THAT RECEIVED THE LIST ANSWERS IT. `arrivedOn` wins over every
// configured value, and that ordering is the whole fix.
//
// MEASURED ON A LIVE LIST, 2026-09-13. An owner sent contact cards to a third
// business number — one holding no role at all — and never got the review link.
// Staging worked; the reply did not. This function returned
// `importPhoneNumberId ?? phoneNumberId`, so with the role unassigned it
// answered from the RSVP number: a number the owner had never messaged, with no
// open 24-hour window, so Meta refused the free-form text. `safeReply` discards
// the outcome ("best-effort"), so nothing surfaced anywhere.
//
// The old shape also created a requirement nobody should have to meet: pinning a
// workflow trigger to a number expressed the intent perfectly well, and the
// system still needed a SEPARATE account-wide role assignment before it would
// answer. Auto-assigning that role from a workflow would be worse — one
// automation silently repurposing a number for every other flow. Following the
// receiving number removes the requirement instead of automating it.
//
// `arrivedOn` is `webhook_inbox.phone_number_id`. `null` means an older row
// written before that column was populated, and the configured numbers are then
// the only thing to fall back to.
//
// Same token and secret either way — one Meta app, one WABA (see the header).
export function importSender(
  config: WhatsAppSender & { importPhoneNumberId: string | null },
  arrivedOn?: string | null,
): WhatsAppSender {
  return {
    phoneNumberId: arrivedOn ?? config.importPhoneNumberId ?? config.phoneNumberId,
    accessToken: config.accessToken,
    appSecret: config.appSecret,
  };
}

// wa.me deep link for the import number as customers see it. Goes through the
// product's one phone normalizer (E.164, IL default) so "03-330-1505",
// "+972 3-330-1505" and the stored "+97233301505" all produce the same link;
// null when it does not normalize, so callers omit the link rather than render
// a broken one.
export function waMeUrl(displayNumber: string): string | null {
  const e164 = normalizePhone(displayNumber);
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}
