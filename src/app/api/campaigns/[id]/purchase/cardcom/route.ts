import type { NextRequest } from 'next/server';

import { hasPlatformPermission } from '@/lib/auth/dal';
import { isPastEventDay } from '@/lib/data/event-date';
import { getProfile } from '@/lib/data/profiles';
import { startCardcomPurchase, type CardcomStartOutcome } from '@/lib/payments/cardcom-purchase';
import { guardCampaignRoute, noStoreJson } from '@/lib/payments/cardcom-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Opens a CardCom Open Fields session for the package purchase (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// 4.3). The buyer's browser calls it with fetch from the payment page; the answer is JSON and carries only the
// LowProfileId the Open Fields form needs — never a URL, a credential or the price.
//
// The route is the HTTP shell: origin, session and ownership (guardCampaignRoute), the event's state, and the payer from
// the SESSION. Everything that decides whether a session opens — the gates, the price, the ledger lock, CardCom — is in
// startCardcomPurchase. The browser sends nothing that matters: the price is the campaign's own, read here on the server.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;

  const guard = await guardCampaignRoute(request, campaignId);
  if (!guard.ok) return guard.response;
  const { user, campaign, event } = guard;

  // No payment for a past event (Israel calendar), and every commercial action needs an active event (R9). The same two
  // rules as the SUMIT purchase route; the database trigger is the REST-proof authority for the campaign side of them.
  if (isPastEventDay(event.event_date)) return noStoreJson({ status: 'event_past' }, 409);
  if (event.status !== 'active') return noStoreJson({ status: 'event_not_active' }, 409);

  // Cardholder name for the receipt — the same fallback chain as the SUMIT purchase and the signed agreement.
  const profile = await getProfile();
  const name = profile?.full_name?.trim() || user.email || 'לקוח KALFA';

  let outcome: CardcomStartOutcome;
  try {
    outcome = await startCardcomPurchase({
      campaign,
      payer: { userId: user.id, email: user.email ?? '', name },
      // Only someone who may configure the integration may buy on CardCom's test terminal; decided from the session.
      mayUseTestTerminal: await hasPlatformPermission('integrations.manage'),
    });
  } catch (err) {
    // startCardcomPurchase reports every failure as an outcome; a throw here is a bug. Logged server-side only, without the
    // text (it can carry a query or a credential); the buyer sees a generic answer and a retry is safe (the ledger refuses a second charge).
    console.error('[cardcom-purchase] unexpected failure', { campaignId, kind: err instanceof Error ? err.name : typeof err });
    outcome = { status: 'error' };
  }
  return noStoreJson(outcome);
}
