// One line for a thrown error, with the cause underneath it.
//
// Data-layer throws for a failed Supabase/Postgrest call attach the original
// error as `cause` (see e.g. claimUnprocessedWebhookEvents) so the generic
// Hebrew message shown to that layer's other callers doesn't erase the
// diagnostic code underneath. Surface that code here — it's a Postgres/
// PostgREST error code, never guest data — so an ops alert or a log line alone
// is enough to triage a recurrence without a live DB query. Used by the
// worker's alerts (worker/main.ts) and every Server Action's log
// (src/lib/safe-action.ts).
export function errorDetail(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown error';
  const cause = e.cause;
  if (cause && typeof cause === 'object' && 'message' in cause) {
    const rawCode =
      'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : '';
    // PostgrestError's own fields are always strings, but a fetch/network
    // failure surfaces the same {message,details,hint,code} shape with code
    // defaulted to '' — skip the brackets rather than print "[]".
    const code = rawCode.length > 0 ? rawCode : undefined;
    return `${e.message} — ${code ? `[${code}] ` : ''}${String((cause as { message: unknown }).message)}`;
  }
  return e.message;
}
