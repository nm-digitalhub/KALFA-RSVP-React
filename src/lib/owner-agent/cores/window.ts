// An explicit, CLOSED window for the range-bound fields of a core: the
// proactive report (reports/content.ts) asks "what happened between 00:00 and
// 08:00", which none of the three range literals can say.
//
// Optional on every core that takes it, and absent means exactly what the core
// did before: its fields start at rangeStartIso(range, nowMs) and stay open to
// now. When given, `sinceIso` replaces that start and every range-bound field
// also gets `< untilIso` (half-open [since, until), the same shape as
// owner_agent_billing_sums). Current-state fields ignore it, and so does a
// FORWARD window (events' activeUpcomingInWindow), which is about the future,
// not the period.
export interface CoreWindow {
  sinceIso: string;
  untilIso: string;
}

// `.lt(column, untilIso)` on a PostgREST filter chain when a window is given,
// the chain untouched when not — so the default query is byte-for-byte the one
// before windows existed (the core tests pin that through the recorded calls).
export function upTo<Q extends { lt(column: string, value: string): Q }>(
  query: Q,
  column: string,
  window: CoreWindow | undefined,
): Q {
  return window ? query.lt(column, window.untilIso) : query;
}
