import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCampaign } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import {
  getPaymentsEnabled,
  getCampaignHoldsEnabled,
  getSumitPublicConfig,
} from '@/lib/data/payments';
import { CampaignHoldForm } from './hold-form';

// Card-capture step of campaign approval (route A: a J5 authorization hold up to
// the ceiling at approval; the actual charge happens at campaign close). The live
// card form is rendered ONLY when payments + campaign holds are enabled AND the
// provider config is present (fail-closed). Otherwise the step is informational
// and makes no SUMIT call.

function ils(n: number | null): string {
  if (n == null) return '—';
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  token_missing: 'לא התקבלו פרטי אשראי. נסו שוב.',
  holds_disabled: 'שלב קליטת אמצעי התשלום אינו פעיל כעת.',
  bad_state: 'לא ניתן לתפוס מסגרת במצב הנוכחי של הקמפיין.',
  already_held: 'כבר קיימת תפיסת מסגרת, או שתהליך תפיסה כבר מתבצע.',
  hold_declined: 'תפיסת המסגרת נדחתה. בדקו את פרטי הכרטיס ונסו שוב.',
  hold_review:
    'התקבלה תשובה לא חד-משמעית מחברת האשראי. בדקו מול חברת האשראי או נסו שוב.',
  event_past: 'מועד האירוע כבר חלף — לא ניתן לתפוס מסגרת אשראי עבור אירוע שעבר.',
  event_not_active: 'האירוע אינו פעיל כעת — לא ניתן לתפוס מסגרת אשראי לפני פרסום האירוע.',
};

export default async function CampaignPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; campaignId: string }>;
  searchParams: Promise<{ error?: string; held?: string }>;
}) {
  const { id, campaignId } = await params;
  const { error } = await searchParams;
  const campaign = await getCampaign(campaignId);
  if (campaign.event_id !== id) notFound();
  const event = await requireOwnedEvent(id);
  const isPast = isPastEventDay(event.event_date);

  // The agreement must be signed (campaign approved) before the payment step.
  if (campaign.status === 'pending_approval') {
    redirect(`/app/events/${id}/campaign/${campaignId}/approve`);
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
      <h1 className="text-2xl font-bold">אמצעי תשלום</h1>
      {backLink}
    </div>
  );

  // L1: a past event can no longer take a card hold (the J5 route rejects it too).
  // An already-placed hold (handled below) is left intact so it can be settled.
  if (isPast && campaign.capture_status !== 'authorized') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          מועד האירוע כבר חלף — לא ניתן לתפוס מסגרת אשראי עבור אירוע שעבר.
        </p>
      </div>
    );
  }

  // Already held → done, no form.
  if (campaign.capture_status === 'authorized') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          ✓ נתפסה מסגרת אשראי עד {ils(campaign.max_charge_ceiling)}. החיוב בפועל
          ייעשה בסגירת הקמפיין, לפי מספר אנשי הקשר שהושגו.
        </p>
      </div>
    );
  }

  // Fail-closed gate: only render the live card form when everything is on.
  const [paymentsEnabled, holdsEnabled, publicConfig] = await Promise.all([
    getPaymentsEnabled(),
    getCampaignHoldsEnabled(),
    getSumitPublicConfig(),
  ]);
  const canHold = paymentsEnabled && holdsEnabled && publicConfig !== null;

  const summary = (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
      <h2 className="font-semibold">תפיסת מסגרת אשראי</h2>
      <p>
        להפעלת הקמפיין נתפוס מסגרת אשראי עד{' '}
        <strong>{ils(campaign.max_charge_ceiling)}</strong> (תקרת החיוב). זוהי
        תפיסה בלבד — <strong>החיוב בפועל</strong> ייעשה בסגירת הקמפיין, לפי מספר
        אנשי הקשר שהושגו בפועל, ולכל היותר עד התקרה.
      </p>
    </section>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {header}
      <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
        ✓ ההסכם נחתם והקמפיין אושר.
      </p>

      {summary}

      {error && ERROR_MESSAGES[error] ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}

      {canHold && publicConfig ? (
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">פרטי כרטיס אשראי</h2>
          <CampaignHoldForm
            campaignId={campaignId}
            companyId={publicConfig.companyId}
            apiPublicKey={publicConfig.apiPublicKey}
          />
        </section>
      ) : (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          שלב קליטת אמצעי התשלום מופעל בנפרד. ניצור איתך קשר להשלמת תפיסת מסגרת
          האשראי.
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        עד להשלמת אמצעי התשלום הקמפיין אינו מופעל ולא יישלחו פניות.
      </p>
    </div>
  );
}
