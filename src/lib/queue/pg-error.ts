// Tells apart the failures a database connection through the Supabase pooler can
// hand to pg-boss's `error` event. They have different causes and different
// remedies, so an alert that says only "pg-boss error" (what the worker sent
// until now) cannot be acted on:
//
//   connect_timeout    a NEW connection did not finish (TCP, TLS or startup)
//                      within `connectionTimeoutMillis`, or Node's own
//                      `connect ETIMEDOUT`. Nothing was on the wire yet.
//   pool_wait_timeout  every pooled connection was busy and none came free within
//                      `connectionTimeoutMillis` (pg-pool: "timeout exceeded when
//                      trying to connect"). The pool, not the network, is short.
//   read_etimedout     an ESTABLISHED connection died: the kernel gave up
//                      retransmitting (errno -110, syscall `read`), typically
//                      ~15 minutes after the path went silent.
//   econnreset         the other end (pooler, or something between) reset an
//                      established connection.
//   emaxconnsession   the pooler refused a new session: the role's session-mode
//                      slots are all taken (see src/lib/queue/session-slots.test.ts).
//   other              anything else.
//
// Pure: no I/O, no pg-boss import, safe in the worker bundle and in Next.

export type PgErrorClass =
  | 'connect_timeout'
  | 'pool_wait_timeout'
  | 'read_etimedout'
  | 'econnreset'
  | 'emaxconnsession'
  | 'other';

export type PgErrorInfo = {
  class: PgErrorClass;
  /** Node/pg `code` (ETIMEDOUT, ECONNRESET, a SQLSTATE …), when the error has one. */
  code?: string;
  /** Node `syscall` (read, connect …), when the error has one. */
  syscall?: string;
  /** The pg-boss queue named in a worker's poll error "(Queue: <name>, Worker: <id>)". */
  queue?: string;
};

const stringProp = (err: object, key: string): string | undefined => {
  const value = (err as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
};

// Queue names are internal identifiers (kebab-case), never data.
const QUEUE_IN_MESSAGE = /\(Queue: ([a-z0-9_:-]{1,80})[,)]/i;

export function describePgError(err: unknown): PgErrorInfo {
  if (typeof err !== 'object' || err === null) return { class: 'other' };

  const message = err instanceof Error ? err.message : (stringProp(err, 'message') ?? '');
  const code = stringProp(err, 'code');
  const syscall = stringProp(err, 'syscall');
  const queue = QUEUE_IN_MESSAGE.exec(message)?.[1];

  let cls: PgErrorClass = 'other';
  if (message.includes('EMAXCONNSESSION')) cls = 'emaxconnsession';
  else if (message.includes('Connection terminated due to connection timeout')) cls = 'connect_timeout';
  else if (message.includes('timeout exceeded when trying to connect')) cls = 'pool_wait_timeout';
  else if (code === 'ETIMEDOUT') cls = syscall === 'connect' ? 'connect_timeout' : 'read_etimedout';
  else if (code === 'ECONNRESET') cls = 'econnreset';

  return { class: cls, ...(code && { code }), ...(syscall && { syscall }), ...(queue && { queue }) };
}

export function classifyPgError(err: unknown): PgErrorClass {
  return describePgError(err).class;
}

/** One sentence per class: what it means, so the alert can be read without this file. */
export const PG_ERROR_MEANING: Record<PgErrorClass, string> = {
  connect_timeout: 'A new database connection did not complete within the connect timeout (TCP, TLS or startup stalled).',
  pool_wait_timeout: 'A call waited longer than the connect timeout for a free pooled connection.',
  read_etimedout: 'An established database connection died: the kernel gave up retransmitting (errno -110).',
  econnreset: 'An established database connection was reset by the pooler or the network.',
  emaxconnsession: "The pooler refused a new session: the role's session-mode slots are all taken.",
  other: 'Unclassified database error (the full message is in the process log).',
};
