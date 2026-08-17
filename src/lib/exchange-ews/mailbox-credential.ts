import 'server-only';

// The mailbox password for the active calendar backend — which is now always
// the empty string, because no backend has one.
//
// HISTORY, because the shape looks pointless without it. Four modules loaded the
// encrypted mailbox credential and decrypted it before every calendar call, each
// failing closed when that threw. Correct under EWS: NTLM needs the password.
// Graph does not — it authenticates once as the application with a certificate.
// So the certificate-authenticated calendar had a hard dependency on
// EXCHANGE_EWS_ENCRYPTION_KEY, and rotating that key would have taken scheduling
// down for a reason with no relationship to the cause. That was fixed by making
// the decryption conditional; with EWS now removed, the condition is always
// false and the decryption is gone entirely.
//
// The function survives rather than being inlined so the four call sites keep a
// single, named answer to "what password does this connection use" — and so that
// answer is documented in one place instead of four empty strings.
//
// `ExchangeConnectionConfig.password` remains part of the shared provider
// interface; graph-impl.ts states outright that it ignores the field.
export function resolveMailboxPassword(): string {
  return '';
}
