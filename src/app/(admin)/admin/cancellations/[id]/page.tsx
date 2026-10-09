import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, unstable_rethrow } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  History,
  Info,
  Mail,
  Percent,
  ShieldCheck,
  ShoppingBag,
  TriangleAlert,
  Undo2,
  User,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';

import { CampaignPayments } from '@/components/payments/campaign-payments';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  getCancellationRequestForAdmin,
  getCancellationRequesterNameForAdmin,
  getCampaignForEventAdmin,
  computeSuggestedCancellationAmount,
  type CampaignForCancellationAdmin,
  type CancellationRequestForAdmin,
} from '@/lib/data/event-cancellation';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { cancellationFeeBase } from '@/lib/data/cancellation-fee';
import { cancellationReference } from '@/lib/data/cancellation-reference';
import { EVENT_STATUS_LABELS } from '@/lib/data/event-labels';
import { packageCancellationState, type PackageCancellationState } from '@/lib/data/package-cancellation';
import { campaignPaymentsView, type CampaignPaymentsView } from '@/lib/payments/campaign-payments-view';
import type { PackageRefundAttempt } from '@/lib/payments/package-refund-types';
import { isOpenCeilingAgreementVersion } from '@/lib/agreements/template';
import { computeChargeAmount } from '@/lib/data/close-charge-amount';
import { formatIsraelDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { Badge, formatCurrency, formatDateTime } from '../../_components';
import { ResolveForm, type MoneyOutcome } from './resolve-form';

export const metadata: Metadata = { title: 'בקשת ביטול' };

const LIST_PATH = '/admin/cancellations';

const RESOLUTION_LABELS: Record<string, string> = {
  full_cancellation: 'ביטול מלא',
  partial_charge: 'ביטול עם דמי ביטול',
  declined: 'נדחתה',
};

// What the form's confirmation tells the admin for each state of a package's money (see packageCancellationState).
const PACKAGE_MONEY_OUTCOME: Record<PackageCancellationState, MoneyOutcome> = {
  refund: 'credit',
  no_card: 'blocked',
  unreadable: 'blocked',
  nothing_to_refund: 'none',
  resume: 'resume',
};

// No clearing company is named: the same words serve a SUMIT and a CardCom payment.
const CAPTURE_OUTCOME_LABELS: Record<string, string> = {
  captured: 'בוצע חיוב',
  refunded: 'בוצע זיכוי',
  manual_refund_required: 'נדרש זיכוי ידני במסוף הסליקה',
  not_applicable: 'אין תנועה כספית',
};

// The event's status as the rest of the admin names it; an unknown value is shown as it is.
function eventStatusText(status: string): string {
  return Object.hasOwn(EVENT_STATUS_LABELS, status) ? EVENT_STATUS_LABELS[status as keyof typeof EVENT_STATUS_LABELS] : status;
}

// The notes above the decision. Three tones: money will move (warning), it cannot be moved from here (destructive), nothing
// moves (muted). role="note": part of the page, not an announcement (Alert defaults to role="alert"); a refused attempt is an
// alert.
type Tone = 'warning' | 'destructive' | 'muted';
const TONE_CLASS: Record<Tone, string> = {
  warning: 'border-warning/40 bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive',
  muted: 'border-border bg-muted text-foreground',
};
function MoneyNote({
  tone,
  title,
  icon,
  role = 'note',
  children,
}: {
  tone: Tone;
  title: string;
  icon?: LucideIcon;
  role?: 'note' | 'alert';
  children: React.ReactNode;
}) {
  const Icon = icon ?? (tone === 'muted' ? Info : TriangleAlert);
  return (
    <Alert role={role} className={cn('rounded-xl px-4 py-4', TONE_CLASS[tone])}>
      <Icon aria-hidden />
      <AlertTitle className="font-bold">{title}</AlertTitle>
      <AlertDescription className="space-y-1 leading-relaxed">{children}</AlertDescription>
    </Alert>
  );
}

// The last refund attempt of this request that did not end in a refund: refused (the reason it gave, its code), unclear
// (the money may be back — check before anything else), or still running.
function LastAttemptNote({ attempt }: { attempt: PackageRefundAttempt }) {
  const when = formatDateTime(attempt.recordedAt);
  if (attempt.outcome === 'failed') {
    return (
      <MoneyNote tone="destructive" role="alert" icon={CircleX} title={`ניסיון ההחזר הקודם נדחה (${when})`}>
        <p>
          {attempt.providerStatusDescription
            ? `חברת הסליקה ענתה: "${attempt.providerStatusDescription}"`
            : 'חברת הסליקה לא מסרה סיבה'}
          {attempt.providerStatus ? ` · קוד ${attempt.providerStatus}` : ''}. לא הוחזר כסף.
        </p>
        <p className="font-semibold">תקנו את הסיבה אצל חברת הסליקה ואשרו שוב.</p>
      </MoneyNote>
    );
  }
  if (attempt.outcome === 'review') {
    return (
      <MoneyNote tone="warning" role="alert" title={`ניסיון ההחזר הקודם בבדיקה (${when})`}>
        <p>התשובה של חברת הסליקה לא הייתה חד-משמעית — ייתכן שהכסף כבר הוחזר.</p>
        <p className="font-semibold">בדקו אצלה ובמסך התשלומים שממתינים להכרעה, ואל תאשרו שוב.</p>
      </MoneyNote>
    );
  }
  return (
    <MoneyNote tone="muted" title={`ניסיון החזר בתהליך (${when})`}>
      <p>ניסיון קודם של הבקשה הזו עדיין רץ. המתינו ורעננו את הדף.</p>
    </MoneyNote>
  );
}

function SectionTitle({ icon: Icon, children, id }: { icon: LucideIcon; children: React.ReactNode; id: string }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-base font-semibold">
      <Icon aria-hidden className="size-[18px] shrink-0 text-primary" />
      {children}
    </h2>
  );
}

