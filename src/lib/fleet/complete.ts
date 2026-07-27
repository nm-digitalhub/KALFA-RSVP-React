// Completion-answer construction for the fleet CLI `complete` verb (the
// pending/verdict -> completed edges added in migration 20260727000620).
//
// Two invariants come from the DB layer and are enforced here up front so the
// CLI fails with a clear message instead of a trigger/CHECK error:
//   - fleet_requests_answer_len: answer <= 2000 chars.
//   - fleet_requests_guard: on verdict -> completed the existing answer must
//     remain a verbatim PREFIX (completion appends, never rewrites).

export const ANSWER_MAX = 2000;
const STAMP_PREFIX = '[הושלם] ';
const ELLIPSIS = '…';
const MIN_SUMMARY = 20;

// Appends "[הושלם] <summary>" to the existing answer (or starts one). When the
// combined text would exceed the DB cap, the SUMMARY tail is truncated (the
// existing verdict text is untouchable); a summary that cannot keep at least
// MIN_SUMMARY meaningful chars throws instead of silently degrading.
export function buildCompletionAnswer(existing: string | null, summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) throw new Error('completion summary must not be empty');

  const head = existing ? `${existing}\n\n` : '';
  const budget = ANSWER_MAX - head.length - STAMP_PREFIX.length;
  if (budget < MIN_SUMMARY) {
    throw new Error(
      `answer field is too full to append a completion note (${budget} chars left)`,
    );
  }
  const fitted =
    trimmed.length <= budget ? trimmed : `${trimmed.slice(0, budget - 1)}${ELLIPSIS}`;
  return `${head}${STAMP_PREFIX}${fitted}`;
}

// Statuses the `complete` verb may act on. 'denied' is deliberately excluded —
// completing denied work is a contradiction; file a new request instead.
export const COMPLETABLE_STATUSES = ['pending', 'approved', 'answered'] as const;

export function isCompletableStatus(status: string): boolean {
  return (COMPLETABLE_STATUSES as readonly string[]).includes(status);
}
