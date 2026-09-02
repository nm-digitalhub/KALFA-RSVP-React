import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCampaign, previewCampaignHoldSizing } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import {
  getPaymentsEnabled,
  getCampaignHoldsEnabled,
  getSumitPublicConfig,
} from '@/lib/data/payments';
import { getProfile } from '@/lib/data/profiles';
import { buttonVariants } from '@/components/ui/button';
import { activateCampaignAction } from '../../campaign-actions';
import { CampaignHoldForm } from './hold-form';
import { ActivateNowForm } from './activate-now-form';
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
  searchParams: Promise<{ error?: string; held?: string; activate?: string }>;
}) {
  const { id, campaignId } = await params;
  const { error, activate } = await searchParams;
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

  // Held. Two faces:
  //  • ACTIVE — auto-activation succeeded → the success screen (audit §1/§7):
  //    the next task is adding guests, not "managing the campaign".
  //  • NOT active — auto-activation was refused, or the hold predates it →
  //    activate HERE, in place; never send the owner back to the event page.
  // HeldAnalytics fires payment_authorized once when arriving via ?held=1 and
  // strips only that param (activate=failed survives for this render).
  if (campaign.capture_status === 'authorized') {
    // Verified gap (30.8): auth_amount (the REAL J5 hold, sized to `covered` =
    // min(max_contacts, reasonable_coverage_contacts)) can be LESS than
    // max_charge_ceiling once max_contacts exceeds the coverage cap (300
    // today) — show what was actually authorized on the card, not the
    // ceiling. Fall back to the ceiling only if auth_amount is unexpectedly
    // missing (should not happen once authorized).
    const heldAmount = campaign.auth_amount ?? campaign.max_charge_ceiling;

    if (campaign.status === 'active') {
      return (
        <div className="mx-auto max-w-2xl space-y-6">
          {header}
          <section className="space-y-4 rounded-lg border border-success/40 bg-success/10 p-6 text-center">
            <p className="text-2xl font-bold text-success">הקמפיין פעיל</p>
            <p className="text-sm">
              נתפסה מסגרת אשראי בסך {ils(heldAmount)}. הפניות לאורחים יישלחו לפי לוח
              הזמנים; החיוב בפועל ייעשה לאחר האירוע, לפי התוצאות, ולכל היותר עד{' '}
              {ils(campaign.max_charge_ceiling)}.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link href={`/app/events/${id}/guests`} className={buttonVariants()}>
                הוספת מוזמנים
              </Link>
              <Link
                href={`/app/events/${id}/campaign/${campaignId}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                מעבר לניהול הקמפיין
              </Link>
            </div>
          </section>
          <HeldAnalytics />
        </div>
      );
    }

    const canActivateHere =
      !isPast && ['approved', 'scheduled', 'paused'].includes(campaign.status);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          ✓ נתפסה מסגרת אשראי בסך {ils(heldAmount)}. החיוב בפועל ייעשה לאחר האירוע,
          לפי התוצאות, ולכל היותר עד {ils(campaign.max_charge_ceiling)}.
        </p>
        {activate === 'failed' ? (
          <p
            role="alert"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            הקמפיין עוד לא הופעל אוטומטית. אפשר להפעיל אותו כעת.
          </p>
        ) : null}
        {canActivateHere ? (
          <ActivateNowForm action={activateCampaignAction.bind(null, id, campaignId)} />
        ) : (
          <Link
            href={`/app/events/${id}/campaign/${campaignId}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            מעבר לניהול הקמפיין
          </Link>
        )}
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

  // Audit §6: one short, explicit summary instead of a paragraph the customer
  // has to parse. Every number is data — the campaign's pricing snapshot and the
  // LIVE sizing preview (the same helpers the authorize route will use) — never
  // a hardcoded price. The preview is best-effort: if it fails, the page still
  // renders with the snapshot ceiling and no "current hold" line, and the
  // authorize route recomputes authoritatively on submit anyway. The base-fee
  // line keeps the 30.8 fix: the base is owed even at 0 reached, said plainly on
  // the exact page where the customer commits a card.
  let sizing: Awaited<ReturnType<typeof previewCampaignHoldSizing>> | null = null;
  if (canHold) {
    try {
      sizing = await previewCampaignHoldSizing(campaignId);
    } catch (err) {
      console.error('[payment] hold sizing preview failed', {
        campaignId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const basePrice = Number(campaign.base_price ?? 0);
  const included = Number(campaign.included_reached ?? 0);
  const overage = Number(campaign.price_per_reached ?? 0);
  const holdAmount = sizing?.holdAmount ?? campaign.max_charge_ceiling;
  const ceiling = sizing?.ceiling ?? campaign.max_charge_ceiling;

  const summary = (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
      <h2 className="font-semibold">מה נתפוס עכשיו ומה נחייב</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {basePrice > 0 ? (
          <>
            <dt className="text-muted-foreground">דמי הפעלה</dt>
            <dd>
              <strong>{ils(basePrice)}</strong> — נגבים בכל מקרה, גם אם אף איש קשר לא השיב
            </dd>
          </>
        ) : null}
        {included > 0 ? (
          <>
            <dt className="text-muted-foreground">כלולים בדמי ההפעלה</dt>
            <dd>עד {included.toLocaleString('he-IL')} אנשי קשר שהושגו</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">
          {included > 0 ? 'מעבר לכך' : 'מחיר לאיש קשר שהושג'}
        </dt>
        <dd>{ils(overage)} לכל איש קשר שהושג</dd>
        {sizing ? (
          <>
            <dt className="text-muted-foreground">אנשי קשר ברשימה כעת</dt>
            <dd>{sizing.full.toLocaleString('he-IL')}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">סכום תפיסת המסגרת כעת</dt>
        <dd>
          <strong>{ils(holdAmount)}</strong> — תפיסה בלבד, לא חיוב
        </dd>
        <dt className="text-muted-foreground">תקרת החיוב</dt>
        <dd>{ils(ceiling)}</dd>
        <dt className="text-muted-foreground">מתי מתבצע החיוב</dt>
        <dd>
          לאחר האירוע, עם סגירת הקמפיין וגמר החשבון — לפי התוצאות בפועל ולכל היותר עד
          התקרה
        </dd>
        <dt className="text-muted-foreground">אם אף איש קשר לא משיב</dt>
        <dd>
          {basePrice > 0 ? `תחויבו בדמי ההפעלה (${ils(basePrice)}) בלבד.` : 'לא תחויבו כלל.'}
        </dd>
      </dl>
      {sizing && sizing.full === 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          הרשימה ריקה כעת. תקרת החיוב ומסגרת האשראי נקבעות לפי המוזמנים שברשימה ברגע
          התפיסה
          {included > 0
            ? ` — אחרי ההפעלה תוכלו להוסיף עד ${included.toLocaleString('he-IL')} אנשי קשר במסגרת דמי ההפעלה.`
            : '.'}{' '}
          <Link href={`/app/events/${id}/guests`} className="underline">
            להוספת מוזמנים לפני
          </Link>
        </p>
      ) : null}
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
            holdAmount={holdAmount ?? campaign.max_charge_ceiling}
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
