import Link from 'next/link';
import { requirePlatformPermission } from '@/lib/auth/dal';

import {
  getWebhookHealth,
  getWebhookInboxItem,
  listWebhookInbox,
  resolveWebhookAssociations,
} from '@/lib/data/admin/webhook-inbox';
import {
  WEBHOOK_KIND_VARIANTS,
  WEBHOOK_PROCESS_LABELS,
  WEBHOOK_PROCESS_VARIANTS,
  deliveryStatusLabel,
  deliveryStatusVariant,
  webhookKindLabel,
  webhookProcessState,
} from '@/lib/data/admin/labels';
import {
  Badge,
  EmptyState,
  PageHeading,
  Pagination,
  firstParam,
  formatDateTime,
  parsePageParam,
} from '../_components';
import { WebhookDetail } from './webhook-detail';
import { InspectorDrawer } from './webhook-inspector-client';
import { DateSelectIL } from '@/components/date-select-il';

export const metadata = { title: 'בדיקת Webhooks' };

type SearchParams = {
  page?: string | string[];
  kind?: string | string[];
  state?: string | string[];
  from?: string | string[];
  to?: string | string[];
  q?: string | string[];
  inspect?: string | string[];
};

interface CurrentFilters {
  kind?: string;
  state?: string;
  from?: string;
  to?: string;
  q?: string;
}

const KIND_OPTIONS = [
  { value: 'message', label: 'הודעה' },
  { value: 'status', label: 'סטטוס' },
];
const STATE_OPTIONS = [
  { value: 'pending', label: 'ממתין' },
  { value: 'processed', label: 'עובד' },
  { value: 'error', label: 'שגיאה' },
];

function HealthStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warning' | 'destructive';
}) {
  const toneClass =
    tone === 'warning'
      ? 'text-warning'
      : tone === 'destructive'
        ? 'text-destructive'
        : 'text-foreground';
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function WebhookFilters({
  basePath,
  current,
}: {
  basePath: string;
  current: CurrentFilters;
}) {
  return (
    <form
      method="get"
      action={basePath}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <input type="hidden" name="page" value="1" />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">
          חיפוש (מזהה הודעה / context / phone_number_id)
        </span>
        <input
          type="search"
          name="q"
          dir="ltr"
          defaultValue={current.q ?? ''}
          placeholder="wamid… / 1029…"
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">סוג</span>
          <select
            name="kind"
            defaultValue={current.kind ?? ''}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">מצב</span>
          <select
            name="state"
            defaultValue={current.state ?? ''}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">מתאריך</span>
          <DateSelectIL id="filter-from" name="from" defaultValue={current.from ?? ''} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">עד תאריך</span>
          <DateSelectIL id="filter-to" name="to" defaultValue={current.to ?? ''} />
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            סינון
          </button>
          <Link
            href={basePath}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            ניקוי
          </Link>
        </div>
      </div>
    </form>
  );
}

export default async function AdminWebhooksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Optimistic gate (Next.js term): redirects early so the operator does not
  // land on an empty page. The real enforcement is per-function in the DAL.
  await requirePlatformPermission('view_webhooks');
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const current: CurrentFilters = {
    kind: firstParam(sp.kind),
    state: firstParam(sp.state),
    from: firstParam(sp.from),
    to: firstParam(sp.to),
    q: firstParam(sp.q),
  };

  const [result, health] = await Promise.all([
    listWebhookInbox({ page, ...current }),
    getWebhookHealth(),
  ]);
  const associations = await resolveWebhookAssociations(result.items);

  const queryParams = { ...current };

  // Detail drawer (server-rendered body) when ?inspect is present.
  const inspectId = firstParam(sp.inspect);
  const detail = inspectId ? await getWebhookInboxItem(inspectId) : null;

  function listHref(): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(current)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/webhooks?${qs}` : '/admin/webhooks';
  }

  // Href to open a row's detail drawer while preserving the active filters.
  // Built as a Next.js URL object (pathname + query) — the documented way to
  // compose links with query params (Next serializes/encodes it), not manual
  // string concatenation.
  function inspectHref(id: string) {
    const query: Record<string, string> = { inspect: id };
    for (const [k, v] of Object.entries(current)) if (v) query[k] = v;
    return { pathname: '/admin/webhooks', query };
  }

  return (
    <div className="space-y-6">
      <PageHeading>בדיקת Webhooks</PageHeading>

      <div className="flex flex-wrap gap-3">
        <HealthStat
          label="התקבל לאחרונה"
          value={health.receivedLast ? formatDateTime(health.receivedLast) : '—'}
        />
        <HealthStat
          label="ממתינים לעיבוד"
          value={String(health.unprocessedCount)}
          tone={health.unprocessedCount > 0 ? 'warning' : undefined}
        />
        <HealthStat
          label="נכשלו"
          value={String(health.failedCount)}
          tone={health.failedCount > 0 ? 'destructive' : undefined}
        />
      </div>

      <WebhookFilters basePath="/admin/webhooks" current={current} />

      {result.items.length === 0 ? (
        <EmptyState>
          {current.kind || current.state || current.q || current.from || current.to
            ? 'אין אירועי webhook התואמים לסינון.'
            : 'אין אירועי webhook עדיין. הם יופיעו כאן ברגע ש-Meta תשלח קריאה.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {result.items.map((row) => {
            const state = webhookProcessState(row);
            const assoc = associations.get(row.id);
            const stripe =
              state === 'error'
                ? 'border-s-4 border-s-destructive'
                : assoc?.deliveryStatus === 'failed'
                  ? 'border-s-4 border-s-warning'
                  : '';
            return (
              <li
                key={row.id}
                className={`rounded-lg border border-border bg-card ${stripe}`}
              >
                <Link
                  href={inspectHref(row.id)}
                  className="flex flex-wrap items-start justify-between gap-3 p-4 hover:bg-muted/40"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={WEBHOOK_KIND_VARIANTS[row.event_kind] ?? 'neutral'}>
                        {webhookKindLabel(row.event_kind)}
                      </Badge>
                      <Badge variant={WEBHOOK_PROCESS_VARIANTS[state]}>
                        {WEBHOOK_PROCESS_LABELS[state]}
                      </Badge>
                      {assoc?.deliveryStatus ? (
                        <Badge variant={deliveryStatusVariant(assoc.deliveryStatus)}>
                          {deliveryStatusLabel(assoc.deliveryStatus)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-md border border-border px-2 py-1">
                        {assoc?.eventName ?? 'לא שויך'}
                      </span>
                      {row.message_id ? (
                        <span
                          className="rounded-md border border-border px-2 py-1"
                          dir="ltr"
                        >
                          {row.message_id.slice(-10)}
                        </span>
                      ) : null}
                      {row.attempts > 1 ? (
                        <span className="rounded-md border border-border px-2 py-1">
                          ניסיונות: {row.attempts}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(row.received_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        basePath="/admin/webhooks"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        queryParams={queryParams}
      />

      {detail ? (
        <InspectorDrawer
          closeHref={listHref()}
          title={`אירוע webhook · ${webhookKindLabel(detail.event_kind)}`}
        >
          <WebhookDetail item={detail} />
        </InspectorDrawer>
      ) : null}
    </div>
  );
}
