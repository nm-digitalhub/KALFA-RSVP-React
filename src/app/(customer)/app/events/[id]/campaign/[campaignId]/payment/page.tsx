import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { hasPlatformPermission, requireUser } from '@/lib/auth/dal';
import { isGooglePayOffered } from '@/lib/cardcom/google-pay-mode';
import { getCardcomServerConfig, isCardcomTestTerminal } from '@/lib/data/cardcom-config';
import { getCampaign } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { getPaymentsEnabled, getPackageModelEnabled, getSumitPublicConfig } from '@/lib/data/payments';
import { getProfile } from '@/lib/data/profiles';
import { isCardcomPurchasePending } from '@/lib/payments/cardcom-pending';
import { packagePaymentScreen } from '@/lib/payments/package-payment-screen';
import { getPackagePaymentState } from '@/lib/payments/package-purchase';
import { purchaseErrorMessage } from '@/lib/payments/package-purchase-errors';
import { resolvePurchaseProvider } from '@/lib/payments/provider';
import { activateCampaignAction } from '../../campaign-actions';
import { PackagePaymentView } from './package-payment-view';

export const metadata: Metadata = { title: 'תשלום החבילה' };

// The package is paid by ONE purchase. What the page shows is decided from the payment LEDGER — not from `?paid=1`
// (stale on reload). An unreadable ledger is shown as unavailable, never as an empty form.

export default async function CampaignPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; campaignId: string }>;
  searchParams: Promise<{ error?: string; activate?: string }>;
}) {
  const { id, campaignId } = await params;
  const { error, activate } = await searchParams;
  const campaign = await getCampaign(campaignId);
  if (campaign.event_id !== id) notFound();
  const event = await requireOwnedEvent(id);
  const isPast = isPastEventDay(event.event_date);

  // The package terms must be approved before the payment step.
  if (campaign.status === 'pending_approval') {
    redirect(`/app/events/${id}/setup`);
  }
  // A campaign without a package was created under the earlier model and has nothing to pay here.
  if (campaign.price == null) {
    redirect(`/app/events/${id}/campaign/${campaignId}`);
  }

  const backLink = (
    <Link
      href={`/app/events/${id}`}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <span aria-hidden="true">→</span>
      חזרה לאירוע
    </Link>
  );

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">תשלום החבילה</h1>
      {backLink}
    </div>
  );

  const [paymentsEnabled, packageEnabled, publicConfig, profile, payment, cardcomConfig, mayUseTestTerminal, user] = await Promise.all([
    getPaymentsEnabled(),
    getPackageModelEnabled(),
    getSumitPublicConfig(),
    getProfile(),
    getPackagePaymentState(campaignId).catch((err: unknown) => {
      console.error('[payment] package payment state could not be read', {
        campaignId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }),
    getCardcomServerConfig(),
    // Someone who may configure the integration is the only buyer allowed on CardCom's test terminal.
    hasPlatformPermission('integrations.manage').catch(() => false),
    requireUser(),
  ]);
  // Which clearing company takes this purchase — the same decision the purchase routes make (resolvePurchaseProvider).
  const provider = resolvePurchaseProvider(cardcomConfig, mayUseTestTerminal);
  // Google Pay is offered by the SERVER's rule (add-google-pay-cardcom, D2): the form is handed the terminal of the very
  // configuration that opens the session, or null. The browser never decides who is eligible.
  const googlePayTerminal =
    cardcomConfig !== null &&
    isGooglePayOffered({
      mode: cardcomConfig.googlePayMode,
      usesCardcom: provider === 'cardcom',
      mayConfigureIntegration: mayUseTestTerminal,
      saveCardOnPurchase: cardcomConfig.saveCardOnPurchase,
    })
      ? cardcomConfig.terminalNumber
      : null;
  // A pending CardCom payment is a form the buyer can pick up again; a pending SUMIT charge never is.
  const pendingIsResumable = provider === 'cardcom' && payment?.status === 'pending' && (await isCardcomPurchasePending(campaignId));
  const screen = packagePaymentScreen({
    price: Number(campaign.price),
    payment,
    campaignStatus: campaign.status,
    eventPast: isPast,
    eventActive: event.status === 'active',
    gatesOpen: paymentsEnabled && packageEnabled && (provider === 'cardcom' || publicConfig !== null),
    pendingIsResumable,
    // Said on the form, so nobody mistakes a run on CardCom's test terminal for a real payment.
    testTerminal: provider === 'cardcom' && cardcomConfig !== null && isCardcomTestTerminal(cardcomConfig.terminalNumber),
  });
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {header}
      <PackagePaymentView
        screen={screen}
        errorMessage={purchaseErrorMessage(error)}
        eventId={id}
        campaignId={campaignId}
        formConfig={publicConfig}
        provider={provider}
        googlePayTerminal={googlePayTerminal}
        signerName={profile?.full_name?.trim() || 'לקוח KALFA'}
        signerEmail={user.email ?? ''}
        signerPhone={profile?.phone ?? ''}
        activateAction={activateCampaignAction.bind(null, id, campaignId)}
        activateReason={activate === 'failed' ? 'failed' : null}
      />
    </div>
  );
}