const CARD = 'rounded-xl border border-border bg-card p-5';

function RequestDetails({ request }: { request: CancellationRequestForAdmin }) {
  return (
    <section aria-labelledby="req-h" className={cn(CARD, 'space-y-4')}>
      <SectionTitle icon={FileText} id="req-h">
        פרטי הבקשה
      </SectionTitle>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-[15px]">
        <dt className="text-muted-foreground">אירוע</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{request.eventName || '—'}</span>
          <Badge>{eventStatusText(request.eventStatus)}</Badge>
        </dd>
        <dt className="text-muted-foreground">הוגשה</dt>
        <dd>{formatDateTime(request.createdAt)}</dd>
        {request.resolvedAt ? (
          <>
            <dt className="text-muted-foreground">טופלה</dt>
            <dd>{formatDateTime(request.resolvedAt)}</dd>
          </>
        ) : null}
      </dl>
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">סיבת הביטול, כפי שכתב הלקוח</p>
        <blockquote className="whitespace-pre-wrap rounded-lg bg-muted px-3.5 py-3 text-[15px] leading-relaxed">
          {request.reason}
        </blockquote>
      </div>
    </section>
  );
}

// The campaign's operations from the ledger — every attempt, the failed ones too, each with what the clearing company
// answered — but without the technical section: this page names no clearing company. The full record is on the campaign page.
function Payments({
  view,
  refundable,
  campaignHref,
}: {
  view: CampaignPaymentsView | null;
  refundable: number | null;
  campaignHref: string | null;
}) {
  if (!view || view.audience !== 'staff') return null;
  return (
    <CampaignPayments
      audience="staff"
      facts={false}
      operations={view.operations}
      summary={
        refundable != null ? (
          <>
            נותר להחזרה: <strong className="text-foreground">{formatCurrency(refundable)}</strong>
          </>
        ) : undefined
      }
      footer={
        campaignHref ? (
          <Link
            href={`${campaignHref}#campaign-payments-title`}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            כל פרטי התשלום בעמוד הקמפיין
            <ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />
          </Link>
        ) : null
      }
    />
  );
}

