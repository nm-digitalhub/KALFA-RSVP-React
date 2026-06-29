import Link from 'next/link';

import { Badge, type BadgeVariant } from '@/app/(admin)/admin/_components';
import { buttonVariants } from '@/components/ui/button';
import type { OwnerCampaign } from '@/lib/data/campaigns';

import { setupCampaignAction } from './campaign/campaign-actions';
import { CampaignSetupForm } from './campaign-setup-form';

// Campaign status → Hebrew label. Single source for this section (the lifecycle
// manage screen keeps its own copy; centralizing both is a separate cleanup).
const STATUS_LABELS: Record<string, string> = {
  draft: 'טיוטה',
  pending_approval: 'ממתין לאישור',
  approved: 'מאושר',
  scheduled: 'מתוזמן',
  active: 'פעיל',
  paused: 'מושהה',
  closed: 'נסגר',
  awaiting_invoice: 'ממתין לחשבון',
  billed: 'חויב',
  paid: 'שולם',
  cancelled: 'בוטל',
};

// Campaign status → Badge variant (loose map matching STATUS_LABELS above;
// unknown statuses fall back to neutral at the call site).
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  scheduled: 'info',
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
  awaiting_invoice: 'warning',
  billed: 'info',
  paid: 'success',
  cancelled: 'destructive',
};

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
export function CampaignSection({
  eventId,
  campaign,
}: {
  eventId: string;
  campaign: OwnerCampaign | null;
}) {
  if (!campaign) {
    return (
      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">אישורי הגעה</h2>
        <p className="text-sm text-muted-foreground">
          הפעילו פנייה אוטומטית לאורחים לאיסוף אישורי הגעה. משלמים רק על רשומות
          מוצלחות — אורחים שמהם התקבלה תשובה.
        </p>
        <CampaignSetupForm action={setupCampaignAction.bind(null, eventId)} />
      </section>
    );
  }

  const step = nextStep(eventId, campaign);
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">אישורי הגעה</h2>
        <Badge variant={STATUS_VARIANTS[campaign.status] ?? 'neutral'}>
          {STATUS_LABELS[campaign.status] ?? campaign.status}
        </Badge>
      </div>
      {campaign.max_charge_ceiling != null ? (
        <p className="text-sm text-muted-foreground">
          תקרת חיוב ₪
          {Number(campaign.max_charge_ceiling).toLocaleString('he-IL')}
        </p>
      ) : null}
      <Link href={step.href} className={buttonVariants()}>
        {step.label}
      </Link>
    </section>
  );
}
