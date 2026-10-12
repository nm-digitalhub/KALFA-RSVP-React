import Link from 'next/link';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { Metadata } from 'next';

import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/dal';
import { getCampaignForEvent, listPackageOffers, type PackageOffer } from '@/lib/data/campaigns';
import { getBenefitView, type BenefitView } from '@/lib/data/coupon-benefits';
import { isPastEventDay } from '@/lib/data/event-date';
import { getEvent } from '@/lib/data/events';
import {
  POST_ACTIVATION_STAGES,
  SETUP_LOCK_WARNING,
  computeSetupSteps,
  setupBackTarget,
  SETUP_STEP_LABELS,
  toSetupEvent,
} from '@/lib/data/setup-steps';
import { formatIsraelDate, formatIsraelDateTime } from '@/lib/date';
import { packagePaymentOf } from '@/lib/payments/package-paid';
import { signedInviteImageUrl } from '@/lib/storage/event-media';

import { acceptBenefitAction, choosePackageAction, setupCampaignAction } from '../campaign/campaign-actions';
import { PackageTermsStep } from '../campaign/[campaignId]/approve/package-terms-step';
import { BenefitAcceptBanner } from '../benefit-accept-banner';
import { EditEventForm } from '../edit-event-form';
import { PackageChoiceForm, type PackageChoiceBenefit } from '../package-choice-form';
import { SetupConfirmForm } from '../setup-confirm-form';
import { SetupStepper } from '../setup-stepper';

export const metadata: Metadata = { title: 'הקמת אישורי הגעה' };

