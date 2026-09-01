import type { Metadata } from 'next';
import Link from 'next/link';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { listCallbackRequests } from '@/lib/data/admin/callbacks';
import {
  callAnalysisSuccessfulLabel,
  callbackStatusLabel,
  callbackStatusVariant,
  callOutcomeLabel,
  salesDispatchStatusLabel,
} from '@/lib/data/admin/labels';
import {
  PageHeading,
  EmptyState,
  Pagination,
  Badge,
  formatDateTime,
  parsePageParam,
} from '../_components';

export const metadata: Metadata = { title: 'בקשות חזרה' };

function formatSeconds(secs: number | null): string | null {
  if (secs === null) return null;
  return `${secs} שניות`;
}

function formatCredits(credits: number | null): string | null {
  if (credits === null) return null;
  return `${credits} credits`;
}

function salesSummaryText(cb: Awaited<ReturnType<typeof listCallbackRequests>>['items'][number]): string {
  const sales = cb.latestSalesCall;
  if (!sales) return 'AI מכירות: טרם בוצעה שיחה';
  if (!sales.hasAnalysis) return 'AI מכירות: השיחה נרשמה, ניתוח טרם התקבל';

  return [
    'AI מכירות:',
    salesDispatchStatusLabel(sales.dispatchStatus),
    callAnalysisSuccessfulLabel(sales.callSuccessful),
    sales.callSuccessScore !== null ? `ציון ${sales.callSuccessScore}` : null,
    formatSeconds(sales.callDurationSecs),
    formatCredits(sales.costCredits),
    sales.likelyVoicemail === true ? 'כנראה משיבון' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Admin: callback (call-me-back) requests, paginated server-side. Each row
// shows the request details, the current status (via free-text-safe label) and
// an inline form to change the status.

export default async function AdminCallbacksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  // Optimistic gate (Next.js term): redirects early so the operator does not
  // land on an empty page. The real enforcement is per-function in the DAL.
  await requirePlatformPermission('view_customer_data');
  const page = parsePageParam((await searchParams).page);
  const result = await listCallbackRequests({ page });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>בקשות חזרה</PageHeading>
        <Link
          href="/admin/callbacks/policy"
          className="text-sm font-medium text-primary underline underline-offset-2"
        >
          מדיניות תזמון
        </Link>
      </div>

      {result.items.length === 0 ? (
        <EmptyState>אין בקשות חזרה עדיין.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.items.map((cb) => (
            <li
              key={cb.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/callbacks/${cb.id}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {cb.full_name}
                  </Link>
                  <Badge variant={callbackStatusVariant(cb.status)}>
                    {callbackStatusLabel(cb.status)}
                  </Badge>
                  {/* Only surfaced once it stops being the pending default —
                      matches CallOutcomeForm's own "record after the call"
                      framing rather than cluttering every fresh row. */}
                  {cb.call_outcome !== 'pending' && (
                    <Badge variant="outline">{callOutcomeLabel(cb.call_outcome)}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {cb.phone}
                </p>
                {cb.topic && <p className="text-sm">{cb.topic}</p>}
                {cb.note && (
                  // wrap-anywhere: same latent overflow as /admin/fleet — a
                  // long unbreakable token here would widen the shell row.
                  <p className="wrap-anywhere whitespace-pre-wrap text-sm text-muted-foreground">
                    {cb.note}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(cb.created_at)}
                  {cb.scheduled_at && ` · שובץ ל-${formatDateTime(cb.scheduled_at)}`}
                </p>
                <p className="text-xs text-muted-foreground">{salesSummaryText(cb)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/callbacks"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
