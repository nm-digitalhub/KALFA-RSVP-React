import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, unstable_rethrow } from 'next/navigation';
import { ArrowRight, CircleAlert, CircleCheck, CreditCard, FileText, Info, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  getCancellationRequestForAdmin,
  getCampaignForEventAdmin,
  computeSuggestedCancellationAmount,
  type CampaignForCancellationAdmin,
} from '@/lib/data/event-cancellation';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { cancellationFeeBase } from '@/lib/data/cancellation-fee';
import { EVENT_STATUS_LABELS } from '@/lib/data/event-labels';
import { packageCancellationState, type PackageCancellationState } from '@/lib/data/package-cancellation';
import type { PackageRefundAttempt } from '@/lib/payments/package-refund-types';
import { isOpenCeilingAgreementVersion } from '@/lib/agreements/template';
import { computeChargeAmount } from '@/lib/data/close-charge-amount';
import { cn } from '@/lib/utils';
import { PageHeading, Badge, formatCurrency, formatDateTime } from '../../_components';
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

// The note above the decision. Three tones: money will move (warning), it cannot be moved from here (destructive), nothing
// moves (muted). role="note": it is part of the page, not an announcement (Alert defaults to role="alert").
type Tone = 'warning' | 'destructive' | 'muted';
const TONE_CLASS: Record<Tone, string> = {
  warning: 'border-warning/40 bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive',
  muted: 'border-border bg-muted text-foreground',
};
function MoneyNote({ tone, title, children }: { tone: Tone; title: string; children: React.ReactNode }) {
  const Icon = tone === 'muted' ? Info : TriangleAlert;
  return (
    <Alert role="note" className={cn('px-4 py-3', TONE_CLASS[tone])}>
      <Icon aria-hidden />
      <AlertTitle className="font-semibold">{title}</AlertTitle>
      <AlertDescription className="leading-relaxed">{children}</AlertDescription>
    </Alert>
  );
}

// The last refund attempt of this request that did not end in a refund: refused (the reason it gave, its code), unclear
// (the money may be back — check before anything else), or still running.
function LastAttemptNote({ attempt }: { attempt: PackageRefundAttempt }) {
  const when = formatDateTime(attempt.recordedAt);
  if (attempt.outcome === 'failed') {
    return (
      <MoneyNote tone="destructive" title={`ניסיון הזיכוי האחרון נדחה (${when})`}>
        {attempt.providerStatusDescription ?? 'חברת הסליקה לא מסרה סיבה.'}
        {attempt.providerStatus ? ` · קוד ${attempt.providerStatus}` : ''}. לא הוחזר כסף. תקנו את הסיבה ואשרו שוב.
      </MoneyNote>
    );
  }
  if (attempt.outcome === 'review') {
    return (
      <MoneyNote tone="warning" title={`ניסיון הזיכוי האחרון בבדיקה (${when})`}>
        התשובה של חברת הסליקה לא הייתה חד-משמעית — ייתכן שהכסף כבר הוחזר. בדקו אצלה ובמסך התשלומים שממתינים להכרעה, ואל
        תאשרו שוב.
      </MoneyNote>
    );
  }
  return (
    <MoneyNote tone="muted" title={`ניסיון זיכוי בתהליך (${when})`}>
      ניסיון קודם של הבקשה הזו עדיין רץ. המתינו ורעננו את הדף.
    </MoneyNote>
  );
}

