import 'server-only';

// The mailbox password for the active calendar backend — always the empty
// string, because no backend has one: Graph authenticates once as the
// application with a certificate, so the calendar has no dependency on the
// stored mailbox credential or on EXCHANGE_EWS_ENCRYPTION_KEY.
//
// The function exists rather than being inlined so the four call sites (each
// failing closed if it throws) keep a single, named answer to "what password
// does this connection use" — and so that answer is documented in one place
// instead of four empty strings.
//
// `ExchangeConnectionConfig.password` remains part of the shared provider
// interface; graph-impl.ts states outright that it ignores the field.
export function resolveMailboxPassword(): string {
  return '';
}
