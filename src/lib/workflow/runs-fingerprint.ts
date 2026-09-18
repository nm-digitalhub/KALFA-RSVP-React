import { createHash } from 'node:crypto';

// The shape of "has the runs list changed?", kept apart from the data layer.
//
// Its own module because `@/lib/data/admin/workflows` is `server-only` and a
// test cannot import it — the admin coverage suite reads that file as TEXT for
// exactly this reason. The rule here deserves real assertions rather than a
// regex, so the pure half lives where it can be called.

/**
 * How many runs the workflow page shows, and therefore how many the change
 * check has to cover.
 *
 * Shared on purpose: a fingerprint over a different window than the page
 * renders would either miss a change (too narrow) or refresh for a row nobody
 * can see (too wide).
 */
export const RUNS_WINDOW = 20;

/**
 * A short value that changes exactly when the runs table would look different.
 *
 * ⚠️ IT COVERS EVERY VISIBLE ROW, NOT JUST THE NEWEST. Taking only the latest
 * run would miss a parked run waking up behind a newer one — a `logic.wait` step
 * can leave a run non-terminal for days while later runs come and go. `id:status`
 * per row catches an insert, a status change, a deletion and a reorder alike.
 *
 * ⚠️ ORDER IS PART OF THE VALUE. Two runs swapping places is a visible change
 * even when the same ids and statuses are present, so the rows are joined in the
 * order they were selected rather than sorted into a canonical shape.
 *
 * Hashed rather than returned raw: the caller only ever compares it to the
 * previous value, and twenty UUIDs on every poll would be pointless traffic.
 */
export function runsFingerprint(
  rows: readonly { id: string; status: string }[],
): string {
  return createHash('sha1')
    .update(rows.map((row) => `${row.id}:${row.status}`).join(','))
    .digest('hex')
    .slice(0, 16);
}
