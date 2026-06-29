import Link from 'next/link';

import {
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
  formatDateTime,
  parsePageParam,
} from '../_components';

export const metadata = { title: 'בדיקת Webhooks' };

type SearchParams = {
  page?: string | string[];
  kind?: string | string[];
  state?: string | string[];
  from?: string | string[];
  to?: string | string[];
  q?: string | string[];
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

function firstParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() !== '' ? value.trim() : undefined;
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
          <input
            type="date"
            name="from"
            defaultValue={current.from ?? ''}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">עד תאריך</span>
          <input
            type="date"
            name="to"
            defaultValue={current.to ?? ''}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
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
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const current: CurrentFilters = {
    kind: firstParam(sp.kind),
    state: firstParam(sp.state),
    from: firstParam(sp.from),
    to: firstParam(sp.to),
    q: firstParam(sp.q),
  };

  const result = await listWebhookInbox({ page, ...current });
  const associations = await resolveWebhookAssociations(result.items);

  const queryParams = { ...current };

  // Href to open a row's detail drawer (rendered in Stage 1c) while preserving
  // the active filters.
  function inspectHref(id: string): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(current)) if (v) params.set(k, v);
    params.set('inspect', id);
    return `?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeading>בדיקת Webhooks</PageHeading>

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
    </div>
  );
}