// The ONE place the setup flow happens: the steps on top, and the current step's
// content below. Which step is current is decided here, on the server, from the
// event and its campaign (computeSetupSteps) — never from the URL or the browser —
// so reloading, or arriving from a link, always lands on the right step. Every
// action a step offers re-verifies ownership itself; this page only arranges them.
//
// Setup is one-time: once the campaign is active (or was), the flow is over and
// this page hands the owner to the campaign instead.
export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;

  // Access is enforced by the two reads below (getEvent: the event;
  // getCampaignForEvent: campaigns.view), exactly as on the event page, and every
  // action a step offers verifies its own rule again — the owner-only ones
  // (confirm, sign, pay) refuse anyone else.
  const event = await getEvent(id);
  if (event.status === 'closed') redirect(`/app/events/${id}`);

  const campaign = await getCampaignForEvent(id);
  const isPast = isPastEventDay(event.event_date);

  // The packages on offer. Only needed while there is no campaign yet: the choice is what creates it. With the package
  // switch off this is an empty list without a database read, and the choice step says no package is available. A
  // catalogue that cannot be read must not take the whole page down: it is shown as empty, and the action that would
  // create the campaign refuses on its own.
  let offers: PackageOffer[] = [];
  // The choice creates the campaign — and while the campaign is still pending approval, the SAME
  // step also changes the package (task 5.3: the pre-approval move; the bound benefit follows).
  if (!campaign || campaign.status === 'pending_approval') {
    try {
      offers = await listPackageOffers();
    } catch (err) {
      console.error('[setup] package catalogue could not be read', {
        eventId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // The personal benefit as this ACCOUNT may see it (tasks 7.1/7.2): active prices per package,
  // an ended/used notice for the proven owner, or the neutral verify-phone invitation. Fail-open
  // to "nothing": a broken benefit read must not take the setup page down, and reveals nothing.
  let benefitView: BenefitView = { kind: 'none' };
  try {
    const user = await requireUser();
    benefitView = await getBenefitView(user, { currentCampaignId: campaign?.id ?? null });
  } catch (err) {
    unstable_rethrow(err);
    console.error('[setup] benefit view could not be read', {
      eventId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const benefitForForm: PackageChoiceBenefit =
    benefitView.kind === 'active'
      ? {
          kind: 'active',
          expiresAtLabel: formatIsraelDate(benefitView.expiresAt) || benefitView.expiresAt,
          perPackage: Object.fromEntries(
            benefitView.perPackage.map((p) => [p.packageId, { listPrice: p.listPrice, finalPrice: p.finalPrice }]),
          ),
        }
      : benefitView.kind === 'ended'
        ? {
            kind: 'ended',
            reason: benefitView.reason,
            endedAtLabel: benefitView.endedAt ? formatIsraelDate(benefitView.endedAt) || null : null,
          }
        : benefitView.kind === 'used'
          ? { kind: 'used', eventName: benefitView.eventName }
          : { kind: benefitView.kind };

  // The acceptance banner (task 5.5, ש5/D21): approved terms, nothing paid, and an active benefit
  // that prices THIS campaign's package lower than the approved price — the customer decides.
  const acceptBenefit =
    campaign &&
    campaign.status === 'approved' &&
    campaign.template_id &&
    typeof campaign.price === 'number' &&
    benefitView.kind === 'active'
      ? (() => {
          const option = benefitView.perPackage.find((p) => p.packageId === campaign.template_id);
          return option && option.finalPrice < (campaign.price as number)
            ? { approvedPrice: campaign.price as number, benefitPrice: option.finalPrice }
            : null;
        })()
      : null;
  // A package campaign is funded by its payment, which only the ledger knows: the steps and the stage follow it.
  const payment = campaign ? await packagePaymentOf(campaign) : null;
  const { steps, stage } = computeSetupSteps({
    event: toSetupEvent(event),
    campaign: campaign && {
      status: campaign.status,
      price: campaign.price,
      payment,
    },
    isPast,
  });
  const base = campaign ? `/app/events/${id}/campaign/${campaign.id}` : null;
  const labels = SETUP_STEP_LABELS;

  if (POST_ACTIVATION_STAGES.includes(stage) && base) redirect(base);

  // `?step=details` reopens the details step while the event is still a draft, so
  // a detail can be fixed BEFORE confirming (the confirm step links to it). It only
  // chooses between two views of the same draft: the save it leads to re-checks
  // everything (and a draft's details are editable by definition).
  const editingDetails = step === 'details' && event.status === 'draft';
  const current = editingDetails ? 'details' : (steps.find((s) => s.state === 'current')?.key ?? null);
  // "Back" leads to the previous step's page, as decided by the server. Not while the details form is already the view:
  // the stepper still names the confirm step as the current one then, and a back to where the owner already is would be a lie.
  const backTarget = editingDetails ? null : setupBackTarget({ eventId: id, steps });
  const back = backTarget ? { href: backTarget.href, label: labels[backTarget.key] } : null;

  // Only the details step shows the invitation image. Fail-open, like the event
  // page: a signing hiccup must not take the step down.
  let inviteImageUrl: string | null = null;
  if (current === 'details' && event.invite_image_path) {
    try {
      inviteImageUrl = await signedInviteImageUrl(event.invite_image_path, 600);
    } catch {
      inviteImageUrl = null;
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">הקמת אישורי הגעה</h1>
        <Link
          href={`/app/events/${id}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">→</span>
          חזרה לאירוע
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{event.name}</p>

      <section className="rounded-lg border border-border bg-card p-6">
        <SetupStepper steps={steps.map((s) => ({ ...s, label: labels[s.key] }))} back={back} />
      </section>

      {isPast ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          מועד האירוע כבר חלף — לא ניתן להפעיל או להמשיך אישורי הגעה לאירוע שעבר.
        </p>
      ) : (
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          {current === 'details' ? (
            <>
              <h2 className="text-lg font-semibold">{labels.details}</h2>
              <EditEventForm event={event} inviteImageUrl={inviteImageUrl} mode="setup" />
            </>
          ) : null}

          {current === 'confirm' ? (
            <>
              <h2 className="text-lg font-semibold">{labels.confirm}</h2>
              <SetupConfirmForm
                action={setupCampaignAction.bind(null, id)}
                submitLabel="אישור פרטי האירוע והמשך"
                warning={SETUP_LOCK_WARNING}
                items={[
                  {
                    name: 'ack_datetime',
                    label: (
                      <>
                        אני מאשר/ת את תאריך האירוע ושעתו:{' '}
                        <strong>{event.event_date ? formatIsraelDateTime(event.event_date) : '—'}</strong>
                        {/* The deadline locks with the date, so the owner sees its value (or
                            that there is none) before agreeing, not just a sentence about it. */}
                        <br />
                        המועד האחרון לאישורי הגעה:{' '}
                        <strong>{event.rsvp_deadline ? formatIsraelDate(event.rsvp_deadline) : 'לא הוגדר'}</strong>
                      </>
                    ),
                  },
                  {
                    name: 'ack_venue',
                    label: (
                      <>
                        אני מאשר/ת את המקום והכתובת:{' '}
                        <strong>
                          {event.venue_name}, {event.venue_address}
                        </strong>
                      </>
                    ),
                  },
                  {
                    name: 'ack_lock',
                    label: 'הבנתי שהתאריך, השעה והמועד האחרון לאישורי הגעה ננעלים ברגע שתישלח ההודעה הראשונה לאורחים.',
                  },
                ]}
              />
              <Link
                href={`/app/events/${id}/setup?step=details`}
                className="inline-block text-sm font-medium text-primary hover:underline"
              >
                עריכת פרטי האירוע
              </Link>
            </>
          ) : null}

          {current === 'package' ? (
            <>
              <h2 className="text-lg font-semibold">{labels.package}</h2>
              {/* Only what the owner reads is handed to the browser; the server reads the package's own price and
                  quota when the campaign is created. */}
              <PackageChoiceForm
                action={choosePackageAction.bind(null, id)}
                offers={offers.map((o) => ({
                  id: o.id,
                  name: o.name,
                  price: o.price,
                  contact_quota: o.contact_quota,
                  description: o.description,
                  includes: o.includes,
                }))}
                benefit={benefitForForm}
                selectedPackageId={campaign?.template_id ?? null}
              />
            </>
          ) : null}

          {current === 'sign' ? (
            <>
              <h2 className="text-lg font-semibold">{labels.sign}</h2>
              {campaign && campaign.status === 'pending_approval' ? (
                // The package terms are APPROVED (two boxes), not signed: no signature, no phone code.
                <PackageTermsStep eventId={id} campaign={campaign} event={event} />
              ) : null}
            </>
          ) : null}

          {current === 'pay' && base ? (
            <>
              <h2 className="text-lg font-semibold">{labels.pay}</h2>
              {acceptBenefit && campaign ? (
                // ש5/D21 (task 5.5): the benefit WAITS for the customer's decision — accepting
                // reopens approval at the discounted price; the link pays the approved price.
                <BenefitAcceptBanner
                  action={acceptBenefitAction.bind(null, id, campaign.id)}
                  approvedPrice={acceptBenefit.approvedPrice}
                  benefitPrice={acceptBenefit.benefitPrice}
                  paymentHref={`${base}/payment`}
                />
              ) : (
                <Link href={`${base}/payment`} className={buttonVariants()}>
                  המשך לתשלום החבילה
                </Link>
              )}
            </>
          ) : null}

          {/* Paid but not yet activated: activation normally follows payment by
              itself; this is the fallback for when it did not happen. */}
          {current === 'live' && base ? (
            <>
              <h2 className="text-lg font-semibold">{labels.live}</h2>
              <Link href={`${base}/payment`} className={buttonVariants()}>
                הפעלת הקמפיין עכשיו
              </Link>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
