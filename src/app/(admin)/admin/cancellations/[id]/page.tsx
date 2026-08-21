import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  getCancellationRequestForAdmin,
  getCampaignForEventAdmin,
  computeSuggestedCancellationAmount,
} from '@/lib/data/event-cancellation';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { PageHeading, Badge, formatCurrency, formatDateTime } from '../../_components';
import { ResolveForm } from './resolve-form';

export const metadata: Metadata = { title: 'בקשת ביטול' };

const RESOLUTION_LABELS: Record<string, string> = {
  full_cancellation: 'ביטול מלא',
  partial_charge: 'חיוב חלקי',
  declined: 'נדחתה',
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

  const campaign = await getCampaignForEventAdmin(request.eventId);
  const isPreCharge = !campaign || campaign.chargeStatus !== 'charged';
  const moneyOutcome: 'capture' | 'credit' | 'manual' = isPreCharge
    ? 'capture'
    : campaign?.hasCardOnFile
      ? 'credit'
      : 'manual';
  const billingSummary = campaign ? await getCampaignBillingSummary(campaign.id) : null;
  const suggestedAmount = campaign ? await computeSuggestedCancellationAmount(campaign.id) : 0;

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
        {billingSummary ? (
          <p className="text-sm text-muted-foreground">
            {billingSummary.reachedCount} אנשי קשר הושגו · נצבר {formatCurrency(billingSummary.accrued)} מתוך
            תקרה {formatCurrency(billingSummary.ceiling)}
          </p>
        ) : null}
      </div>

      {request.status === 'pending' ? (
        <>
          {isPreCharge ? (
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
          <ResolveForm requestId={request.id} suggestedAmount={suggestedAmount} moneyOutcome={moneyOutcome} />
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