// The three amounts of a package that was refunded. The fee is what was paid minus what went back — the request row keeps
// the REFUNDED amount in resolution_amount for a package (measured 9.10.2026), so it is never read as the fee.
function MoneyCubes({ paid, refunded, showFee }: { paid: number; refunded: number; showFee: boolean }) {
  const cubes: { label: string; value: number; Icon: LucideIcon; strong?: boolean }[] = [
    { label: 'שולם', value: paid, Icon: CreditCard },
    ...(showFee ? [{ label: 'דמי ביטול', value: Math.round((paid - refunded) * 100) / 100, Icon: Percent }] : []),
    { label: 'הוחזר לכרטיס', value: refunded, Icon: Undo2, strong: true },
  ];
  return (
    <dl className={cn('grid gap-2 sm:gap-3', showFee ? 'grid-cols-3' : 'grid-cols-2')}>
      {cubes.map((c) => (
        <div key={c.label} className={cn('flex flex-col gap-1.5 rounded-[10px] p-2.5 sm:p-3.5', c.strong ? 'bg-primary/10' : 'bg-muted')}>
          <dt className={cn('flex items-center gap-1.5 text-xs sm:text-[13px]', c.strong ? 'text-primary' : 'text-muted-foreground')}>
            <c.Icon aria-hidden className="size-3.5 shrink-0" />
            {c.label}
          </dt>
          <dd className={cn('text-base font-bold sm:text-xl', c.strong && 'text-primary')}>{formatCurrency(c.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

type Step = { Icon: LucideIcon; tone: 'muted' | 'primary' | 'success'; title: string; at: string };
const STEP_TONE: Record<Step['tone'], string> = {
  muted: 'bg-muted text-foreground/80',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
};

// What happened to the request, from recorded facts only: when it was filed (created_at), when staff resolved it
// (resolved_at), when the money went back (the ledger's refund for THIS request), and the e-mail — which the resolve flow
// sends before it writes resolved_at, so a resolved request was e-mailed by then. No step is shown without its fact.
function timelineOf(request: CancellationRequestForAdmin, refund: { amount: number; at: string } | null): Step[] {
  const steps: Step[] = [{ Icon: User, tone: 'muted', title: 'הלקוח הגיש בקשה', at: request.createdAt }];
  if (!request.resolvedAt) return steps;
  const declined = request.resolution === 'declined';
  steps.push({
    Icon: ShieldCheck,
    tone: 'primary',
    title: declined ? 'איש צוות דחה את הבקשה' : `איש צוות אישר ${RESOLUTION_LABELS[request.resolution ?? ''] ?? ''}`.trim(),
    at: request.resolvedAt,
  });
  if (refund) {
    steps.push({ Icon: Undo2, tone: 'success', title: `${formatCurrency(refund.amount)} הוחזרו לכרטיס והופק מסמך זיכוי`, at: refund.at });
  }
  steps.push({
    Icon: Mail,
    tone: 'muted',
    title: declined ? 'נשלח מייל ללקוח' : 'נשלח מייל ללקוח, האירוע נסגר',
    at: request.resolvedAt,
  });
  return steps;
}

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <section aria-labelledby="tl-h" className={cn(CARD, 'space-y-3.5')}>
      <SectionTitle icon={History} id="tl-h">
        מה קרה בבקשה
      </SectionTitle>
      <ol className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-1">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', STEP_TONE[s.tone])}>
              <s.Icon aria-hidden className="size-3.5" />
            </span>
            <span className="flex flex-col gap-0.5">
              <strong className="font-semibold">{s.title}</strong>
              <span className="text-muted-foreground">{formatDateTime(s.at)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function AdminCancellationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformPermission('manage_billing');
  const { id } = await params;
  // The segment is whatever was typed in the address bar. A request's id is a uuid, and anything else is no request at
  // all: a 404 here, before the database is asked (which refuses a non-uuid with an error the reader would turn into
  // "could not load" — measured 9.10.2026: "14" and "abc" both came back as 22P02).
  if (!z.uuid().safeParse(id).success) notFound();
  // A failed read throws to the admin error boundary (retry); only a request that does not exist is a 404.
  const request = await getCancellationRequestForAdmin(id);
  if (!request) notFound();

  // A failed campaign read must never pass for "no live campaign" (that would promise no money moves): the screen says it
  // could not be read and offers no decision until it can.
  let campaign: CampaignForCancellationAdmin | null = null;
  let campaignFailed = false;
  try {
    campaign = await getCampaignForEventAdmin(request.eventId, request.id);
  } catch (err) {
    unstable_rethrow(err);
    campaignFailed = true;
  }

  // The requester's name for the header; a failed read only drops the name (it decides nothing).
  let requesterName: string | null = null;
  try {
    requesterName = await getCancellationRequesterNameForAdmin(request.ownerId);
  } catch (err) {
    unstable_rethrow(err);
  }
  const paymentsView = campaign ? await campaignPaymentsView(request.eventId, campaign.id) : null;

  // A fixed-price package was paid once, at purchase: resolving the request gives money BACK from the payment ledger. It
  // has no per-result charge, so none of the "not charged yet" logic below applies to it.
  const isPackage = campaign?.isPackage === true;
  const isPreCharge = !isPackage && (!campaign || campaign.chargeStatus !== 'charged');
  const packagePaid = isPackage ? (campaign?.packagePaid ?? 0) : null;
  const packageState = isPackage && campaign
    ? packageCancellationState({
        unreadable: campaign.packageUnreadable,
        paid: campaign.packagePaid,
        hasCard: campaign.hasCardOnFile,
        refundedForRequest: campaign.packageRefundedForRequest,
      })
    : null;
  // An event with no live campaign (it never had one, or every campaign was cancelled): the resolver moves no money for it.
  const noLiveCampaign = !campaignFailed && campaign === null;
  const moneyOutcome: MoneyOutcome = packageState
    ? PACKAGE_MONEY_OUTCOME[packageState]
    : noLiveCampaign
      ? 'no_campaign'
      : isPreCharge
        ? 'capture'
        : campaign?.hasCardOnFile
          ? 'credit'
          : 'manual';
  const billingSummary = campaign && !isPackage ? await getCampaignBillingSummary(campaign.id) : null;
  const suggestedAmount = campaign
    ? await computeSuggestedCancellationAmount(campaign.id, isPackage ? (packagePaid ?? 0) : undefined)
    : 0;
  // What a percentage fee is taken of — decided here on the server; 0 = none (an open-ceiling agreement that was not
  // charged yet), and then the form offers only an amount in shekels.
  const feeBase = campaign
    ? cancellationFeeBase({
        chargeStatus: campaign.chargeStatus,
        finalChargeAmount: campaign.finalChargeAmount,
        maxChargeCeiling: campaign.maxChargeCeiling,
        packagePaid,
      })
    : 0;
  const feeBaseLabel = isPackage ? 'הסכום ששולם' : campaign?.chargeStatus === 'charged' ? 'הסכום שחויב' : 'תקרת הקמפיין';
  // The RPC's own `accrued` is base/overage-blind (verified gap, 2026-08-28) —
  // fold in the campaign's actual base/included/overage terms via the same
  // pure formula close-charge.ts uses at settlement, same fix as the
  // customer's campaign-manage page.
  const accrued =
    billingSummary && campaign
      ? computeChargeAmount({
          base: campaign.basePrice,
          included: campaign.includedReached,
          overage: campaign.pricePerReached,
          reached: billingSummary.reachedCount,
          ceiling: isOpenCeilingAgreementVersion(campaign.tosVersion) ? null : billingSummary.ceiling,
          credits: 0,
        }).amount
      : 0;
  const pending = request.status === 'pending';
  // From the ledger: how THIS request's last refund attempt ended. A refused refund shows the clearing company's own reason
  // here (staff only), so the admin knows what to fix before approving again.
  const lastAttempt = campaign?.packageRecord?.lastRefundAttempt ?? null;
  const campaignHref = campaign ? `/app/events/${request.eventId}/campaign/${campaign.id}` : null;
  // A package's money back for THIS request: what the ledger recorded as returned, when, and its credit document.
  const refunded = campaign?.packageRefundedForRequest ?? 0;
  const refundStep =
    isPackage && refunded > 0 && lastAttempt?.outcome === 'succeeded' ? { amount: refunded, at: lastAttempt.recordedAt } : null;
  const refundDocument = campaign?.packageRefundDocument ?? null;

  return (
    <div className="space-y-6">
      <Link
        href={LIST_PATH}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" />
        כל בקשות הביטול
      </Link>

      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-[28px]">
            בקשת ביטול <bdi>{cancellationReference(request.requestCode)}</bdi>
          </h1>
          <Badge variant={pending ? 'warning' : 'success'} className="h-6 px-2.5 text-[13px] font-semibold">
            {pending ? <Clock aria-hidden /> : <Check aria-hidden />}
            {pending ? 'ממתינה להחלטה' : 'טופלה'}
          </Badge>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground/80">
          {requesterName ? (
            <li className="flex items-center gap-1.5">
              <User aria-hidden className="size-4 shrink-0" />
              {requesterName}
            </li>
          ) : null}
          {request.eventDate ? (
            <li className="flex items-center gap-1.5">
              <CalendarDays aria-hidden className="size-4 shrink-0" />
              האירוע ב-{formatIsraelDate(request.eventDate)}
            </li>
          ) : null}
          {campaign?.contactQuota != null ? (
            <li className="flex items-center gap-1.5">
              <ShoppingBag aria-hidden className="size-4 shrink-0" />
              חבילה · {campaign.contactQuota.toLocaleString('he-IL')} אנשי קשר
            </li>
          ) : null}
        </ul>
      </header>

      <div className="flex flex-wrap items-start gap-6">
        <aside className="flex min-w-0 flex-[1_1_20rem] flex-col gap-4 max-lg:flex-[1_1_100%] max-lg:md:grid max-lg:md:grid-cols-2 max-lg:md:items-start">
          <RequestDetails request={request} />
          <Payments view={paymentsView} refundable={isPackage ? (campaign?.packageRefundable ?? null) : null} campaignHref={campaignHref} />
          {billingSummary ? (
            <section aria-labelledby="billing-h" className={cn(CARD, 'space-y-2')}>
              <SectionTitle icon={CreditCard} id="billing-h">
                חיוב לפי תוצאה
              </SectionTitle>
              <p className="text-sm text-muted-foreground">
                {billingSummary.reachedCount} אנשי קשר הושגו · נצבר {formatCurrency(accrued)}
                {campaign && !isOpenCeilingAgreementVersion(campaign.tosVersion)
                  ? ` מתוך תקרה ${formatCurrency(billingSummary.ceiling)}`
                  : ''}
              </p>
            </section>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-[999_1_32rem] flex-col gap-4">
          {campaignFailed ? (
            <Alert variant="destructive" className="rounded-xl border-destructive/40 px-4 py-4">
              <CircleAlert aria-hidden />
              <AlertTitle className="font-semibold">לא הצלחנו לטעון את נתוני הקמפיין</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  {pending
                    ? 'אי אפשר לדעת עכשיו אם האישור יזיז כסף, ולכן טופס ההחלטה מוסתר. נסו לטעון שוב.'
                    : 'פרטי התשלום של הבקשה לא נטענו. נסו לטעון שוב.'}
                </p>
                <Link href={`${LIST_PATH}/${request.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  טעינה מחדש
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}

          {pending && !campaignFailed ? (
            <>
              {lastAttempt && lastAttempt.outcome !== 'succeeded' ? <LastAttemptNote attempt={lastAttempt} /> : null}
              {packageState === 'unreadable' ? (
                <MoneyNote tone="destructive" title="לא ניתן לקרוא כרגע את נתוני התשלום">
                  <p>אפשר לדחות את הבקשה, אבל לא לבצע החזר. רעננו את הדף ונסו שוב.</p>
                </MoneyNote>
              ) : packageState === 'resume' ? (
                <MoneyNote tone="warning" title={`כבר הוחזרו ${formatCurrency(campaign?.packageRefundedForRequest ?? 0)} בבקשה הזו`}>
                  <p>
                    טיפול קודם נקטע לפני שהסתיים. אישור ישלים אותו — סגירת הקמפיין והאירוע ועדכון הלקוח — בלי להחזיר שוב. הלקוח
                    יקבל הודעה לפי מה שהוחזר בפועל, לא לפי מה שיוזן כאן; אי אפשר לדחות בקשה שכבר הוחזר בה כסף.
                  </p>
                </MoneyNote>
              ) : packageState === 'refund' ? (
                <MoneyNote tone="warning" title="האישור יחזיר כסף לכרטיס מיד">
                  <p>
                    &quot;ביטול מלא&quot; מחזיר את כל {formatCurrency(packagePaid ?? 0)}. &quot;ביטול עם דמי ביטול&quot; מחזיר את
                    ההפרש. בשני המקרים יופק מסמך זיכוי, הקמפיין והאירוע ייסגרו, והלקוח יקבל מייל אחרי שההחזר אושר.
                  </p>
                </MoneyNote>
              ) : packageState === 'no_card' ? (
                <MoneyNote tone="destructive" title="לא ניתן להחזיר את התשלום הזה מכאן">
                  <p>
                    שולמו {formatCurrency(packagePaid ?? 0)}, אך אין לתשלום כרטיס שמור להחזיר אליו, סוג המסמך שלו אינו מאפשר מסמך
                    זיכוי אוטומטי, או שהוא בוצע במסוף אחר מזה שמחובר עכשיו — אישור שיש בו סכום להחזרה ייכשל בהודעה ולא ישנה דבר.
                    החזירו ידנית במסוף הסליקה, או דחו את הבקשה.
                  </p>
                </MoneyNote>
              ) : packageState === 'nothing_to_refund' ? (
                <MoneyNote tone="muted" title="אין מה להחזיר">
                  <p>
                    בקמפיין החבילה לא שולם דבר (או שהכול כבר הוחזר). אישור &quot;ביטול מלא&quot; יסגור את הקמפיין והאירוע בלי
                    תנועה כספית.
                  </p>
                </MoneyNote>
              ) : noLiveCampaign ? (
                <MoneyNote tone="muted" title="לאירוע אין קמפיין פעיל">
                  <p>ייתכן שהקמפיין בוטל. אישור הבקשה לא יזיז כסף, והאירוע ייסגר.</p>
                </MoneyNote>
              ) : isPreCharge ? (
                <MoneyNote tone="warning" title="האישור יחייב את הכרטיס מיד">
                  <p>
                    הקמפיין טרם חויב — אישור &quot;ביטול מלא&quot; או &quot;ביטול עם דמי ביטול&quot; כאן יבצע חיוב אמיתי בכרטיס
                    מיד.
                  </p>
                </MoneyNote>
              ) : campaign?.hasCardOnFile ? (
                <MoneyNote tone="warning" title="האישור יחזיר כסף לכרטיס מיד">
                  <p>קמפיין זה כבר חויב ויש פרטי כרטיס שמורים, אז אישור כאן יבצע זיכוי אוטומטי לכרטיס מיד, לא חיוב.</p>
                </MoneyNote>
              ) : (
                <MoneyNote tone="destructive" title="אין כרטיס שמור — נדרש זיכוי ידני">
                  <p>
                    קמפיין זה כבר חויב ואין פרטי כרטיס שמורים. אישור כאן ירשום &quot;נדרש זיכוי ידני&quot; בלבד; את ההחזר בפועל
                    מבצעים ידנית במסוף הסליקה.
                  </p>
                </MoneyNote>
              )}
              <ResolveForm
                requestId={request.id}
                suggestedAmount={suggestedAmount}
                moneyOutcome={moneyOutcome}
                feeBase={feeBase}
                feeBaseLabel={feeBaseLabel}
              />
            </>
          ) : null}

          {!pending ? (
            <section aria-labelledby="out-h" className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-3.5 border-b border-success/20 bg-success/10 px-5 py-4 text-success sm:px-6">
                <CircleCheck aria-hidden className="size-7 shrink-0" />
                <div className="space-y-0.5">
                  <h2 id="out-h" className="text-lg font-bold">
                    {RESOLUTION_LABELS[request.resolution ?? ''] ?? request.resolution}
                  </h2>
                  {isPackage && refunded > 0 ? (
                    <p className="text-sm">
                      הוחזרו {formatCurrency(refunded)} לכרטיס של הלקוח
                      {request.resolution === 'partial_charge' && packagePaid != null
                        ? ` · נשארו דמי ביטול של ${formatCurrency(Math.round((packagePaid - refunded) * 100) / 100)}`
                        : ''}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="space-y-4 p-5 sm:p-6">
                {isPackage && packagePaid != null && refunded > 0 ? (
                  <MoneyCubes paid={packagePaid} refunded={refunded} showFee={request.resolution === 'partial_charge'} />
                ) : (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-[15px]">
                    <dt className="text-muted-foreground">תנועה כספית</dt>
                    <dd>{CAPTURE_OUTCOME_LABELS[request.captureOutcome ?? ''] ?? request.captureOutcome}</dd>
                    {!isPackage && request.resolutionAmount != null ? (
                      <>
                        <dt className="text-muted-foreground">סכום</dt>
                        <dd className="font-semibold">{formatCurrency(request.resolutionAmount)}</dd>
                      </>
                    ) : null}
                  </dl>
                )}
                {refundDocument?.number != null || refundDocument?.url || request.sumitDocumentUrl ? (
                  <DocumentCard
                    number={refundDocument?.number ?? null}
                    url={refundDocument?.url ?? request.sumitDocumentUrl}
                    amount={isPackage && refunded > 0 ? refunded : null}
                  />
                ) : null}
              </div>
            </section>
          ) : null}

          {!pending ? <Timeline steps={timelineOf(request, refundStep)} /> : null}

          {!pending && request.resolutionNote ? (
            <section aria-labelledby="note-h" className={cn(CARD, 'space-y-2.5')}>
              <SectionTitle icon={Mail} id="note-h">
                ההודעה שנשלחה ללקוח
              </SectionTitle>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{request.resolutionNote}</p>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

// The credit document of the request, as a card. A link only to an https address; otherwise the number alone.
function DocumentCard({ number, url, amount }: { number: number | null; url: string | null; amount: number | null }) {
  const href = url && /^https:\/\//i.test(url) ? url : null;
  const label = `מסמך זיכוי${number != null ? ` מס׳ ${number}` : ''}${amount != null ? ` · ${formatCurrency(amount)}` : ''}`;
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
        <FileText aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1 font-semibold">{label}</span>
      {href ? (
        <>
          <ExternalLink aria-hidden className="size-4 shrink-0" />
          <span className="sr-only">(נפתח בלשונית חדשה)</span>
        </>
      ) : null}
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 items-center gap-3 rounded-[10px] border border-border p-3.5 text-primary hover:bg-muted/50"
    >
      {body}
    </a>
  ) : (
    <div className="flex items-center gap-3 rounded-[10px] border border-border p-3.5">{body}</div>
  );
}
