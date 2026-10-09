// Payment status is DERIVED from the ledger (payment_operations joined with
// payment_operation_kinds.effect), never stored. The code never looks at a
// specific kind: a kind is a row in the registry, its effect is
// what matters here. Replay the succeeded operations in time order; ANY
// in-flight row (pending/review) wins over settled state because money may be
// moving right now.
export type OperationEffect = 'commit' | 'collect' | 'void' | 'return' | 'none';
export type OperationOutcome = 'pending' | 'succeeded' | 'failed' | 'review';
export type PaymentStatus = 'none' | 'pending' | 'review' | 'declined' | 'committed' | 'collected' | 'released' | 'refunded';
export type BadgeVariant = 'success' | 'warning' | 'destructive' | 'neutral';

export interface OperationRow {
  kind: string;
  effect: OperationEffect;
  outcome: OperationOutcome;
  amount: number;
  // What a collect settled from the customer's credit instead of the card (the negative lines of the operation, see
  // payment_operation_lines). Zero for every other effect and for an operation with no credit.
  credit: number;
  occurredAt: string;
  recordedAt: string;
  // True when the row was opened on a no-money (test) terminal. The DATABASE decides it, once, when the row is born
  // (payment_operations.is_test); nothing here ever derives it. Absent = false: a row written by older code, and every row
  // of another provider, is real money.
  isTest?: boolean;
}

export interface PaymentState {
  status: PaymentStatus;
  collected: number;
  // Credit applied by succeeded collects. Never netted by a return: a refund gives money back to the card, not credit.
  credit: number;
  committed: number;
  // Present (true) ONLY when the money that settled is all test money: at least one succeeded collect or return exists and
  // every one of them is a test row. Absent = false, so a state built without it - and all real money - reads as before.
  testMoney?: boolean;
}

// Replay in time order. occurredAt first; recordedAt breaks ties (a backfilled release whose real time is unknown
// is written 1s after its authorize). Any in-flight row (pending/review) wins over settled
// state because money may be moving right now.
export function deriveStatus(ops: readonly OperationRow[]): PaymentState {
  if (ops.length === 0) return { status: 'none', collected: 0, credit: 0, committed: 0 };
  const sorted = [...ops].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt));
  // ANY unresolved row decides: a release/refund written after an unresolved review must
  // not hide it. review beats pending (a person must act), pending beats every settled state.
  const inFlight = sorted.some((o) => o.outcome === 'review') ? 'review' : sorted.some((o) => o.outcome === 'pending') ? 'pending' : null;
  let status: PaymentStatus = 'none';
  let collected = 0;
  let credit = 0;
  let committed = 0;
  let everCollected = false;
  // The settled money, counted by class: the cancel rule and the staff labels need to know whether ANY of it is real.
  let settledMoneyRows = 0;
  let settledTestRows = 0;
  for (const o of sorted) {
    if (o.outcome !== 'succeeded' || o.effect === 'none') continue;
    if (o.effect === 'collect' || o.effect === 'return') {
      settledMoneyRows += 1;
      if (o.isTest) settledTestRows += 1;
    }
    // "committed" is informational (what the customer approved), never netted by a later void/return, and nothing
    // in the system caps billing on it: the final charge is a fresh charge on the saved token, and the recipient
    // set is bounded by the list, not by an amount.
    if (o.effect === 'commit') { committed = o.amount; if (!everCollected) status = 'committed'; }
    if (o.effect === 'collect') { collected += o.amount; credit += o.credit; everCollected = true; status = 'collected'; }
    // void = the guarantee ended, no money moved: only matters if nothing was ever collected.
    if (o.effect === 'void' && !everCollected) status = 'released';
    if (o.effect === 'return') { collected = Math.max(0, collected - o.amount); status = collected > 0 ? 'collected' : 'refunded'; }
  }
  // Only ever added when true, so every state of real money keeps exactly the shape it always had.
  const testMoney = settledMoneyRows > 0 && settledTestRows === settledMoneyRows ? { testMoney: true } : {};
  if (inFlight) return { status: inFlight, collected, credit, committed, ...testMoney };
  // A declined final charge on a live hold must not read as "אושר — ממתין לגבייה": today that state is "החיוב נכשל"
  // (admin/campaigns/page.tsx:25) and the owner agent counts it (cores/billing.ts:136). The latest collect decides.
  const lastCollect = [...sorted].reverse().find((o) => o.effect === 'collect');
  if (status === 'committed' && lastCollect?.outcome === 'failed') return { status: 'declined', collected, credit, committed, ...testMoney };
  // Nothing with a money effect succeeded. If something was ATTEMPTED (a failed commit/collect) → declined; if the
  // only rows are informational (effect 'none' — no such kind today) → none, not declined.
  if (status === 'none') {
    const attempted = sorted.some((o) => o.effect !== 'none');
    return { status: attempted ? 'declined' : 'none', collected, credit, committed, ...testMoney };
  }
  return { status, collected, credit, committed, ...testMoney };
}

