import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

import { getOperation, latestOperation, refundsOfRequest } from './ledger';
import type { PackagePaymentRecord } from './package-refund-types';

// The ledger facts shown next to a package's money: the purchase's document and THIS cancellation request's latest refund
// attempt. Read from the ledger, so the same for every clearing company; the refund itself is cardcom-refund.ts.
// THROWS when the ledger cannot be read.
export async function packagePaymentRecord(campaignId: string, cancellationRequestId?: string): Promise<PackagePaymentRecord> {
  const admin = createAdminClient();
  const [purchase, attempts] = await Promise.all([
    latestOperation(admin, campaignId, 'package_purchase', 'succeeded'),
    cancellationRequestId ? refundsOfRequest(admin, campaignId, cancellationRequestId) : Promise.resolve([]),
  ]);
  const purchaseOp = purchase ? await getOperation(admin, purchase.id) : null;
  // refundsOfRequest lists them oldest first.
  const last = attempts.at(-1) ?? null;
  return {
    purchaseDocument: purchaseOp?.document ?? null,
    lastRefundAttempt: last
      ? { outcome: last.outcome, providerStatus: last.providerStatus, providerStatusDescription: last.providerStatusDescription, recordedAt: last.recordedAt }
      : null,
  };
}
