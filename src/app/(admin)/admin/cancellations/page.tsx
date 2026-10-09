import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CalendarDays,
  CalendarX2,
  Check,
  ChevronLeft,
  CircleCheck,
  Clock,
  CreditCard,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Inbox,
  List,
  ListFilter,
  Search,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { cancellationMoneyForAdmin } from '@/lib/data/admin/cancellation-money';
import { CANCELLATION_LIST_MONEY_LABELS, type CancellationListMoney } from '@/lib/data/admin/cancellation-list-money';
import { cancellationReference } from '@/lib/data/cancellation-reference';
import { cancellationSearch } from '@/lib/data/cancellation-search';
import {
  countCancellationRequestsForAdmin,
  listCancellationRequestsForAdmin,
  type CancellationListSort,
  type CancellationRequestForAdmin,
} from '@/lib/data/event-cancellation';
import { EVENT_STATUS_LABELS } from '@/lib/data/event-labels';
import { formatIsraelDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge, type BadgeVariant, formatDateTime, firstParam } from '../_components';

export const metadata: Metadata = { title: 'בקשות ביטול' };

const BASE_PATH = '/admin/cancellations';

type Status = CancellationRequestForAdmin['status'];
type Filter = Status | 'all';

const STATUS_LOOK: Record<Status, { label: string; variant: BadgeVariant; Icon: LucideIcon }> = {
  pending: { label: 'ממתינה', variant: 'warning', Icon: Clock },
  resolved: { label: 'טופלה', variant: 'success', Icon: Check },
};

// The ?status= the server reads, so the list is filtered in the database. "ממתינות" comes first and is where the page
// opens: a waiting request is the work. Anything else in the URL is "ממתינות" too.
const FILTERS: ReadonlyArray<{ value: Filter; label: string; Icon: LucideIcon }> = [
  { value: 'pending', label: 'ממתינות', Icon: Clock },
  { value: 'resolved', label: 'טופלו', Icon: CircleCheck },
  { value: 'all', label: 'הכל', Icon: List },
];

function parseFilter(raw: string | undefined): Filter {
  return FILTERS.find((f) => f.value === raw)?.value ?? 'pending';
}

// ?sort=newest; anything else is the default, oldest first.
function parseSort(raw: string | undefined): CancellationListSort {
  return raw === 'newest' ? 'newest' : 'oldest';
}

