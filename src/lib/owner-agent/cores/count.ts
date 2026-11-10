// The count of a head-only PostgREST query, shared by every core. Errors THROW
// with the caller's bare code: a failed count must not reach the owner as a
// confident 0.
export function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}
