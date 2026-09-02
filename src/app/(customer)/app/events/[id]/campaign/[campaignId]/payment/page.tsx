import type { Metadata } from 'next';
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
import { getProfile } from '@/lib/data/profiles';
import { CampaignHoldForm } from './hold-form';
import { HeldAnalytics } from './_held-analytics';

export const metadata: Metadata = { title: 'תשלום קמפיין' };

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
  event_not_active: 'פרטי האירוע עוד לא אושרו — יש לאשר אותם לפני תפיסת מסגרת האשראי.',
};

// R9/whitelist: the live card form may render ONLY for a campaign in this exact
// state. Any other status (cancelled/closed/draft/scheduled/…) — the server
// (authorize/route.ts) would reject it anyway via BAD_STATE, but showing the
// full card form first and only failing on submit is a bad UX; short-circuit
// here instead of falling through.
const HOLDABLE_CAMPAIGN_STATUSES = new Set(['approved']);

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

  // R9: the event itself must be active — the DB trigger + the authorize route
  // both enforce this, but the UI should say so up front rather than let the
  // owner fill in card details that will only fail on submit.
  if (event.status !== 'active' && campaign.capture_status !== 'authorized') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {ERROR_MESSAGES.event_not_active}
        </p>
      </div>
    );
  }

  // Already held → done, no form. HeldAnalytics fires payment_authorized once
  // when arriving here via the hold redirect (?held=1) and strips the param.
  if (campaign.capture_status === 'authorized') {
    // Verified gap (30.8): auth_amount (the REAL J5 hold, sized to `covered` =
    // min(max_contacts, reasonable_coverage_contacts)) can be LESS than
    // max_charge_ceiling once max_contacts exceeds the coverage cap (300
    // today) — this confirmation must show what was actually authorized on
    // the card, not the ceiling, which no longer means "the hold amount"
    // once the two diverge. Fall back to the ceiling only if auth_amount is
    // unexpectedly missing (should not happen once authorized).
    const heldAmount = campaign.auth_amount ?? campaign.max_charge_ceiling;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          ✓ נתפסה מסגרת אשראי בסך {ils(heldAmount)}. החיוב בפועל ייעשה
          בסגירת הקמפיין, לפי מספר אנשי הקשר שהושגו, ולכל היותר עד תקרת החיוב
          ({ils(campaign.max_charge_ceiling)}).
        </p>
        <HeldAnalytics />
      </div>
    );
  }

  // Whitelist: only an 'approved' campaign may see the live card form. Any
  // other status the redirect/authorized checks above didn't already handle
  // (cancelled, closed, draft, scheduled, …) gets a safe generic message
  // instead of a form that would only fail server-side on submit.
  if (!HOLDABLE_CAMPAIGN_STATUSES.has(campaign.status)) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {ERROR_MESSAGES.bad_state}
        </p>
      </div>
    );
  }

  // Fail-closed gate: only render the live card form when everything is on.
  const [paymentsEnabled, holdsEnabled, publicConfig, profile] = await Promise.all([
    getPaymentsEnabled(),
    getCampaignHoldsEnabled(),
    getSumitPublicConfig(),
    getProfile(),
  ]);
  // max_charge_ceiling is nullable at the schema level, but the same fail-closed
  // gate already covers it: a campaign that reaches 'approved' without one is not
  // in a state we can render a hold form for anyway.
  const canHold =
    paymentsEnabled &&
    holdsEnabled &&
    publicConfig !== null &&
    campaign.max_charge_ceiling != null;

  // Verified gap (30.8): the ceiling line here never said the base fee is
  // charged regardless of outcome — a customer on a base+overage campaign
  // could read "לפי מספר אנשי הקשר שהושגו" as "no contacts reached → no
  // charge," which is false (the base is owed even at 0 reached; this is the
  // exact page where they commit their card). manage-client.tsx's HelpTip
  // already states this correctly for the SAME campaign fields — mirrored
  // here, not invented.
  const basePrice = Number(campaign.base_price ?? 0);
  const baseFeeNote =
    basePrice > 0 ? (
      <>
        {' '}
        מתוך זה, <strong>{ils(basePrice)}</strong> הם דמי הפעלה קבועים
        שנגבים במלואם ללא תלות בתוצאה — גם אם אף איש קשר לא השיב.
      </>
    ) : null;

  const summary = (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
      <h2 className="font-semibold">תפיסת מסגרת אשראי</h2>
      <p>
        להפעלת הקמפיין נתפוס מסגרת אשראי עד{' '}
        <strong>{ils(campaign.max_charge_ceiling)}</strong> (תקרת החיוב). זוהי
        תפיסה בלבד — <strong>החיוב בפועל</strong> ייעשה בסגירת הקמפיין, לפי מספר
        אנשי הקשר שהושגו בפועל, ולכל היותר עד התקרה.{baseFeeNote}
      </p>
    </section>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {header}
      <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
        ✓ ההסכם נחתם בהצלחה. כעת יש להשלים אמצעי תשלום.
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

      {canHold && publicConfig && campaign.max_charge_ceiling != null ? (
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">פרטי כרטיס אשראי</h2>
          <CampaignHoldForm
            campaignId={campaignId}
            companyId={publicConfig.companyId}
            apiPublicKey={publicConfig.apiPublicKey}
            ceilingAmount={campaign.max_charge_ceiling}
            signerName={profile?.full_name?.trim() || 'לקוח KALFA'}
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
