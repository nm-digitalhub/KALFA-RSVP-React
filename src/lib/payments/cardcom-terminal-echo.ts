// What CardCom says about the terminal a payment went through, and what to do about it. Pure: no database, no CardCom call, no
// configuration. The caller hands over the facts, so every row of the decision table is a one-line test.
//
// Why it exists (docs/superpowers/plans/2026-10-08-test-money-terminal-stamp-plan.md, section 2). Every CardCom payment row is
// stamped, when it is born, with the terminal the session was ASKED to open on (`provider_terminal`). CardCom's answer to
// GetLpResult names the terminal at its top level (`TerminalNumber`; measured on the first real payment, 7.10.2026 - it is not in
// `TranzactionInfo`). Comparing the two is the cheap proof that the money went where we asked: a payment on the no-money test
// terminal must come back naming that terminal, and a payment on a real terminal must never come back naming another.
//
// It decides ONLY whether the answer may be believed as it stands. It never turns a payment into "failed": a payment CardCom
// confirmed whose terminal does not fit is parked for a person (review), because the money may exist.

// The column that holds the report (payment_operations.provider_terminal_echo) is a 32-bit integer, and CardCom types TerminalNumber as
// int32: a bigger number cannot be recorded, and a report that cannot be recorded must never be what keeps a CONFIRMED payment from
// being recorded. So it counts as "not reported".
const LARGEST_TERMINAL = 2_147_483_647;

/**
 * The terminal CardCom named, or null when it named none we can use. A positive whole NUMBER that fits the column only: a string,
 * zero, a negative, a fraction, a number beyond 32 bits or anything else counts as "not reported". Being strict errs toward asking a
 * person, never toward counting: a payment on the test terminal that does not report its terminal goes to review (checkTerminalEcho).
 */
export function terminalEchoFromCardcom(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= LARGEST_TERMINAL ? value : null;
}

export type TerminalEchoVerdict =
  | { verdict: 'accept' }
  | { verdict: 'review'; reason: 'echo_missing' | 'echo_differs' };

export type TerminalEchoInput = {
  /** The terminal the row was opened on (`provider_terminal`); null = a row written before the stamp existed. */
  stamp: number | null;
  /** The terminal CardCom reported (terminalEchoFromCardcom), or null when it reported none we can use. */
  echo: number | null;
  /** The row's class (`is_test`), decided by the database from the stamp when the row was born. */
  isTestTerminal: boolean;
};

//   stamp            CardCom reported      result
//   none (old row)   anything              accept   (as before: nothing to compare)
//   test terminal    the same number       accept
//   test terminal    nothing usable        review   (a test payment must prove where it went)
//   test terminal    another number        review
//   real terminal    nothing usable        accept   (as before)
//   real terminal    the same number       accept
//   real terminal    another number        review
export function checkTerminalEcho({ stamp, echo, isTestTerminal }: TerminalEchoInput): TerminalEchoVerdict {
  if (stamp === null || echo === stamp) return { verdict: 'accept' };
  if (echo !== null) return { verdict: 'review', reason: 'echo_differs' };
  return isTestTerminal ? { verdict: 'review', reason: 'echo_missing' } : { verdict: 'accept' };
}

/** Do two KNOWN terminals disagree? Unknown on either side is no conflict: there is nothing to compare. */
export function terminalsConflict(opened: number | null, reported: number | null): boolean {
  return opened !== null && reported !== null && opened !== reported;
}
