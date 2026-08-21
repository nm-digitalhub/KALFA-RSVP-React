import type { Metadata } from 'next';
import Link from 'next/link';

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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
