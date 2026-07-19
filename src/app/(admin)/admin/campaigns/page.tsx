import Link from 'next/link';

import { listCampaignsForAdmin } from '@/lib/data/admin/campaigns';
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

// Admin campaign wind-down list. The four lifecycle controls (close/pause/
// settle/cancel) are platform-admin-only, so this surface lets an admin REACH
// campaigns of events they do not own and click through to manage them.
// Authorization is enforced by the /admin layout (requireAdmin) and again in
// listCampaignsForAdmin.
export default async function AdminCampaignsPage() {
  const items = await listCampaignsForAdmin();

  return (
    <div className="space-y-6">
      <PageHeading>קמפיינים</PageHeading>

      <p className="text-sm text-muted-foreground">
        קמפיינים פעילים, מושהים או סגורים — לניהול סגירה, השהיה, גמר חשבון או ביטול.
      </p>

      {items.length === 0 ? (
        <EmptyState>אין קמפיינים הדורשים טיפול.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>אירוע</TableHead>
                <TableHead>תאריך האירוע</TableHead>
                <TableHead>מצב</TableHead>
                <TableHead>חיוב סופי</TableHead>
                <TableHead>זיכוי שקוזז</TableHead>
                <TableHead>
                  <span className="sr-only">פעולות</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.eventName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.eventDate ? formatIsraelDate(c.eventDate) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
                  </TableCell>
                  <TableCell>{chargeCell(c)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.creditApplied > 0 ? formatCurrency(c.creditApplied) : '—'}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/app/events/${c.eventId}/campaign/${c.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      ניהול
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
