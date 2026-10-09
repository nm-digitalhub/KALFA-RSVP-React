import { formatAmount } from '@/lib/format';
import { Constants, type Enums } from '@/lib/supabase/types';

import type { BadgeVariant, LedgerMoney } from './status';
import { TEST_MONEY_MARK } from './test-money-label';

// How an operation in the payment ledger ended, in Hebrew. The four outcomes are the database enum
// (payment_operation_outcome); the map is keyed by the generated type, so a fifth outcome fails type-checking here
// until it is given a label. The NAME of an operation is not here: it is the registry's label_he (ledger.ts).
export type OperationOutcomeValue = Enums<'payment_operation_outcome'>;

export const OPERATION_OUTCOME_LABELS: Record<OperationOutcomeValue, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'ממתין', variant: 'warning' },
  succeeded: { label: 'הצליח', variant: 'success' },
  failed: { label: 'נכשל', variant: 'destructive' },
  review: { label: 'בבדיקה', variant: 'warning' },
};

// What a customer is shown: everything except a failed attempt (owner 9.10.2026: they saw the decline when it happened;
// staff see every attempt). Derived from the enum, so an outcome added later is shown unless it is excluded here.
export const CUSTOMER_OUTCOMES: readonly OperationOutcomeValue[] = Constants.public.Enums.payment_operation_outcome.filter(
  (o) => o !== 'failed',
);

// A campaign's money in one line, from what the ledger recorded: what was paid, what went back, and whether something is
// still unresolved. Each part only when it holds something; an empty list means the ledger has nothing to say.
export function ledgerMoneyParts(m: LedgerMoney): string[] {
  const parts: string[] = [];
  if (m.paid > 0) parts.push(`סכום ששולם ${formatAmount(m.paid)}`);
  if (m.refunded > 0) parts.push(`סכום שהוחזר ${formatAmount(m.refunded)}`);
  if (m.inFlight) parts.push(OPERATION_OUTCOME_LABELS[m.inFlight].label);
  if (m.testMoney && parts.length > 0) parts.unshift(TEST_MONEY_MARK);
  return parts;
}
