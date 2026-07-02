import Link from 'next/link';

import {
  ACTIVITY_ACTION_OPTIONS,
  ACTIVITY_ENTITY_OPTIONS,
  describeActivity,
  listActivity,
  listActivityActorOptions,
  resolveActivityActors,
} from '@/lib/data/admin/activity';
import {
  EmptyState,
  PageHeading,
  Pagination,
  firstParam,
  formatDateTime,
  parsePageParam,
} from '../_components';

type SearchParams = {
  page?: string | string[];
  action?: string | string[];
  actor?: string | string[];
  entity?: string | string[];
  q?: string | string[];
  from?: string | string[];
  to?: string | string[];
  eventId?: string | string[];
  guestId?: string | string[];
  groupId?: string | string[];
  packageId?: string | string[];
};

interface CurrentFilters {
  action?: string;
  actor?: string;
  entity?: string;
  q?: string;
  from?: string;
  to?: string;
  eventId?: string;
  guestId?: string;
  groupId?: string;
  packageId?: string;
}

// Active instance filters (deep-linked from an event/guest/group/package).
// Rendered as a removable chip; the "show all" link drops the instance params
// while preserving the other filters.
const INSTANCE_FILTER_LABELS: Record<string, string> = {
  eventId: 'אירוע',
  guestId: 'מוזמן',
  groupId: 'קבוצה',
  packageId: 'חבילה',
};

function ActivityFilters({
  basePath,
  current,
  actorOptions,
  selectedActorLabel,
}: {
  basePath: string;
  current: CurrentFilters;
  actorOptions: Array<{ id: string; label: string }>;
  selectedActorLabel?: string;
}) {
  return (
    <form
      method="get"
      action={basePath}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <input type="hidden" name="page" value="1" />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">חיפוש חופשי</span>
        <input
          type="search"
          name="q"
          defaultValue={current.q ?? ''}
          placeholder="חיפוש לפי שם חבילה, מזהה, סוג אירוע…"
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-4 lg:grid-cols-6">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">ישות יעד</span>
        <select
          name="entity"
          defaultValue={current.entity ?? ''}
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        >
          <option value="">הכל</option>
          {ACTIVITY_ENTITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">פעולה</span>
        <select
          name="action"
          defaultValue={current.action ?? ''}
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        >
          <option value="">הכל</option>
          {ACTIVITY_ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">מבצע</span>
        <select
          name="actor"
          defaultValue={current.actor ?? ''}
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        >
          <option value="">הכל</option>
          {actorOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          {current.actor && !actorOptions.some((option) => option.id === current.actor) ? (
            <option value={current.actor}>{selectedActorLabel ?? current.actor}</option>
          ) : null}
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

      <div className="flex items-end gap-2 lg:col-span-1">
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

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const current: CurrentFilters = {
    action: firstParam(sp.action),
    actor: firstParam(sp.actor),
    entity: firstParam(sp.entity),
    q: firstParam(sp.q),
    from: firstParam(sp.from),
    to: firstParam(sp.to),
    eventId: firstParam(sp.eventId),
    guestId: firstParam(sp.guestId),
    groupId: firstParam(sp.groupId),
    packageId: firstParam(sp.packageId),
  };

  // Build the chip + the "show all" href that preserves non-instance filters.
  const activeInstance = (
    ['eventId', 'guestId', 'groupId', 'packageId'] as const
  )
    .map((key) => ({ key, value: current[key] }))
    .find((entry) => entry.value);
  const nonInstanceParams = Object.entries({
    action: current.action,
    actor: current.actor,
    entity: current.entity,
    q: current.q,
    from: current.from,
    to: current.to,
  }).filter(([, value]) => value) as Array<[string, string]>;
  const clearInstanceHref = nonInstanceParams.length
    ? `/admin/activity?${new URLSearchParams(nonInstanceParams).toString()}`
    : '/admin/activity';

  const [result, actorOptions, selectedActorMap] = await Promise.all([
    listActivity({
      page,
      action: current.action,
      userId: current.actor,
      entity: current.entity,
      search: current.q,
      from: current.from,
      to: current.to,
      eventId: current.eventId,
      guestId: current.guestId,
      groupId: current.groupId,
      packageId: current.packageId,
    }),
    listActivityActorOptions(50),
    current.actor
      ? resolveActivityActors([current.actor])
      : Promise.resolve(new Map<string, string>()),
  ]);
  const selectedActorLabel = current.actor ? selectedActorMap.get(current.actor) : undefined;

  const actorMap = await resolveActivityActors(
    result.items.flatMap((entry) => (entry.user_id ? [entry.user_id] : [])),
  );
  const items = result.items.map((entry) => describeActivity(entry, actorMap));

  return (
    <div className="space-y-6">
      <PageHeading>יומן פעילות</PageHeading>

      <ActivityFilters
        basePath="/admin/activity"
        current={current}
        actorOptions={actorOptions}
        selectedActorLabel={selectedActorLabel}
      />

      {activeInstance ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">מסונן לפי</span>
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium">
            {INSTANCE_FILTER_LABELS[activeInstance.key]}:{' '}
            <span dir="ltr">{activeInstance.value!.slice(0, 8)}</span>
          </span>
          <Link
            href={clearInstanceHref}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            הצג הכל
          </Link>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState>אין רשומות ביומן התואמות לסינון שבחרת.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {entry.actionLabel}
                    </span>
                    <span className="text-sm font-medium">{entry.summary}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-md border border-border px-2 py-1">
                      {entry.actorLabel}
                    </span>
                    <span className="rounded-md border border-border px-2 py-1">
                      {entry.targetLabel}
                      {entry.event_id ? ` · ${entry.event_id.slice(0, 8)}` : ''}
                    </span>
                    {entry.details ? (
                      <span className="rounded-md border border-border px-2 py-1">
                        {entry.details}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(entry.created_at)}
                </span>
              </div>

              {entry.metaPreview ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    פרטי JSON
                  </summary>
                  <pre
                    className="mt-2 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                    dir="ltr"
                  >
                    {entry.metaPreview}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/activity"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        queryParams={{
          action: current.action,
          actor: current.actor,
          entity: current.entity,
          q: current.q,
          from: current.from,
          to: current.to,
          eventId: current.eventId,
          guestId: current.guestId,
          groupId: current.groupId,
          packageId: current.packageId,
        }}
      />
    </div>
  );
}
