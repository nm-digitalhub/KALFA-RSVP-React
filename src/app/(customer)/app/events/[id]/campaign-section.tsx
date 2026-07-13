import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { OwnerCampaign } from '@/lib/data/campaigns';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_VARIANTS } from '@/lib/data/event-labels';

import { setupCampaignAction } from './campaign/campaign-actions';
import { CampaignSetupForm } from './campaign-setup-form';

// The next step the owner should take, by lifecycle state — so the single CTA
// always points at the right screen (approve → pay/hold → activate → manage).
function nextStep(
  eventId: string,
  c: OwnerCampaign,
): { href: string; label: string } {
  const base = `/app/events/${eventId}/campaign/${c.id}`;
  if (c.status === 'pending_approval') {
    return { href: `${base}/approve`, label: 'המשך לאישור וחתימה' };
  }
  if (c.status === 'approved') {
    return c.capture_status === 'authorized'
      ? { href: base, label: 'הפעלת הקמפיין' }
      : { href: `${base}/payment`, label: 'תפיסת מסגרת לתשלום' };
  }
  return { href: base, label: 'ניהול הקמפיין' };
}

// The event's single "RSVP confirmations" campaign, embedded in the event page.
// No campaign yet → an inline setup CTA. Exists → status + the context CTA.
// Shown for a past event: RSVP confirmations can no longer be started or
// advanced (the createCampaign / sign / activate / hold guards all reject it).
function PastEventNotice() {
  return (
    <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
      מועד האירוע כבר חלף — לא ניתן להפעיל או להמשיך אישורי הגעה לאירוע שעבר.
    </p>
  );
}

export function CampaignSection({
  eventId,
  campaign,
  isPast = false,
}: {
  eventId: string;
  campaign: OwnerCampaign | null;
  isPast?: boolean;
}) {
  if (!campaign) {
    return (
      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">אישורי הגעה</h2>
        <p className="text-sm text-muted-foreground">
          הפעילו פנייה אוטומטית לאורחים לאיסוף אישורי הגעה. משלמים רק על רשומות
          מוצלחות — אורחים שמהם התקבלה תשובה.
        </p>
        {isPast ? (
          <PastEventNotice />
        ) : (
          <CampaignSetupForm action={setupCampaignAction.bind(null, eventId)} />
        )}
      </section>
    );
  }

  const step = nextStep(eventId, campaign);
  const base = `/app/events/${eventId}/campaign/${campaign.id}`;
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">אישורי הגעה</h2>
        <Badge variant={CAMPAIGN_STATUS_VARIANTS[campaign.status]}>
          {CAMPAIGN_STATUS_LABELS[campaign.status]}
        </Badge>
      </div>
      {campaign.max_charge_ceiling != null ? (
        <p className="text-sm text-muted-foreground">
          תקרת חיוב ₪
          {Number(campaign.max_charge_ceiling).toLocaleString('he-IL')}
        </p>
      ) : null}
      {isPast ? (
        <>
          <PastEventNotice />
          {/* View-only: the lifecycle actions are blocked, but the owner may
              still open the campaign to inspect it. */}
          <Link href={base} className={buttonVariants({ variant: 'outline' })}>
            ניהול הקמפיין
          </Link>
        </>
      ) : (
        <Link href={step.href} className={buttonVariants()}>
          {step.label}
        </Link>
      )}
    </section>
  );
}