function listHref(filter: Filter, q: string | null, sort: CancellationListSort): string {
  const params = new URLSearchParams();
  if (filter !== 'pending') params.set('status', filter);
  if (q) params.set('q', q);
  if (sort !== 'oldest') params.set('sort', sort);
  const query = params.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

// The submission-time order as a link that flips it: on the "הוגשה" column header, and beside the search on a phone or
// a tablet, where there is no table. The icon shows the current order.
function SortLink({
  sort,
  filter,
  q,
  className,
  children,
}: {
  sort: CancellationListSort;
  filter: Filter;
  q: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = sort === 'oldest' ? ArrowUpNarrowWide : ArrowDownWideNarrow;
  return (
    <Link
      href={listHref(filter, q, sort === 'oldest' ? 'newest' : 'oldest')}
      aria-label={`מיון לפי מועד ההגשה — עכשיו ${sort === 'oldest' ? 'הישנות קודם' : 'החדשות קודם'}. לחיצה מהפכת את הסדר`}
      className={cn('inline-flex items-center gap-1.5 hover:text-foreground', className)}
    >
      {children}
      <Icon aria-hidden className="size-4 shrink-0" />
    </Link>
  );
}

// The event's status as the rest of the admin shows it (EVENT_STATUS_LABELS); an unknown value is shown as it is.
function eventStatusText(status: string): string {
  return Object.hasOwn(EVENT_STATUS_LABELS, status) ? EVENT_STATUS_LABELS[status as keyof typeof EVENT_STATUS_LABELS] : status;
}

const MONEY_ICON: Partial<Record<CancellationListMoney, LucideIcon>> = {
  paid: CreditCard,
  refund_failed: TriangleAlert,
  refunded_full: Undo2,
  refunded_partial: Undo2,
  failed: TriangleAlert,
  review: TriangleAlert,
  pending: Clock,
};

function StatusBadge({ status }: { status: Status }) {
  const look = STATUS_LOOK[status];
  return (
    <Badge variant={look.variant} className="h-6 px-2.5 text-[13px] font-semibold">
      <look.Icon aria-hidden />
      {look.label}
    </Badge>
  );
}

// The request's money in one badge, or "—" when the event has no live campaign. `failed` = the money could not be read.
function MoneyBadge({ money, failed }: { money: CancellationListMoney | null | undefined; failed: boolean }) {
  if (failed) {
    return (
      <Badge variant="destructive" className="h-6 px-2.5 text-[13px] font-semibold">
        לא ניתן לטעון
      </Badge>
    );
  }
  if (!money) return <span className="text-muted-foreground">—</span>;
  const look = CANCELLATION_LIST_MONEY_LABELS[money];
  const Icon = MONEY_ICON[money];
  return (
    <Badge variant={look.variant} className="h-6 px-2.5 text-[13px] font-semibold">
      {Icon ? <Icon aria-hidden /> : null}
      {look.label}
    </Badge>
  );
}

function EventLine({ request }: { request: CancellationRequestForAdmin }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
      <CalendarDays aria-hidden className="size-3.5 shrink-0" />
      {request.eventDate ? `${formatIsraelDate(request.eventDate)} · ` : ''}
      {eventStatusText(request.eventStatus)}
    </span>
  );
}

// The way into a request: "טיפול בבקשה" while it waits for a decision, "צפייה" once it was handled. It is a link styled as
// a button, not the Button component: Base UI's Button enforces button semantics and its docs say a link that should look
// like a button is an <a> styled directly (buttonVariants, as rdp-access does).
function OpenRequestLink({ request, short, className }: { request: CancellationRequestForAdmin; short?: boolean; className?: string }) {
  const pending = request.status === 'pending';
  return (
    <Link
      href={`${BASE_PATH}/${request.id}`}
      aria-label={`${pending ? 'טיפול בבקשה' : 'צפייה בבקשה'} ${cancellationReference(request.requestCode)}`}
      className={cn(buttonVariants({ variant: pending ? 'default' : 'outline' }), 'h-11 gap-1.5 px-4', className)}
    >
      {pending ? (short ? 'טיפול' : 'טיפול בבקשה') : 'צפייה'}
      <ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />
    </Link>
  );
}

// One list, three layouts: a table from lg up, two columns of cards on a tablet, one column on a phone.
export default async function AdminCancellationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission('manage_billing');
  const params = await searchParams;
  const filter = parseFilter(firstParam(params.status));
  const sort = parseSort(firstParam(params.sort));
  const rawQuery = firstParam(params.q)?.trim() ?? '';
  const search = cancellationSearch(rawQuery);
  const query = search ? rawQuery : null;
  const [requests, counts] = await Promise.all([
    listCancellationRequestsForAdmin(filter === 'all' ? undefined : filter, search, sort),
    countCancellationRequestsForAdmin(),
  ]);
  const money = await cancellationMoneyForAdmin(requests);
  const countOf: Record<Filter, number> = { ...counts, all: counts.pending + counts.resolved };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3.5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarX2 aria-hidden className="size-6" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold sm:text-[28px]">בקשות ביטול</h1>
          <p className="text-sm text-muted-foreground sm:text-[15px]">
            בקשות שהגישו לקוחות לביטול אירוע. בקשה ממתינה מחכה להחלטה של איש צוות.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
        <ListFilter aria-hidden className="hidden size-5 shrink-0 text-muted-foreground sm:block" />
        <nav
          aria-label="סינון לפי סטטוס"
          className="grid flex-1 grid-cols-3 gap-1 rounded-[10px] bg-muted p-1 sm:inline-flex sm:w-fit sm:flex-none"
        >
          {FILTERS.map((f) => {
            const current = f.value === filter;
            return (
              <Link
                key={f.value}
                href={listHref(f.value, query, sort)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm transition-colors',
                  current ? 'bg-card font-semibold text-foreground shadow-sm' : 'font-medium text-foreground/75 hover:text-foreground',
                )}
              >
                <f.Icon aria-hidden className="size-4 shrink-0" />
                {f.label}
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 text-center text-xs font-bold',
                    current ? 'bg-primary text-primary-foreground' : 'bg-foreground/10 text-foreground',
                  )}
                >
                  {countOf[f.value]}
                </span>
              </Link>
            );
          })}
        </nav>
        </div>

        <div className="flex items-center gap-2 sm:w-auto">
        <form action={BASE_PATH} method="get" role="search" className="relative w-full flex-1 sm:w-72 sm:flex-none">
          {filter !== 'pending' ? <input type="hidden" name="status" value={filter} /> : null}
          <label htmlFor="cancellations-q" className="sr-only">
            חיפוש לפי קוד בקשה או שם אירוע
          </label>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <input
            id="cancellations-q"
            name="q"
            type="search"
            defaultValue={rawQuery}
            maxLength={80}
            placeholder="קוד בקשה או שם אירוע"
            className="h-11 w-full rounded-[10px] border border-input bg-card ps-10 pe-3 text-base sm:text-[15px]"
          />
          {sort !== 'oldest' ? <input type="hidden" name="sort" value={sort} /> : null}
        </form>
        <SortLink
          sort={sort}
          filter={filter}
          q={query}
          className="min-h-11 shrink-0 rounded-[10px] border border-input bg-card px-3 text-sm font-medium text-foreground/80 lg:hidden"
        >
          <span className="max-sm:sr-only">{sort === 'oldest' ? 'הישנות קודם' : 'החדשות קודם'}</span>
        </SortLink>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-4 py-12 text-[15px] text-muted-foreground">
          <Inbox aria-hidden className="size-10 text-muted-foreground/60" strokeWidth={1.5} />
          <span>אין בקשות שמתאימות לסינון.</span>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="px-5 text-[13px] font-semibold text-muted-foreground">בקשה</TableHead>
                  <TableHead className="px-5 text-[13px] font-semibold text-muted-foreground">אירוע</TableHead>
                  <TableHead className="px-5 text-[13px] font-semibold text-muted-foreground">סיבה</TableHead>
                  <TableHead className="px-5 text-[13px] font-semibold text-muted-foreground">סטטוס</TableHead>
                  <TableHead className="px-5 text-[13px] font-semibold text-muted-foreground">מצב התשלום</TableHead>
                  <TableHead
                    className="px-5 text-[13px] font-semibold text-muted-foreground"
                    aria-sort={sort === 'oldest' ? 'ascending' : 'descending'}
                  >
                    <SortLink sort={sort} filter={filter} q={query} className="min-h-8">
                      הוגשה
                    </SortLink>
                  </TableHead>
                  <TableHead className="px-5 text-[13px] font-semibold text-muted-foreground">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id} className="hover:bg-primary/[0.03]">
                    <TableCell className="px-5 py-4 font-semibold whitespace-nowrap">
                      <bdi>{cancellationReference(r.requestCode)}</bdi>
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      <div className="font-medium">{r.eventName || '—'}</div>
                      <EventLine request={r} />
                    </TableCell>
                    <TableCell className="max-w-56 truncate px-5 py-4" title={r.reason}>
                      {r.reason}
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      <MoneyBadge money={money?.get(r.id)} failed={money === null} />
                    </TableCell>
                    <TableCell className="px-5 py-4 whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell className="px-5 py-3">
                      <OpenRequestLink request={r} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 sm:gap-3.5 lg:hidden">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:p-[18px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold sm:text-[17px]">
                    <bdi>{cancellationReference(r.requestCode)}</bdi>
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold">{r.eventName || '—'}</p>
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <EventLine request={r} />
                    <span className="text-[13px] text-muted-foreground">הוגשה {formatDateTime(r.createdAt)}</span>
                  </p>
                </div>
                <p className="line-clamp-2 text-sm">{r.reason}</p>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                  <MoneyBadge money={money?.get(r.id)} failed={money === null} />
                  <OpenRequestLink request={r} short />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
