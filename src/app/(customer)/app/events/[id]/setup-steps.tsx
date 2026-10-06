import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { listPackageOffers, type OwnerCampaign } from '@/lib/data/campaigns';
import type { EventDetail } from '@/lib/data/events';
import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STAGE_VARIANTS,
} from '@/lib/data/event-labels';
import {
  POST_ACTIVATION_STAGES,
  computeSetupSteps,
  setupStepLabels,
  toSetupEvent,
} from '@/lib/data/setup-steps';
import { packagePaymentOf } from '@/lib/payments/package-paid';

import { SetupStepper } from './setup-stepper';

// The event page's view of the ONE-TIME setup flow: the steps, and ONE link into
// the flow (`/setup`), where the current step is done. Nothing is done from here —
// the confirm, signature and payment steps live in the flow, so there is a single
// place to do each. After activation setup is over: the card collapses to the
// campaign and its management page.
export async function SetupSteps({
  event,
  campaign,
  isPast,
}: {
  event: EventDetail;
  campaign: OwnerCampaign | null;
  isPast: boolean;
}) {
  // The same list the setup page shows: with a fixed-price package on offer and no campaign yet, the flow has a
  // package-choice step, and this card must not claim a shorter one. Informational only, so a catalogue that cannot be
  // read simply leaves the step out (the setup page and its actions enforce the real rules).
  let packageOffered = false;
  if (!campaign) {
    try {
      packageOffered = (await listPackageOffers()).length > 0;
    } catch (err) {
      console.error('[event] package catalogue could not be read', {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const payment = campaign ? await packagePaymentOf(campaign) : null;
  const { steps, stage } = computeSetupSteps({
    event: toSetupEvent(event),
    campaign: campaign && {
      status: campaign.status,
      capture_status: campaign.capture_status,
      package_price: campaign.package_price,
      payment,
    },
    isPast,
    packageOffered,
  });
  const base = campaign ? `/app/events/${event.id}/campaign/${campaign.id}` : null;
  const labels = setupStepLabels(steps);

  if (POST_ACTIVATION_STAGES.includes(stage) && base) {
    return (
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">הקמפיין</h2>
          <Badge variant={CAMPAIGN_STAGE_VARIANTS[stage]}>{CAMPAIGN_STAGE_LABELS[stage]}</Badge>
        </div>
        <Link href={base} className={buttonVariants()}>
          ניהול הקמפיין
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">אישורי הגעה — שלבי ההקמה</h2>
        <Badge variant={CAMPAIGN_STAGE_VARIANTS[stage]}>{CAMPAIGN_STAGE_LABELS[stage]}</Badge>
      </div>

      <SetupStepper steps={steps.map((s) => ({ ...s, label: labels[s.key] }))} />

      {isPast ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          מועד האירוע כבר חלף — לא ניתן להפעיל או להמשיך אישורי הגעה לאירוע שעבר.
        </p>
      ) : (
        <Link href={`/app/events/${event.id}/setup`} className={buttonVariants()}>
          המשך הקמה
        </Link>
      )}
    </section>
  );
}