export default async function AdminCancellationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformPermission('manage_billing');
  const { id } = await params;
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
  // From the ledger: the receipt the purchase issued, and how THIS request's last refund attempt ended. A refused refund
  // shows the clearing company's own reason here (staff only), so the admin knows what to fix before approving again.
  const purchaseDocumentNumber = campaign?.packageRecord?.purchaseDocument?.number ?? null;
  const lastAttempt = pending ? (campaign?.packageRecord?.lastRefundAttempt ?? null) : null;

  return (
    <div className="space-y-6">
      <Link
        href={LIST_PATH}
        className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" />
        כל בקשות הביטול
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <PageHeading>בקשת ביטול #{request.requestNumber}</PageHeading>
        <Badge variant={pending ? 'warning' : 'success'}>{pending ? 'ממתינה להחלטה' : 'טופלה'}</Badge>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <aside className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>פרטי הבקשה</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">אירוע</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{request.eventName || '—'}</span>
                  <Badge>{eventStatusText(request.eventStatus)}</Badge>
                </dd>
                <dt className="text-muted-foreground">הוגשה</dt>
                <dd>{formatDateTime(request.createdAt)}</dd>
              </dl>
              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">סיבת הביטול, כפי שכתב הלקוח</p>
                <blockquote className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed">
                  {request.reason}
                </blockquote>
              </div>
            </CardContent>
          </Card>

          {isPackage && campaign && !campaign.packageUnreadable ? (
            <Card>
              <CardHeader>
                <CardTitle>תשלום</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">חבילה בתשלום אחד · שולם</span>
                  <span className="text-xl font-bold">{formatCurrency(packagePaid ?? 0)}</span>
                </div>
                {campaign.packageRefundable != null && campaign.packageRefundable !== packagePaid ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">נותר להחזרה</span>
                    <span className="font-semibold">{formatCurrency(campaign.packageRefundable)}</span>
                  </div>
                ) : null}
                {purchaseDocumentNumber != null ? (
                  <p className="flex items-center gap-2">
                    <FileText aria-hidden className="size-4 shrink-0" />
                    {`קבלה מס׳ ${purchaseDocumentNumber}`}
                  </p>
                ) : null}
                <p className="flex items-center gap-2">
                  <CreditCard aria-hidden className="size-4 shrink-0" />
                  {campaign.hasCardOnFile ? 'כרטיס שמור — אפשר להחזיר אוטומטית' : 'אין החזר אוטומטי לתשלום הזה'}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {billingSummary ? (
            <Card>
              <CardHeader>
                <CardTitle>חיוב לפי תוצאה</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {billingSummary.reachedCount} אנשי קשר הושגו · נצבר {formatCurrency(accrued)}
                {campaign && !isOpenCeilingAgreementVersion(campaign.tosVersion)
                  ? ` מתוך תקרה ${formatCurrency(billingSummary.ceiling)}`
                  : ''}
              </CardContent>
            </Card>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-[999_1_32rem] flex-col gap-4">
          {campaignFailed ? (
            <Alert variant="destructive" className="border-destructive/40 px-4 py-3">
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
              {lastAttempt && lastAttempt.outcome !== 'succeeded' ? (
                <LastAttemptNote attempt={lastAttempt} />
              ) : null}
              {packageState === 'unreadable' ? (
                <MoneyNote tone="destructive" title="לא ניתן לקרוא כרגע את נתוני התשלום">
                  אפשר לדחות את הבקשה, אבל לא לבצע החזר. רעננו את הדף ונסו שוב.
                </MoneyNote>
              ) : packageState === 'resume' ? (
                <MoneyNote tone="warning" title={`כבר הוחזרו ${formatCurrency(campaign?.packageRefundedForRequest ?? 0)} בבקשה הזו`}>
                  טיפול קודם נקטע לפני שהסתיים. אישור ישלים אותו — סגירת הקמפיין והאירוע ועדכון הלקוח — בלי להחזיר שוב. הלקוח
                  יקבל הודעה לפי מה שהוחזר בפועל, לא לפי מה שיוזן כאן; אי אפשר לדחות בקשה שכבר הוחזר בה כסף.
                </MoneyNote>
              ) : packageState === 'refund' ? (
                <MoneyNote tone="warning" title="האישור יחזיר כסף לכרטיס מיד">
                  קמפיין חבילה ששולם ({formatCurrency(packagePaid ?? 0)}) — אישור &quot;ביטול מלא&quot; יחזיר אוטומטית לכרטיס את
                  הסכום המלא, ו&quot;ביטול עם דמי ביטול&quot; יחזיר את ההפרש, ויופק מסמך זיכוי. הקמפיין והאירוע ייסגרו, והלקוח יקבל
                  מייל אחרי שההחזר אושר.
                </MoneyNote>
              ) : packageState === 'no_card' ? (
                <MoneyNote tone="destructive" title="לא ניתן להחזיר את התשלום הזה מכאן">
                  שולמו {formatCurrency(packagePaid ?? 0)}, אך אין לתשלום כרטיס שמור להחזיר אליו, סוג המסמך שלו אינו מאפשר מסמך זיכוי
                  אוטומטי, או שהוא בוצע במסוף אחר מזה שמחובר עכשיו — אישור שיש בו סכום להחזרה ייכשל בהודעה ולא ישנה דבר. החזירו
                  ידנית במסוף הסליקה, או דחו את הבקשה.
                </MoneyNote>
              ) : packageState === 'nothing_to_refund' ? (
                <MoneyNote tone="muted" title="אין מה להחזיר">
                  בקמפיין החבילה לא שולם דבר (או שהכול כבר הוחזר). אישור &quot;ביטול מלא&quot; יסגור את הקמפיין והאירוע בלי תנועה
                  כספית.
                </MoneyNote>
              ) : noLiveCampaign ? (
                <MoneyNote tone="muted" title="לאירוע אין קמפיין פעיל">
                  ייתכן שהקמפיין בוטל. אישור הבקשה לא יזיז כסף, והאירוע ייסגר.
                </MoneyNote>
              ) : isPreCharge ? (
                <MoneyNote tone="warning" title="האישור יחייב את הכרטיס מיד">
                  הקמפיין טרם חויב — אישור &quot;ביטול מלא&quot; או &quot;ביטול עם דמי ביטול&quot; כאן יבצע חיוב אמיתי בכרטיס מיד.
                </MoneyNote>
              ) : campaign?.hasCardOnFile ? (
                <MoneyNote tone="warning" title="האישור יחזיר כסף לכרטיס מיד">
                  קמפיין זה כבר חויב ויש פרטי כרטיס שמורים, אז אישור כאן יבצע זיכוי אוטומטי לכרטיס מיד, לא חיוב.
                </MoneyNote>
              ) : (
                <MoneyNote tone="destructive" title="אין כרטיס שמור — נדרש זיכוי ידני">
                  קמפיין זה כבר חויב ואין פרטי כרטיס שמורים. אישור כאן ירשום &quot;נדרש זיכוי ידני&quot; בלבד; את ההחזר בפועל
                  מבצעים ידנית במסוף הסליקה.
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
            <Card className="overflow-hidden pt-0">
              <div className="flex items-center gap-3 border-b border-success/20 bg-success/10 px-6 py-4 text-success">
                <CircleCheck aria-hidden className="size-6 shrink-0" />
                <div>
                  <p className="text-lg font-bold">{RESOLUTION_LABELS[request.resolution ?? ''] ?? request.resolution}</p>
                  {request.resolutionAmount != null ? (
                    <p className="text-sm">{formatCurrency(request.resolutionAmount)}</p>
                  ) : null}
                </div>
              </div>
              <CardContent>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">תוצאה</dt>
                  <dd className="font-medium">{RESOLUTION_LABELS[request.resolution ?? ''] ?? request.resolution}</dd>
                  {request.resolutionAmount != null ? (
                    <>
                      <dt className="text-muted-foreground">סכום</dt>
                      <dd className="font-semibold">{formatCurrency(request.resolutionAmount)}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">תנועה כספית</dt>
                  <dd>{CAPTURE_OUTCOME_LABELS[request.captureOutcome ?? ''] ?? request.captureOutcome}</dd>
                  {/* A package refund's credit document is read from the ledger: CardCom answers only its number (no link),
                      and the request row keeps a SUMIT link only. */}
                  {campaign?.packageRefundDocument?.number != null && !request.sumitDocumentUrl ? (
                    <>
                      <dt className="text-muted-foreground">מסמך זיכוי</dt>
                      <dd className="flex items-center gap-1.5">
                        <FileText aria-hidden className="size-4 shrink-0" />
                        {`מס׳ ${campaign.packageRefundDocument.number}`}
                      </dd>
                    </>
                  ) : null}
                  {request.sumitDocumentUrl ? (
                    <>
                      <dt className="text-muted-foreground">מסמך</dt>
                      <dd>
                        <a
                          href={request.sumitDocumentUrl}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText aria-hidden className="size-4 shrink-0" />
                          קבלה / תעודת זיכוי
                          <span className="sr-only">(נפתח בלשונית חדשה)</span>
                        </a>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {!pending && request.resolutionNote ? (
            <Card>
              <CardHeader>
                <CardTitle>ההודעה שנשלחה ללקוח</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">{request.resolutionNote}</CardContent>
            </Card>
          ) : null}
        </main>
      </div>
    </div>
  );
}
