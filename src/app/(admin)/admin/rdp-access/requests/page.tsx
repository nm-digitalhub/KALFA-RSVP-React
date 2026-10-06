import { Terminal } from 'lucide-react';
import Link from 'next/link';

import { Badge, type BadgeVariant, EmptyState, formatDateTime, PageHeading, Pagination, firstParam, parsePageParam } from '../../_components';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getRdpAccessOverview, listRdpAccessRequests, type RdpOwnerListFilter } from '@/lib/data/admin/rdp-access-owner';
import { minutesLabel, OWNER_STATUS_LABEL, OWNER_TERMINAL_COMMAND } from '@/lib/rdp-access/copy';
import { stationStatesFor, type RdpDisplayStatus } from '@/lib/rdp-access/status';
import { cn } from '@/lib/utils';

import { ProgressDots } from './progress-dots';

export const metadata = { title: 'בקשות גישה לשולחן עבודה' };
export const dynamic = 'force-dynamic';

// The owner's read-only list of every remote-desktop request. There is nothing to press here by design: deciding
// happens in the server terminal, and the page says so. Owner-only (the gate is inside both data calls).

const BASE_PATH = '/admin/rdp-access/requests';

const FILTERS: ReadonlyArray<{ value: RdpOwnerListFilter; label: string }> = [
  { value: 'all', label: 'הכל' },
  { value: 'pending', label: 'ממתינות' },
  { value: 'active', label: 'פעילות' },
  { value: 'finished', label: 'הסתיימו' },
];

const STATUS_BADGE: Record<RdpDisplayStatus, BadgeVariant> = {
  pending: 'warning',
  active: 'success',
  ended: 'neutral',
  denied: 'destructive',
  expired: 'neutral',
  cancelled: 'neutral',
};

function parseFilter(raw: string | undefined): RdpOwnerListFilter {
  return FILTERS.find((f) => f.value === raw)?.value ?? 'all';
}

function shortReason(reason: string): string {
  return reason.length <= 70 ? reason : `${reason.slice(0, 67)}...`;
}

export default async function RdpRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter = parseFilter(firstParam(params.status));
  const page = parsePageParam(params.page);

  const [overview, list] = await Promise.all([getRdpAccessOverview(), listRdpAccessRequests({ filter, page })]);
  const activeMinutes = overview.active
    ? Math.max(0, Math.ceil((Date.parse(overview.active.expiresAt) - Date.parse(overview.serverNow)) / 60_000))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>כל בקשות הגישה</PageHeading>
        <span className="inline-flex items-center gap-2 rounded-xl bg-muted px-3.5 py-2 text-sm text-foreground/80">
          <Terminal className="size-4" aria-hidden />
          <code dir="ltr" className="font-mono text-[13px]">
            {OWNER_TERMINAL_COMMAND}
          </code>
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px] text-foreground/80">
        <span>
          <b className="font-bold text-foreground">{overview.pendingCount}</b> ממתינות
        </span>
        {overview.active ? (
          <span>
            <b className="font-bold text-foreground">1</b> פעילה
            {overview.active.requesterName ? ` (${overview.active.requesterName})` : ''}, עוד {minutesLabel(activeMinutes ?? 0)}
          </span>
        ) : (
          <span>אין גישה פעילה</span>
        )}
      </p>

      <nav aria-label="סינון לפי מצב" className="flex flex-wrap gap-1.5">
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
              {f.value === 'pending' && overview.pendingCount > 0 ? ` (${overview.pendingCount})` : ''}
            </Link>
          );
        })}
      </nav>

      {list.items.length === 0 ? (
        <EmptyState>אין בקשות להצגה</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">נוצרה</TableHead>
              <TableHead className="text-start">מבקש</TableHead>
              <TableHead className="text-start">מטרה</TableHead>
              <TableHead className="text-start">משך</TableHead>
              <TableHead className="text-start">התקדמות</TableHead>
              <TableHead className="text-start">סטטוס</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`${BASE_PATH}/${item.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {formatDateTime(item.createdAt)}
                  </Link>
                </TableCell>
                <TableCell>{item.requesterName ?? '—'}</TableCell>
                <TableCell className="max-w-[28ch] [overflow-wrap:anywhere]" title={item.reason}>
                  {shortReason(item.reason)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{minutesLabel(item.grantedMinutes ?? item.requestedMinutes)}</TableCell>
                <TableCell>
                  <ProgressDots
                    states={stationStatesFor(item.status, item.filesIssued)}
                    label={`${OWNER_STATUS_LABEL[item.status]}, הורדו ${item.filesIssued} קבצים`}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[item.status]}>{OWNER_STATUS_LABEL[item.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination
        basePath={BASE_PATH}
        page={page}
        pageSize={list.pageSize}
        total={list.total}
        queryParams={{ status: filter === 'all' ? undefined : filter }}
      />
    </div>
  );
}
