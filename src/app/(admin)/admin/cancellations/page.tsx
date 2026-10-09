import type { Metadata } from 'next';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { listCancellationRequestsForAdmin } from '@/lib/data/event-cancellation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeading, EmptyState, Badge, formatDateTime } from '../_components';

export const metadata: Metadata = { title: 'בקשות ביטול' };

const STATUS_LABELS: Record<string, string> = {
  pending: 'ממתינה',
  resolved: 'טופלה',
};

// Each row ends in an explicit way into the request: "טיפול בבקשה" while it waits for a decision, "צפייה" once it was
// handled. It is a link styled as a button, not the Button component: Base UI's Button enforces button semantics and its
// docs say a link that should look like a button is an <a> styled directly (buttonVariants, as rdp-access does).
export default async function AdminCancellationsPage() {
  await requirePlatformPermission('manage_billing');
  const requests = await listCancellationRequestsForAdmin();

  return (
    <div className="space-y-6">
      <PageHeading>בקשות ביטול</PageHeading>

      {requests.length === 0 ? (
        <EmptyState>אין בקשות ביטול.</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>מס&apos; בקשה</TableHead>
              <TableHead>אירוע</TableHead>
              <TableHead>סיבה</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>הוגשה</TableHead>
              <TableHead>
                <span className="sr-only">פעולה</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/admin/cancellations/${r.id}`} className="hover:underline">
                    #{r.requestNumber}
                  </Link>
                </TableCell>
                <TableCell>{r.eventName || '—'}</TableCell>
                <TableCell className="max-w-xs truncate">{r.reason}</TableCell>
                <TableCell>
                  <Badge>{STATUS_LABELS[r.status] ?? r.status}</Badge>
                </TableCell>
                <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                <TableCell>
                  <Link
                    href={`/admin/cancellations/${r.id}`}
                    aria-label={`${r.status === 'pending' ? 'טיפול בבקשה' : 'צפייה בבקשה'} #${r.requestNumber}`}
                    className={buttonVariants({ variant: r.status === 'pending' ? 'default' : 'outline' })}
                  >
                    {r.status === 'pending' ? 'טיפול בבקשה' : 'צפייה'}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
