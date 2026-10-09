import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  getCancellationRequestForAdmin,
  getCampaignForEventAdmin,
  computeSuggestedCancellationAmount,
} from '@/lib/data/event-cancellation';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { cancellationFeeBase } from '@/lib/data/cancellation-fee';
import { packageCancellationState, type PackageCancellationState } from '@/lib/data/package-cancellation';
import { isOpenCeilingAgreementVersion } from '@/lib/agreements/template';
import { computeChargeAmount } from '@/lib/data/close-charge-amount';
import { PageHeading, Badge, formatCurrency, formatDateTime } from '../../_components';
import { ResolveForm, type MoneyOutcome } from './resolve-form';

export const metadata: Metadata = { title: 'בקשת ביטול' };

const RESOLUTION_LABELS: Record<string, string> = {
  full_cancellation: 'ביטול מלא',
  partial_charge: 'חיוב חלקי',
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

const CAPTURE_OUTCOME_LABELS: Record<string, string> = {
  captured: 'בוצע חיוב',
  refunded: 'בוצע זיכוי',
  manual_refund_required: 'נדרש זיכוי ידני ב-SUMIT',
  not_applicable: 'אין תנועה כספית',
};

export default async function AdminCancellationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformPermission('manage_billing');
  const { id } = await params;
  const request = await getCancellationRequestForAdmin(id);
  if (!request) notFound();

  const campaign = await getCampaignForEventAdmin(request.eventId, request.id);
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
  const noLiveCampaign = campaign === null;
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

  return (
    <div className="space-y-6">
      <PageHeading>בקשת ביטול #{request.requestNumber}</PageHeading>

      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <p>
          <span className="font-medium">אירוע: </span>
          {request.eventName || '—'} <Badge>{request.eventStatus}</Badge>
        </p>
        <p>
          <span className="font-medium">הוגשה: </span>
          {formatDateTime(request.createdAt)}
        </p>
        <p className="whitespace-pre-wrap">
          <span className="font-medium">סיבה: </span>
          {request.reason}
        </p>
        {isPackage && campaign && !campaign.packageUnreadable ? (
          <p className="text-sm text-muted-foreground">
            חבילה בתשלום אחד · שולם {formatCurrency(packagePaid ?? 0)}
            {campaign.packageRefundable != null && campaign.packageRefundable !== packagePaid
              ? ` · נותר להחזרה ${formatCurrency(campaign.packageRefundable)}`
              : ''}
          </p>
        ) : null}
        {billingSummary ? (
          <p className="text-sm text-muted-foreground">
            {billingSummary.reachedCount} אנשי קשר הושגו · נצבר {formatCurrency(accrued)}
            {campaign && !isOpenCeilingAgreementVersion(campaign.tosVersion)
              ? ` מתוך תקרה ${formatCurrency(billingSummary.ceiling)}`
              : ''}
          </p>
        ) : null}
      </div>

      {request.status === 'pending' ? (
        <>
          {packageState === 'unreadable' ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              לא ניתן לקרוא כרגע את נתוני התשלום של החבילה — אפשר לדחות את הבקשה אבל לא לבצע החזר. רעננו את הדף ונסו שוב.
            </div>
          ) : packageState === 'resume' ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              כבר הוחזרו {formatCurrency(campaign?.packageRefundedForRequest ?? 0)} בבקשה הזו (טיפול קודם שנקטע לפני
              שהסתיים). אישור ישלים את הטיפול — סגירת הקמפיין והאירוע ועדכון הלקוח — בלי להחזיר שוב. הלקוח יקבל הודעה לפי מה
              שהוחזר בפועל, לא לפי מה שיוזן כאן; אי אפשר לדחות בקשה שכבר הוחזר בה כסף.
            </div>
          ) : packageState === 'refund' ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              קמפיין חבילה ששולם ({formatCurrency(packagePaid ?? 0)}) — אישור &quot;ביטול מלא&quot; יחזיר אוטומטית לכרטיס את
              הסכום המלא, ו&quot;חיוב חלקי&quot; יחזיר את ההפרש. ההחזר מתבצע מיד, והקמפיין והאירוע ייסגרו.
            </div>
          ) : packageState === 'no_card' ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              בקמפיין החבילה שולם {formatCurrency(packagePaid ?? 0)} אך אין כרטיס שמור להחזיר אליו — לא ניתן להחזיר
              אוטומטית, ואישור שיש בו סכום להחזרה ייכשל בהודעה ולא ישנה דבר. החזירו ידנית אצל חברת הסליקה, או דחו את הבקשה.
            </div>
          ) : packageState === 'nothing_to_refund' ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              בקמפיין החבילה לא שולם דבר (או שהכול כבר הוחזר) — אין מה להחזיר. אישור &quot;ביטול מלא&quot; יסגור את הקמפיין
              והאירוע בלי תנועה כספית.
            </div>
          ) : noLiveCampaign ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              לאירוע אין קמפיין פעיל (ייתכן שהקמפיין בוטל) — אישור הבקשה לא יזיז כסף, והאירוע ייסגר.
            </div>
          ) : isPreCharge ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              הקמפיין טרם חויב — אישור &quot;ביטול מלא&quot; או &quot;חיוב חלקי&quot; כאן יבצע חיוב אמיתי בכרטיס מיד.
            </div>
          ) : campaign?.hasCardOnFile ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              קמפיין זה כבר חויב — יש פרטי כרטיס שמורים, אז אישור כאן יבצע זיכוי אוטומטי לכרטיס מיד, לא חיוב.
            </div>
          ) : (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              קמפיין זה כבר חויב ואין פרטי כרטיס שמורים — לא ניתן לבצע זיכוי אוטומטי. אישור כאן ירשום &quot;נדרש זיכוי
              ידני&quot; בלבד; יש לבצע את ההחזר בפועל ידנית ב-SUMIT.
            </div>
          )}
          <ResolveForm
            requestId={request.id}
            suggestedAmount={suggestedAmount}
            moneyOutcome={moneyOutcome}
            feeBase={feeBase}
            feeBaseLabel={feeBaseLabel}
          />
        </>
      ) : (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <p>
            <span className="font-medium">תוצאה: </span>
            {RESOLUTION_LABELS[request.resolution ?? ''] ?? request.resolution}
          </p>
          {request.resolutionAmount != null ? (
            <p>
              <span className="font-medium">סכום: </span>
              {formatCurrency(request.resolutionAmount)}
            </p>
          ) : null}
          <p>
            <span className="font-medium">תנועה כספית: </span>
            {CAPTURE_OUTCOME_LABELS[request.captureOutcome ?? ''] ?? request.captureOutcome}
          </p>
          {/* A package refund's credit document is read from the ledger: CardCom answers only its number (no link), and the
              request row keeps a SUMIT link only. */}
          {campaign?.packageRefundDocument?.number != null && !request.sumitDocumentUrl ? (
            <p>
              <span className="font-medium">מסמך זיכוי: </span>
              {`מס׳ ${campaign.packageRefundDocument.number}`}
            </p>
          ) : null}
          {request.sumitDocumentUrl ? (
            <p>
              <a href={request.sumitDocumentUrl} className="text-primary hover:underline" target="_blank" rel="noreferrer">
                קבלה / תעודת זיכוי
              </a>
            </p>
          ) : null}
          {request.resolutionNote ? (
            <p className="whitespace-pre-wrap">
              <span className="font-medium">הודעה ללקוח: </span>
              {request.resolutionNote}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
