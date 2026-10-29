import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { hasPlatformPermission, requireUser } from '@/lib/auth/dal';
import { isGooglePayOffered } from '@/lib/cardcom/google-pay-mode';
import { getCardcomServerConfig, isCardcomTestTerminal } from '@/lib/data/cardcom-config';
import { getCampaign } from '@/lib/data/campaigns';
import { closeControlOf, eventMode, resolveEventLifecycle } from '@/lib/data/event-lifecycle';
import { canAccessEvent, getEvent, requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { computeSetupSteps, setupBackTarget, SETUP_STEP_LABELS, toSetupEvent } from '@/lib/data/setup-steps';
import { getPaymentsEnabled, getPackageModelEnabled, getSumitPublicConfig } from '@/lib/data/payments';
import { getProfile } from '@/lib/data/profiles';
import { isCardcomPurchasePending } from '@/lib/payments/cardcom-pending';
import { packagePaymentScreen } from '@/lib/payments/package-payment-screen';
import { getPackagePaymentState } from '@/lib/payments/package-purchase';
import { purchaseErrorMessage } from '@/lib/payments/package-purchase-errors';
import { resolvePurchaseProvider } from '@/lib/payments/provider';
import { closeEventAction } from '../../campaign-actions';
import { SetupShell } from '../../../setup-shell';
import { PackagePaymentView } from './package-payment-view';

export const metadata: Metadata = { title: 'תשלום החבילה' };

// The package is paid by ONE purchase. What the page shows is decided from the payment LEDGER — not from a query string
// (stale on reload). An unreadable ledger is shown as unavailable, never as an empty form.
//
// The payment is a setup step (design D2/D3): it renders inside the setup shell, so the step list stays in view while
// paying, and once the event is in management (paid, running, closed) the page hands the owner to the event page.

export default async function CampaignPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; campaignId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, campaignId } = await params;
  const { error } = await searchParams;
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

  const [eventDetail, paymentsEnabled, packageEnabled, publicConfig, profile, payment, cardcomConfig, mayUseTestTerminal, user, canClose] = await Promise.all([
    // The fields the setup steps read (toSetupEvent); requireOwnedEvent above is the access gate.
    getEvent(id),
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
    canAccessEvent(id, 'events', 'close'),
  ]);

  // The event's mode (design D1), from the same lifecycle model as the event page and /setup, read from THIS campaign and
  // the ledger read above. It is the event's live campaign: an event has at most one campaign that is not cancelled, and a
  // cancelled one reads as finished (management). The owner reached this page (requireOwnedEvent), so the campaigns are
  // visible. `unavailable` (a ledger that cannot be read, money support has to look at) stays here and says so (task 3.8).
  const lifecycle = resolveEventLifecycle({ eventStatus: event.status, campaignsVisible: true, campaign, payment });
  if (eventMode(lifecycle) === 'management') redirect(`/app/events/${id}`);
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
  const { steps } = computeSetupSteps({
    event: toSetupEvent(eventDetail),
    campaign: { status: campaign.status, price: campaign.price, payment },
    isPast,
  });
  const backTarget = setupBackTarget({ eventId: id, steps });
  const closeControl = closeControlOf(lifecycle);
  return (
    <SetupShell
      eventId={id}
      eventName={event.name}
      steps={steps.map((s) => ({ ...s, label: SETUP_STEP_LABELS[s.key] }))}
      back={backTarget ? { href: backTarget.href, label: SETUP_STEP_LABELS[backTarget.key] } : null}
      close={
        canClose
          ? {
              status: event.status,
              closeAllowed: closeControl.allowed,
              blockedHint: closeControl.hint,
              closeAction: closeEventAction.bind(null, id),
            }
          : null
      }
    >
      <h2 className="text-lg font-semibold">{SETUP_STEP_LABELS.pay}</h2>
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
      />
    </SetupShell>
  );
}
