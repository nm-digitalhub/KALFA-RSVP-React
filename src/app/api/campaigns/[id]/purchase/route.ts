import { type NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { getCampaignForPurchase } from '@/lib/data/campaigns';
import { getProfile } from '@/lib/data/profiles';
import { activateAfterPayment } from '@/lib/payments/activate-after-payment';
import { purchasePackage, type PurchaseOutcome } from '@/lib/payments/package-purchase';
import { PURCHASE_ERROR, type PurchaseErrorCode } from '@/lib/payments/package-purchase-errors';
import { purchasePackageSchema } from '@/lib/validation/campaigns';
import { isAllowedOrigin } from '@/lib/http/allowed-origin';

// Fixed-price package purchase: ONE real charge for the whole package, with the single-use token SUMIT's own form
// produced. The route is the HTTP shell — origin, session, ownership, the event's state, the token — and hands
// everything that decides whether money moves to purchasePackage (src/lib/payments/package-purchase.ts), which holds
// the gates, the ledger lock and the charge. Mirrors the hold route (../authorize/route.ts).
//
// The browser submits ONLY the card token. The price charged is the campaign's own `package_price`, read here on the
// server; a price, a campaign id or any other field in the form is ignored.

// Both a fresh payment and one that was already recorded land on the same "paid" page: a second click, or a page
// reload after the redirect, must show the receipt state — not an error.
const OUTCOME_TO_ERROR: Record<Exclude<PurchaseOutcome, 'paid' | 'already_paid'>, PurchaseErrorCode> = {
  in_progress: PURCHASE_ERROR.IN_PROGRESS,
  review: PURCHASE_ERROR.REVIEW,
  declined: PURCHASE_ERROR.DECLINED,
  disabled: PURCHASE_ERROR.DISABLED,
  not_purchasable: PURCHASE_ERROR.BAD_STATE,
  credit_unsupported: PURCHASE_ERROR.CREDIT,
  error: PURCHASE_ERROR.FAILED,
};

function r303(url: URL) {
  return NextResponse.redirect(url, 303);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params;

  if (!isAllowedOrigin(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Build redirects against the PUBLIC origin, not request.url — behind the nginx proxy request.url reflects the
  // internal host. APP_ORIGIN is validated in isAllowedOrigin above.
  const origin = process.env.APP_ORIGIN as string;

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return r303(new URL('/auth/login', origin));
  }

  const formData = await request.formData();
  const parsed = purchasePackageSchema.safeParse({ 'og-token': formData.get('og-token') });

  // Load the campaign and verify ownership before anything else. A campaign that is missing and one the caller does
  // not own get the same answer.
  const campaign = await getCampaignForPurchase(campaignId);
  if (!campaign) {
    return r303(new URL('/app', origin));
  }
  let event: Awaited<ReturnType<typeof requireOwnedEvent>>;
  try {
    event = await requireOwnedEvent(campaign.event_id);
  } catch {
    return r303(new URL('/app', origin));
  }

  const payUrl = (query: string) =>
    new URL(`/app/events/${campaign.event_id}/campaign/${campaignId}/payment?${query}`, origin);
  const payError = (error: PurchaseErrorCode) => r303(payUrl(`error=${error}`));

  // The submitted input first: a missing token is a form/tokenization problem, more actionable than any state error.
  if (!parsed.success) return payError(PURCHASE_ERROR.TOKEN_MISSING);

  // No payment for a past event (Israel calendar), and every commercial action needs an active event (R9). App
  // defence-in-depth: the DB trigger is the REST-proof authority for the campaign-status side of the same rule.
  if (isPastEventDay(event.event_date)) return payError(PURCHASE_ERROR.EVENT_PAST);
  if (event.status !== 'active') return payError(PURCHASE_ERROR.EVENT_NOT_ACTIVE);

  // Cardholder name on the receipt — same fallback chain as the hold and the signed agreement.
  const profile = await getProfile();
  const name = profile?.full_name?.trim() || user.email || 'לקוח KALFA';

  let outcome: PurchaseOutcome;
  try {
    outcome = await purchasePackage({
      campaign,
      payer: { userId: user.id, email: user.email ?? '', name },
      ogToken: parsed.data['og-token'],
    });
  } catch (err) {
    // purchasePackage reports every failure as an outcome; a throw here is a bug. The message is logged server-side
    // only (it is short and carries no card data); the customer sees a generic answer, and a retry is safe because
    // the ledger refuses a second charge.
    console.error('[package-purchase] unexpected failure', {
      campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
    return payError(PURCHASE_ERROR.FAILED);
  }

  if (outcome === 'already_paid') return r303(payUrl('paid=1'));

  if (outcome === 'paid') {
    // The payment was the customer's last real decision (D6: charged → list filled → activated), so the campaign
    // starts now instead of asking for one more click. FAIL-SAFE: see activateAfterPayment — the payment is recorded
    // whatever happens, and a refused start lands the customer on the paid page with the reason and a start button.
    const activation = await activateAfterPayment(campaignId, campaign.event_id);
    if (activation === 'no_contacts') return r303(payUrl('paid=1&activate=no_contacts'));
    if (activation === 'failed') return r303(payUrl('paid=1&activate=failed'));
    return r303(payUrl('paid=1'));
  }
  return payError(OUTCOME_TO_ERROR[outcome]);
}
