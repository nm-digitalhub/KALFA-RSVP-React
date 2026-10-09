import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  countCancellationRequestsForAdmin,
  listCancellationRequestsForAdmin,
  type CancellationRequestForAdmin,
} from '@/lib/data/event-cancellation';
import { EVENT_STATUS_LABELS } from '@/lib/data/event-labels';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeading, EmptyState, Badge, type BadgeVariant, formatDateTime, firstParam } from '../_components';

export const metadata: Metadata = { title: 'בקשות ביטול' };

const BASE_PATH = '/admin/cancellations';

type Status = CancellationRequestForAdmin['status'];
type Filter = Status | 'all';

const STATUS_LABELS: Record<Status, string> = {
  pending: 'ממתינה',
  resolved: 'טופלה',
};

const STATUS_BADGE: Record<Status, BadgeVariant> = {
  pending: 'warning',
  resolved: 'success',
};

// Same filter-link pattern as /admin/rdp-access/requests: a ?status= the server reads, so the list is filtered in the
// database. Anything else in the URL is "all".
const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: 'הכל' },
  { value: 'pending', label: 'ממתינות' },
  { value: 'resolved', label: 'טופלו' },
];

function parseFilter(raw: string | undefined): Filter {
  return FILTERS.find((f) => f.value === raw)?.value ?? 'all';
}

// The event's status as the rest of the admin shows it (EVENT_STATUS_LABELS); an unknown value is shown as it is.
function eventStatusText(status: string): string {
  return Object.hasOwn(EVENT_STATUS_LABELS, status) ? EVENT_STATUS_LABELS[status as keyof typeof EVENT_STATUS_LABELS] : status;
}

// The way into a request: "טיפול בבקשה" while it waits for a decision, "צפייה" once it was handled. It is a link styled as
// a button, not the Button component: Base UI's Button enforces button semantics and its docs say a link that should look
// like a button is an <a> styled directly (buttonVariants, as rdp-access does).
function OpenRequestLink({ request, className }: { request: CancellationRequestForAdmin; className?: string }) {
  const pending = request.status === 'pending';
  return (
    <Link
      href={`${BASE_PATH}/${request.id}`}
      aria-label={`${pending ? 'טיפול בבקשה' : 'צפייה בבקשה'} #${request.requestNumber}`}
      className={cn(buttonVariants({ variant: pending ? 'default' : 'outline' }), className)}
    >
      {pending ? 'טיפול בבקשה' : 'צפייה'}
      <ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />
    </Link>
  );
}

// One list, two layouts: a table from md up, a card per request below it (a table does not fit a phone).
export default async function AdminCancellationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission('manage_billing');
  const filter = parseFilter(firstParam((await searchParams).status));
  const [requests, counts] = await Promise.all([
    listCancellationRequestsForAdmin(filter === 'all' ? undefined : filter),
    countCancellationRequestsForAdmin(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <PageHeading>בקשות ביטול</PageHeading>
          <p className="text-sm text-muted-foreground">
            בקשות שהגישו לקוחות לביטול אירוע. בקשה ממתינה מחכה להחלטה של איש צוות.
          </p>
        </div>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-foreground/80">
          <span>
            <b className="font-bold text-foreground">{counts.pending}</b> ממתינות
          </span>
          <span>
            <b className="font-bold text-foreground">{counts.resolved}</b> טופלו
          </span>
        </p>
      </div>

      <nav aria-label="סינון לפי סטטוס" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const current = f.value === filter;
          return (
            <Link
              key={f.value}
              href={f.value === 'all' ? BASE_PATH : `${BASE_PATH}?status=${f.value}`}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 items-center rounded-full px-4 text-sm font-medium transition-colors',
                current ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/80 hover:bg-muted/70',
              )}
            >
              {f.label}
              {f.value === 'pending' && counts.pending > 0 ? ` (${counts.pending})` : ''}
            </Link>
          );
        })}
      </nav>

      {requests.length === 0 ? (
        <EmptyState>{filter === 'all' ? 'אין בקשות ביטול.' : 'אין בקשות בסטטוס הזה.'}</EmptyState>
      ) : (
        <>
          <div className="hidden md:block">
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
                    <TableCell className="font-semibold">#{r.requestNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.eventName || '—'}</div>
                      <div className="text-xs text-muted-foreground">{eventStatusText(r.eventStatus)}</div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{r.reason}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell className="text-end">
                      <OpenRequestLink request={r} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-3 md:hidden">
            {requests.map((r) => (
              <li key={r.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">#{r.requestNumber}</span>
                  <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                </div>
                <div className="space-y-0.5">
                  <p className="font-semibold">{r.eventName || '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    {eventStatusText(r.eventStatus)} · הוגשה {formatDateTime(r.createdAt)}
                  </p>
                </div>
                <p className="line-clamp-2 text-sm">{r.reason}</p>
                <OpenRequestLink request={r} className="h-11 w-full" />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