// How much can still go back to the card: what the card actually paid (a collect's `amount` — the part settled from
// credit never reached it) minus every return that has not FAILED. A refund that is still pending or in review may
// already have moved the money, so it counts as given back until a person says otherwise. Never negative; whole agorot.
export function refundableAmount(ops: readonly OperationRow[]): number {
  return Math.max(0, refundableCents(ops)) / 100;
}

// The same sum in agorot and NOT floored at zero: negative means more is being returned than was ever collected. A
// refund that has already taken its own pending row uses this to check it did not overdraw (see package-refund.ts).
export function refundableCents(ops: readonly OperationRow[]): number {
  let cents = 0;
  for (const o of ops) {
    if (o.effect === 'collect' && o.outcome === 'succeeded') cents += Math.round(o.amount * 100);
    if (o.effect === 'return' && o.outcome !== 'failed') cents -= Math.round(o.amount * 100);
  }
  return cents;
}

// What a screen says about a campaign's money: what the card paid and what went back, each counted from SUCCEEDED rows
// only and never netted against the other (deriveStatus().collected is net; refundableCents counts an unresolved refund as
// gone). Decided by each kind's `effect`, never by its name, so a kind added to the registry is counted without a code
// change. `inFlight` names the unresolved outcome when some row is still pending or in review (review wins: a person must
// act): the sums may still change. `testMoney` follows deriveStatus: every settled collect/return is a no-money (test
// terminal) row.
export interface LedgerMoney {
  paid: number;
  refunded: number;
  inFlight: 'review' | 'pending' | null;
  testMoney: boolean;
}

export function ledgerMoney(ops: readonly Pick<OperationRow, 'effect' | 'outcome' | 'amount' | 'isTest'>[]): LedgerMoney {
  let paidCents = 0;
  let refundedCents = 0;
  let settled = 0;
  let settledTest = 0;
  let review = false;
  let pending = false;
  for (const o of ops) {
    if (o.outcome === 'review') review = true;
    if (o.outcome === 'pending') pending = true;
    if (o.outcome !== 'succeeded' || (o.effect !== 'collect' && o.effect !== 'return')) continue;
    settled += 1;
    if (o.isTest) settledTest += 1;
    if (o.effect === 'collect') paidCents += Math.round(o.amount * 100);
    else refundedCents += Math.round(o.amount * 100);
  }
  const inFlight = review ? 'review' : pending ? 'pending' : null;
  return { paid: paidCents / 100, refunded: refundedCents / 100, inFlight, testMoney: settled > 0 && settledTest === settled };
}

const LABELS: Record<Exclude<PaymentStatus, 'none'>, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'בתהליך', variant: 'warning' },
  review: { label: 'נדרשת בדיקה ידנית', variant: 'destructive' },
  declined: { label: 'נדחה', variant: 'destructive' },
  committed: { label: 'אושר — ממתין לגבייה', variant: 'success' },
  collected: { label: 'נגבה', variant: 'neutral' },
  released: { label: 'שוחרר ללא גבייה', variant: 'neutral' },
  refunded: { label: 'הוחזר', variant: 'neutral' },
};

export function paymentBadge(state: PaymentState): { label: string; variant: BadgeVariant } | null {
  if (state.status === 'none') return null;
  if (state.status === 'collected' && state.collected === 0) {
    // Nothing reached the card: either the whole price was settled from credit, or there was nothing to charge.
    return { label: state.credit > 0 ? 'שולם מיתרת זיכוי' : 'נסגר ללא חיוב', variant: 'neutral' };
  }
  return LABELS[state.status];
}
