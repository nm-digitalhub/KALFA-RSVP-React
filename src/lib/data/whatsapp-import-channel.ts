import 'server-only';

import { resolveNumberForRole } from '@/lib/data/provider-numbers-resolve';
import { waMeUrl } from '@/lib/whatsapp/channel-routing';

// Customer-facing, SECRET-FREE view of the dedicated guest-import number: the
// number as customers see it and its wa.me deep link.
//
// The secret-freedom is STRUCTURAL, not a discipline: this module reaches the
// number through resolveNumberForRole, which reads provider_numbers and selects
// three columns by name (e164, provider_ref, is_active). It never touches
// app_settings, so the access token and app secret have no path into a module
// that feeds a client component. Do not swap it for getWhatsAppChannel() — that
// one carries the token.
//
// FAIL-SAFE on purpose (resolveNumberForRole, not the strict twin): null means
// "no number to advertise" and the screen renders its legacy copy with no
// number and no link. A configuration hiccup must not 500 the guests page. That
// is the opposite of the routing path, where a null must never be guessed — see
// resolveNumberForRoleStrict for why the two readers differ.
//
// One half of the router's liveness predicate is deliberately not reproduced
// here: the router also treats "the RSVP number itself holds the import role"
// as legacy, which needs the token-bearing config to detect. It is harmless to
// advertise in that state — the number shown IS the RSVP number, and the legacy
// path stages lists sent there exactly as it does today.
export type WhatsAppImportChannel = {
  displayNumber: string;
  waMeUrl: string;
};

export async function getWhatsAppImportChannel(): Promise<WhatsAppImportChannel | null> {
  const number = await resolveNumberForRole('whatsapp_import_sender');
  // No Meta phone_number_id means nothing routes to this line, so there is
  // nothing to send customers to — the same judgement getWhatsAppChannel makes.
  if (!number?.providerRef) return null;

  const displayNumber = number.e164?.trim() ?? '';
  if (!displayNumber) return null;

  const url = waMeUrl(displayNumber);
  return url ? { displayNumber, waMeUrl: url } : null;
}
