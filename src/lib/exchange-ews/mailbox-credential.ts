import 'server-only';

import { decryptCredential, type EncryptedCredential } from './crypto';
import { selectedCalendarProvider } from './provider-selection';

// The mailbox password for whichever calendar backend is ACTUALLY active.
//
// WHY THIS EXISTS — a real coupling, measured 2026-08-16, not a tidy-up.
//
// Four modules (callback-scheduling, event-exchange-sync,
// console-agent-calendar-presence, exchange-connections) each loaded the
// encrypted mailbox credential and decrypted it before every calendar call,
// and each one FAILS CLOSED when that decryption throws. That was correct
// while EWS was the backend: NTLM needs the password.
//
// Graph does not. It authenticates ONCE as the application with a certificate,
// and `graph-impl.ts` documents the fields as ignored ("`cfg.password` /
// `cfg.authMethod` are ignored here — deliberately"). So on the active path
// every sweep was decrypting a secret nothing consumed, and — the part that
// matters — a decrypt failure would abort a Graph operation that never needed
// the credential. In effect the certificate-authenticated calendar had a hard
// dependency on EXCHANGE_EWS_ENCRYPTION_KEY, which .env.example described as
// legacy and only needed for EWS. Rotating or dropping that key would have
// taken the calendar down for a reason with no relationship to the cause.
//
// Decrypting a credential is also not free of consequence: it puts a live
// mailbox password in process memory on every scheduled tick, for nothing.
//
// The empty string is returned rather than undefined so `ExchangeConnectionConfig`
// keeps its existing shape — the field is part of the shared provider interface
// and the Graph implementation never reads it.
export function resolveMailboxPassword(
  encrypted: EncryptedCredential,
  connectionId: string,
  subjectId: string,
): string {
  // Resolved per call, exactly like `active()` in calendar-provider.ts: a
  // process up for days must follow a changed EXCHANGE_PROVIDER on restart
  // without any path holding a stale decision.
  if (selectedCalendarProvider() !== 'ews') return '';

  // Still throws on failure when the credential IS required, so every caller's
  // existing fail-closed catch keeps behaving exactly as it does today.
  return decryptCredential(encrypted, connectionId, subjectId);
}
