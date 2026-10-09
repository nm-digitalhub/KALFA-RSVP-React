import { requirePlatformPermission } from '@/lib/auth/dal';
import Link from 'next/link';

import { ledgerForAdmin, listCampaignsForAdmin } from '@/lib/data/admin/campaigns';
import {
  CAMPAIGN_PAYMENT_STATUS_LABELS,
  campaignPaymentStatus,
  type CampaignPaymentStatus,
} from '@/lib/data/admin/campaign-payment-status';
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

import { PageHeading, EmptyState, Badge } from '../_components';

export const metadata = { title: 'קמפיינים' };

// The payment-status cell: ONE badge (campaign-payment-status.ts) and no amounts. The badge is the way to the
// details: it opens the campaign page at its payments list, where the amounts, the order number and every operation
// with its date and outcome are shown.
function PaymentStatusCell({
  href,
  status,
  ledgerFailed,
}: {
  href: string;
  status: CampaignPaymentStatus | null;
  ledgerFailed: boolean;
}) {
  // An unreadable ledger is said as such: the hold columns alone would show a package as "nothing happened".
  const entry = ledgerFailed
    ? { label: 'לא ניתן לטעון', variant: 'destructive' as const }
    : status
      ? CAMPAIGN_PAYMENT_STATUS_LABELS[status]
      : null;
  if (!entry) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant={entry.variant}
      render={<Link href={href} aria-label={`${entry.label} — פרטי התשלום`} />}
      className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {entry.label}
    </Badge>
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
  const ledger = await ledgerForAdmin(items.map((c) => c.id));

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
                <TableHead>מצב התשלום</TableHead>
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
                    <PaymentStatusCell
                      href={`/app/events/${c.eventId}/campaign/${c.id}#campaign-payments-title`}
                      status={campaignPaymentStatus(ledger?.get(c.id) ?? null, c)}
                      ledgerFailed={ledger === null}
                    />
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
