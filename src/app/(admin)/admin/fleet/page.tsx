import Link from 'next/link';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  listFleetRequestHistory,
  listPendingFleetRequests,
} from '@/lib/data/admin/fleet';
import {
  EmptyState,
  PageHeading,
  Pagination,
  formatDateTime,
  parsePageParam,
} from '../_components';
import { PendingRequestCard } from './fleet-client';

// Admin: the autonomous-fleet request inbox (/admin/fleet). Fleet roles file
// approval/question/fyi requests via the service-role CLI; the owner answers
// here. Authorization: the (admin) layout requireAdmin() boundary + the
// manage_settings gate in the data layer + RLS on fleet_requests.

const STATUS_LABEL: Record<string, string> = {
  approved: 'אושר',
  denied: 'נדחה',
  answered: 'נענה',
  expired: 'פג תוקף',
  consumed: 'נקלט אצל הסוכן',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  approved: 'success',
  denied: 'destructive',
  answered: 'info',
  expired: 'neutral',
  consumed: 'success',
};

const KIND_LABEL: Record<string, string> = {
  approval: 'אישור',
  question: 'שאלה',
  fyi: 'עדכון',
};

export default async function AdminFleetPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePageParam((await searchParams).page);
  const [pending, history] = await Promise.all([
    listPendingFleetRequests(),
    listFleetRequestHistory({ page }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeading>פניות הסוכנים (Fleet)</PageHeading>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">
          ממתינות למענה
          {pending.length > 0 ? ` (${pending.length})` : ''}
        </h2>
        {pending.length === 0 ? (
          <EmptyState>אין פניות ממתינות — כל הסוכנים מסודרים 🎉</EmptyState>
        ) : (
          pending.map((request) => (
            <PendingRequestCard
              key={request.id}
              request={request}
              createdAtLabel={formatDateTime(request.created_at)}
              expiresAtLabel={formatDateTime(request.expires_at)}
            />
          ))
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">היסטוריה</h2>
        {history.items.length === 0 ? (
          <EmptyState>עדיין אין היסטוריית פניות</EmptyState>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>תאריך</TableHead>
                  <TableHead>תפקיד</TableHead>
                  <TableHead>סוג</TableHead>
                  <TableHead>כותרת</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>תשובה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.items.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(request.created_at)}
                    </TableCell>
                    <TableCell>{request.role}</TableCell>
                    <TableCell>{KIND_LABEL[request.kind] ?? request.kind}</TableCell>
                    <TableCell className="max-w-64 truncate" title={request.title}>
                      <Link
                        href={`/admin/fleet/${request.id}`}
                        className="text-primary hover:underline"
                      >
                        {request.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[request.status] ?? 'neutral'}>
                        {STATUS_LABEL[request.status] ?? request.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={request.answer ?? ''}>
                      {request.answer ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={history.page}
              pageSize={history.pageSize}
              total={history.total}
              basePath="/admin/fleet"
            />
          </>
        )}
      </section>
    </div>
  );
}
