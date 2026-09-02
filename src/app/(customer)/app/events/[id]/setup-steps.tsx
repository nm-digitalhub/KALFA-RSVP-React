import Link from 'next/link';
import { Check, Circle, LoaderCircle, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { OwnerCampaign } from '@/lib/data/campaigns';
import type { EventDetail } from '@/lib/data/events';
import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_VARIANTS } from '@/lib/data/event-labels';
import { SETUP_STEP_LABELS, computeSetupSteps, type SetupStep } from '@/lib/data/setup-steps';
import { cn } from '@/lib/utils';

import { setupCampaignAction } from './campaign/campaign-actions';
import { CampaignSetupForm } from './campaign-setup-form';

// The R5 lock, stated BEFORE the click (audit §2, verbatim requirement).
const LOCK_WARNING =
  'לאחר האישור לא ניתן יהיה לשנות את תאריך האירוע, שעת האירוע והמועד האחרון לאישורי הגעה.';

function StepIcon({ state }: { state: SetupStep['state'] }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
        state === 'done' && 'bg-success/15 text-success',
        state === 'current' && 'bg-primary/10 text-primary',
        state === 'pending' && 'bg-muted text-muted-foreground',
        state === 'blocked' && 'bg-warning/10 text-warning',
      )}
      aria-hidden="true"
    >
      {state === 'done' ? <Check className="size-4" /> : null}
      {state === 'current' ? <LoaderCircle className="size-4" /> : null}
      {state === 'pending' ? <Circle className="size-3" /> : null}
      {state === 'blocked' ? <Lock className="size-4" /> : null}
    </span>
  );
}

// The event's setup page (audit "הזרימה המומלצת" step 4): every step in order,
// exactly one marked current, and ONE call-to-action for that step. Replaces the
// three look-alike buttons (publish / enable RSVPs / activate) the audit flagged.
export function SetupSteps({
  event,
  campaign,
  guestCount,
  isPast,
}: {
  event: EventDetail;
  campaign: OwnerCampaign | null;
  guestCount: number;
  isPast: boolean;
}) {
  const { steps, stage } = computeSetupSteps({
    event: {
      status: event.status,
      event_type: event.event_type,
      event_date: event.event_date,
      venue_name: event.venue_name,
      celebrants: event.celebrants,
    },
    campaign,
    guestCount,
    isPast,
  });
  const current = steps.find((s) => s.state === 'current')?.key ?? null;
  const base = campaign ? `/app/events/${event.id}/campaign/${campaign.id}` : null;
  const guestsHref = `/app/events/${event.id}/guests`;
  const confirmAction = setupCampaignAction.bind(null, event.id);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">אישורי הגעה — שלבי ההקמה</h2>
        <Badge variant={CAMPAIGN_STAGE_VARIANTS[stage]}>{CAMPAIGN_STAGE_LABELS[stage]}</Badge>
      </div>

      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={cn(
              'flex items-start gap-3 rounded-md px-2 py-2',
              s.state === 'current' && 'bg-primary/5',
            )}
          >
            <StepIcon state={s.state} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  s.state === 'pending' && 'text-muted-foreground',
                )}
              >
                {i + 1}. {SETUP_STEP_LABELS[s.key]}
              </p>
              {s.hint ? <p className="text-xs text-muted-foreground">{s.hint}</p> : null}
              {s.key === 'guests' && s.state !== 'done' && !isPast ? (
                <Link href={guestsHref} className="text-xs font-medium text-primary hover:underline">
                  להוספת מוזמנים
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {/* The ONE action for the current step. */}
      {current === 'confirm' ? (
        <CampaignSetupForm action={confirmAction} label="אישור פרטי האירוע והמשך">
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {LOCK_WARNING}
          </p>
        </CampaignSetupForm>
      ) : null}
      {current === 'sign' ? (
        base ? (
          <Link href={`${base}/approve`} className={buttonVariants()}>
            קריאת ההסכם וחתימה
          </Link>
        ) : (
          <CampaignSetupForm action={confirmAction} label="קריאת ההסכם וחתימה" />
        )
      ) : null}
      {current === 'pay' && base ? (
        <Link href={`${base}/payment`} className={buttonVariants()}>
          המשך לאמצעי תשלום
        </Link>
      ) : null}
      {current === 'live' && base ? (
        stage === 'paused' ? (
          <Link href={base} className={buttonVariants()}>
            ניהול הקמפיין
          </Link>
        ) : (
          <Link href={`${base}/payment`} className={buttonVariants()}>
            הפעלת הקמפיין עכשיו
          </Link>
        )
      ) : null}
      {stage === 'active' && base ? (
        <div className="flex flex-wrap gap-2">
          {guestCount === 0 ? (
            <Link href={guestsHref} className={buttonVariants()}>
              הוספת מוזמנים
            </Link>
          ) : null}
          <Link
            href={base}
            className={buttonVariants({ variant: guestCount === 0 ? 'outline' : 'default' })}
          >
            ניהול הקמפיין
          </Link>
        </div>
      ) : null}
      {stage === 'closed' && base ? (
        <Link href={base} className={buttonVariants({ variant: 'outline' })}>
          ניהול הקמפיין
        </Link>
      ) : null}
      {isPast && stage !== 'active' && stage !== 'closed' ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          מועד האירוע כבר חלף — לא ניתן להפעיל או להמשיך אישורי הגעה לאירוע שעבר.
        </p>
      ) : null}
    </section>
  );
}
