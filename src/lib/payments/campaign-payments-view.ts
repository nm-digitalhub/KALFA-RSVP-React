import 'server-only';

import { unstable_rethrow } from 'next/navigation';

import { hasPlatformPermission } from '@/lib/auth/dal';
import { canAccessEvent } from '@/lib/data/events';
import { createAdminClient } from '@/lib/supabase/admin';

import { displayedOperations, staffDisplayedOperations, type DisplayedOperation, type StaffDisplayedOperation } from './ledger';
import { CUSTOMER_OUTCOMES } from './operation-labels';

// Which payments list a viewer of a campaign gets, decided on the server:
//   - staff (platform manage_billing): every operation, failed attempts included, with the provider's references. The
//     staff reader is called ONLY here, so those fields never reach a customer's page;
//   - a viewer of the event with billing:view (its owner, or an org member holding it — the gate the stats page puts on
//     money): the operations a customer is shown (CUSTOMER_OUTCOMES), no provider references;
//   - anyone else: nothing (null), and nothing is read.
// `operations: null` = the read failed; the list then says so instead of showing nothing. The CALLER has already
// authorized the viewer for this campaign (requireEventAccess / getCampaignForAdminView); this only narrows the money.
export type CampaignPaymentsView =
  | { audience: 'staff'; operations: StaffDisplayedOperation[] | null }
  | { audience: 'customer'; operations: DisplayedOperation[] | null };

export async function campaignPaymentsView(eventId: string, campaignId: string): Promise<CampaignPaymentsView | null> {
  if (await hasPlatformPermission('manage_billing')) {
    try {
      return { audience: 'staff', operations: await staffDisplayedOperations(createAdminClient(), campaignId) };
    } catch (err) {
      unstable_rethrow(err);
      return { audience: 'staff', operations: null };
    }
  }
  // Fail-closed: a denied OR an errored check hides the section.
  if (!(await canAccessEvent(eventId, 'billing', 'view'))) return null;
  try {
    return { audience: 'customer', operations: await displayedOperations(createAdminClient(), campaignId, CUSTOMER_OUTCOMES) };
  } catch (err) {
    unstable_rethrow(err);
    return { audience: 'customer', operations: null };
  }
}
