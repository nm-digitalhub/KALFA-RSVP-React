import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  listFleetActivity,
  listFleetRoles,
  type FleetActivityEntry,
} from '@/lib/data/admin/fleet';
import { LocalDateTime } from '@/components/local-date-time';
import { EmptyState, PageHeading, Pagination, parsePageParam, firstParam } from '../_components';
import {
  ComposeActivityCard,
  GOAL_STATUS_LABEL,
  GOAL_STATUS_VARIANT,
  KIND_LABEL,
  KIND_VARIANT,
  STATUS_LABEL,
  STATUS_VARIANT,
} from './fleet-client';
import { FleetSearchBar } from './fleet-search-bar';
import { GoalDetailPanel, RequestDetailPanel } from './activity-detail';

export const metadata: Metadata = { title: 'פניות סוכנים' };

const BASE_PATH = '/admin/fleet';

// Admin: the autonomous-fleet activity feed (/admin/fleet) — a request (one
// answer, done) and a goal (persistent, the role advances it between runs)
// used to be four disconnected sections (compose request / pending / goals /
// history table); redesigned as ONE master-detail inbox in the same idiom as
// /admin/contacts: one flat filterable list (see listFleetActivity — "needs
// attention" items sort ahead of everything else rather than living in a
// separate boxed section) and one detail pane. Desktop shows the list and the
// selected item side by side; mobile shows one pane at a time, switched by
// whether `id` is present — same pure CSS/data-attribute split `contacts`
// already uses. Authorization: the (admin) layout requireAdmin() boundary +
// manage_settings in the data layer + RLS.
export default async function AdminFleetPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[];
    id?: string | string[];
    type?: string | string[];
    role?: string | string[];
    kind?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const selectedId = firstParam(sp.id);
  const selectedType = firstParam(sp.type) === 'goal' ? 'goal' : 'request';
  const roleFilter = firstParam(sp.role);
  const kindFilter = firstParam(sp.kind);

  const [activity, roles] = await Promise.all([
    listFleetActivity({ page, role: roleFilter, kind: kindFilter }),
    listFleetRoles(),
  ]);

  // Same split as contacts' filterParams/linkParams: `filterParams` alone
  // goes to <Pagination> (which computes its OWN target page — folding a
  // stale page into it would break prev/next), `linkParams` carries the
  // current page forward on top of that for row/back-link hrefs.
  const filterParams = { role: roleFilter, kind: kindFilter };
  const linkParams = { ...filterParams, page: page > 1 ? String(page) : undefined };
  const hrefWith = (overrides: Record<string, string | undefined>): string => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...linkParams, ...overrides })) {
      if (v) qs.set(k, v);
    }
    const s = qs.toString();
    return s ? `${BASE_PATH}?${s}` : BASE_PATH;
  };

  const hasSelection = Boolean(selectedId);

  return (
    <div className="space-y-6">
      <PageHeading>פניות הסוכנים (Fleet)</PageHeading>

      <ComposeActivityCard roles={roles} />

      <FleetSearchBar basePath={BASE_PATH} roles={roles} role={roleFilter} kind={kindFilter} />

      {activity.items.length === 0 ? (
        <EmptyState>
          {roleFilter || kindFilter
            ? 'לא נמצאה פעילות התואמת לסינון.'
            : 'אין עדיין פעילות סוכנים — כל הסוכנים מסודרים 🎉'}
        </EmptyState>
      ) : (
        <div
          className="group/fleet flex flex-col gap-4 md:flex-row md:items-start"
          data-has-selection={hasSelection}
        >
          <div className="group-data-[has-selection=true]/fleet:max-md:hidden w-full shrink-0 md:w-[360px]">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {activity.items.map((item) => (
                <ActivityRow
                  key={`${item.entryKind}-${item.id}`}
                  item={item}
                  href={hrefWith({ id: item.id, type: item.entryKind })}
                  isSelected={selectedId === item.id}
                />
              ))}
            </ul>
            <div className="mt-4">
              <Pagination
                basePath={BASE_PATH}
                page={activity.page}
                pageSize={activity.pageSize}
                total={activity.total}
                queryParams={filterParams}
              />
            </div>
          </div>

          <div
            className="group-data-[has-selection=false]/fleet:max-md:hidden min-w-0 flex-1 rounded-lg border border-border"
          >
            {selectedId ? (
              <>
                {/* sticky, not a plain block: the detail pane below is long
                    (timeline/attachments/thread/related) — a non-sticky back
                    link scrolls out of view within the first screen, and from
                    then on there is no way back to the list without scrolling
                    all the way up. That reads as "navigated to a separate
                    page" even though the URL never left /admin/fleet. Mirrors
                    /admin/contacts' ContactDetail header, which sticks for the
                    same reason. */}
                <p className="sticky top-0 z-10 border-b border-border bg-background p-3 text-sm text-muted-foreground md:hidden">
                  <Link
                    href={hrefWith({ id: undefined, type: undefined })}
                    className="text-primary hover:underline"
                  >
                    ← חזרה לרשימה
                  </Link>
                </p>
                {selectedType === 'goal' ? (
                  <GoalDetailPanel id={selectedId} />
                ) : (
                  <RequestDetailPanel id={selectedId} roles={roles} />
                )}
              </>
            ) : (
              <div className="hidden h-full items-center justify-center p-10 text-center text-muted-foreground md:flex">
                בחרו פנייה או מטרה מהרשימה כדי לצפות בפרטים
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityRow({
  item,
  href,
  isSelected,
}: {
  item: FleetActivityEntry;
  href: string;
  isSelected: boolean;
}) {
  const statusLabel =
    item.entryKind === 'goal'
      ? (GOAL_STATUS_LABEL[item.status] ?? item.status)
      : (STATUS_LABEL[item.status] ?? item.status);
  const statusVariant =
    item.entryKind === 'goal'
      ? (GOAL_STATUS_VARIANT[item.status] ?? 'neutral')
      : (STATUS_VARIANT[item.status] ?? 'neutral');
  // For a goal there is no finer-grained "kind" — the badge just says מטרה.
  // For a request, KIND_LABEL (שאלה/בקשת אישור/עדכון) already communicates
  // "this is a request" on its own, so one badge does both jobs rather than
  // stacking a generic "בקשה" label alongside it.
  const typeLabel = item.entryKind === 'goal' ? 'מטרה' : (KIND_LABEL[item.data.kind] ?? item.data.kind);
  const typeVariant = item.entryKind === 'goal' ? 'neutral' : (KIND_VARIANT[item.data.kind] ?? 'secondary');

  return (
    <li>
      <Link
        href={href}
        aria-current={isSelected ? 'true' : undefined}
        className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted aria-[current=true]:bg-muted"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate font-medium">{item.title}</p>
          <span className="shrink-0 text-xs text-muted-foreground">
            <LocalDateTime iso={item.displayAt} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={typeVariant}>{typeLabel}</Badge>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          <span className="truncate text-xs text-muted-foreground">{item.role}</span>
        </div>
      </Link>
    </li>
  );
}
