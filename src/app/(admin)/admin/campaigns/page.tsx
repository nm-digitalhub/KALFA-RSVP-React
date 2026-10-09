import { requirePlatformPermission } from '@/lib/auth/dal';
import Link from 'next/link';

import { ledgerMoneyForAdmin, listCampaignsForAdmin } from '@/lib/data/admin/campaigns';
import { ledgerMoneyParts } from '@/lib/payments/operation-labels';
import type { LedgerMoney } from '@/lib/payments/status';
import { holdBadge } from '@/lib/data/admin/campaign-hold-badge';
import { CAMPAIGN_STATUS_LABELS } from '@/lib/data/event-labels';
import { formatIsraelDate } from '@/lib/date';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { PageHeading, EmptyState, Badge, formatCurrency } from '../_components';

export const metadata = { title: 'קמפיינים' };

// Charge-outcome labels for the not-yet/non-monetary states; charged and
// nothing_to_charge render as amounts instead.
const CHARGE_STATUS_LABELS: Record<string, string> = {
  pending: 'בתהליך חיוב',
  charge_failed: 'החיוב נכשל',
  charge_review: 'בבדיקה',
};

// The charge cell: an amount once settled (charged / nothing_to_charge), a
// state label mid-flight, '—' before any charge attempt.
function chargeCell(c: {
  chargeStatus: string | null;
  finalChargeAmount: number | null;
}): string {
  if (c.chargeStatus === 'charged' || c.chargeStatus === 'nothing_to_charge') {
    return formatCurrency(c.finalChargeAmount ?? 0);
  }
  if (c.chargeStatus) return CHARGE_STATUS_LABELS[c.chargeStatus] ?? c.chargeStatus;
  return '—';
}

// The hold cell: what became of the hold — held, captured (חויב), released
// (שוחרר) or closed and awaiting release — decided from capture_status,
// charge_status and release_status together (campaign-hold-badge.ts), and
// rendered AS the document link (Base UI's render prop) when we have one,
// never a separate link beside it.
function HoldCell(c: {
  captureStatus: string | null;
  releaseStatus: string | null;
  chargeStatus: string | null;
  holdOrderDocumentNumber: number | null;
  holdOrderDocumentUrl: string | null;
}) {
  if (!c.captureStatus) return <span className="text-muted-foreground">—</span>;
  const entry = holdBadge(c);
  const label = entry
    ? c.holdOrderDocumentNumber
      ? `${entry.label} (הזמנה ${c.holdOrderDocumentNumber})`
      : entry.label
    : c.captureStatus;
  const variant = entry?.variant ?? 'neutral';
  if (c.holdOrderDocumentUrl) {
    return (
      <Badge
        variant={variant}
        render={<a href={c.holdOrderDocumentUrl} target="_blank" rel="noopener noreferrer" />}
      >
        {label}
      </Badge>
    );
  }
  return <Badge variant={variant}>{label}</Badge>;
}

// The payments-and-refunds cell: ONE column for whatever moved on the campaign, each part only when the record holds it. First what
// the payment ledger recorded (paid / refunded / unresolved, by each kind's effect — any kind, any model), then the
// campaign's own hold and final-charge columns, which only a campaign that used them has.
function MoneyCell({
  c,
  money,
  ledgerFailed,
}: {
  c: Parameters<typeof HoldCell>[0] & { finalChargeAmount: number | null; creditApplied: number };
  money: LedgerMoney | undefined;
  ledgerFailed: boolean;
}) {
  const ledger = money ? ledgerMoneyParts(money) : [];
  const charge = c.chargeStatus ? chargeCell(c) : null;
  const nothing = !ledgerFailed && ledger.length === 0 && !c.captureStatus && !charge && c.creditApplied <= 0;
  if (nothing) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {ledgerFailed ? <span className="text-xs text-destructive">ספר החיובים לא נטען</span> : null}
      {ledger.length > 0 ? <span className="whitespace-nowrap">{ledger.join(' · ')}</span> : null}
      {c.captureStatus ? <HoldCell {...c} /> : null}
      {charge ? <span className="whitespace-nowrap text-xs">סכום החיוב הסופי: {charge}</span> : null}
      {c.creditApplied > 0 ? (
        <span className="whitespace-nowrap text-xs text-muted-foreground">זיכוי שקוזז {formatCurrency(c.creditApplied)}</span>
      ) : null}
    </div>
  );
}

// Admin campaign wind-down list. The four lifecycle controls (close/pause/
// settle/cancel) are platform-admin-only, so this surface lets an admin REACH
// campaigns of events they do not own and click through to manage them.
// Authorization is enforced by the /admin layout (requirePlatformStaff) and
// again in listCampaignsForAdmin (requirePlatformPermission).
export default async function AdminCampaignsPage() {
  // Optimistic gate: redirect early instead of rendering an empty page. The
  // real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const items = await listCampaignsForAdmin();
  const money = await ledgerMoneyForAdmin(items.map((c) => c.id));

  return (
    <div className="space-y-6">
      <PageHeading>קמפיינים</PageHeading>

      <p className="text-sm text-muted-foreground">
        קמפיינים פעילים, מושהים או סגורים — לניהול סגירה, השהיה, גמר חשבון או ביטול —
        וקמפיינים עם תפיסת מסגרת תקועה שדורשת בדיקה.
      </p>

      {items.length === 0 ? (
        <EmptyState>אין קמפיינים הדורשים טיפול.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם האירוע</TableHead>
                <TableHead>תאריך האירוע</TableHead>
                <TableHead>סטטוס הקמפיין</TableHead>
                <TableHead>תשלומים והחזרים</TableHead>
                <TableHead>פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/events/${c.eventId}`}
                      className="hover:underline"
                    >
                      {c.eventName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.eventDate ? formatIsraelDate(c.eventDate) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <MoneyCell c={c} money={money?.get(c.id)} ledgerFailed={money === null} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/app/events/${c.eventId}/campaign/${c.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      ניהול הקמפיין
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
