import type { ReactNode } from 'react';
import Link from 'next/link';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Pagination } from '@/components/pagination';
import { buttonVariants } from '@/components/ui/button';
import { requireEventAccess } from '@/lib/data/events';
import {
  listGuests,
  listGroups,
  getGuestTotals,
  type GuestListItem,
} from '@/lib/data/guests';
import type { Database } from '@/lib/supabase/types';
import {
  GUEST_STATUS_LABELS,
  OP_STATUS_LABELS,
  OP_STATUS_VARIANTS,
  deliveryStatusLabel,
  deliveryStatusVariant,
  REMOVAL_REQUESTED_LABEL,
  REMOVAL_REQUESTED_VARIANT,
} from './labels';

type GuestStatus = Database['public']['Enums']['guest_status'];
type ContactOpStatus = Database['public']['Enums']['contact_op_status'];

// Guest status → Badge variant. Exhaustive so a new enum value is a compile error.
const GUEST_STATUS_VARIANTS: Record<GuestStatus, BadgeVariant> = {
  pending: 'warning',
  attending: 'success',
  declined: 'destructive',
  maybe: 'warning',
};

// op_status values that are pre-outreach DEFAULTS, not webhook OUTCOMES — they'd
// add noise on every linked guest, so the "מצב הודעות" column suppresses them
// (folds into "—"). All other states (sent/delivered/read/responded, the call
// states, wrong_number, reached_billed, not_reached) still render.
const HIDDEN_OP_STATUS: ReadonlySet<ContactOpStatus> = new Set<ContactOpStatus>([
  'pending_contact',
  'not_eligible',
]);
import { GuestListControls } from './guest-list-controls';
import { GroupsManager } from './groups-manager';
import { GuestRowActions } from './guest-row-actions';
import { ContactStatusCell } from './contact-status-cell';

// Webhook-driven state (Meta WhatsApp): meaningful op_status OUTCOMES (see
// HIDDEN_OP_STATUS), latest delivery, and opt-out. Returns null when there is
// nothing to show, so the table cell can fold to "—" and the mobile card can
// omit the row entirely. Single source of truth for both layouts.
function webhookStateBadges(g: GuestListItem): ReactNode {
  const showOp = g.op_status && !HIDDEN_OP_STATUS.has(g.op_status);
  if (!showOp && !g.delivery_status && !g.removal_requested) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {g.op_status && !HIDDEN_OP_STATUS.has(g.op_status) ? (
        <Badge variant={OP_STATUS_VARIANTS[g.op_status]}>
          {OP_STATUS_LABELS[g.op_status]}
        </Badge>
      ) : null}
      {g.delivery_status ? (
        <Badge variant={deliveryStatusVariant(g.delivery_status)}>
          {deliveryStatusLabel(g.delivery_status)}
        </Badge>
      ) : null}
      {g.removal_requested ? (
        <Badge variant={REMOVAL_REQUESTED_VARIANT}>
          {REMOVAL_REQUESTED_LABEL}
        </Badge>
      ) : null}
    </div>
  );
}

// Confirmed headcount for an attending guest (adults + kids), with the
// over-invited flag. Returns null for non-attending guests. Shared by table +
// card so the "prefers WhatsApp-confirmed headcount" rule lives in one place.
function actualConfirmedCount(g: GuestListItem): number | null {
  if (g.status !== 'attending') return null;

  const headcount = g.confirmed_headcount ?? 0;
  if (headcount >= 1 && headcount <= 10) return headcount;

  const adults = Math.max(g.confirmed_adults ?? 0, 0);
  const kids = Math.max(g.confirmed_kids ?? 0, 0);
  const sum = adults + kids;

  return sum > 0 ? sum : null;
}

function effectiveAttendingCount(g: GuestListItem): number | null {
  if (g.status !== 'attending') return null;

  const actual = actualConfirmedCount(g);
  if (actual !== null) return actual;

  return g.expected_count && g.expected_count > 0 ? g.expected_count : 1;
}

function headcountValue(g: GuestListItem): ReactNode {
  if (g.status !== 'attending') {
    return null;
  }

  const actual = actualConfirmedCount(g);
  const effective = effectiveAttendingCount(g);
  const adults = Math.max(g.confirmed_adults ?? 0, 0);
  const kids = Math.max(g.confirmed_kids ?? 0, 0);

  return (
    <div className="space-y-0.5">
      <span className="inline-flex items-center gap-1.5">
        {actual !== null ? actual : 'לא נמסרה כמות'}
        {g.over_invited ? (
          <Badge variant="warning">מעל הכמות שהוזמנה</Badge>
        ) : null}
      </span>
      <p className="text-xs text-muted-foreground">
        מבוגרים: {adults} · ילדים: {kids} · צפי: {g.expected_count ?? '—'} · נספר כ:{' '}
        {effective ?? '—'}
      </p>
    </div>
  );
}

// Mobile / tablet (< lg) presentation of a single guest. The desktop table has
// 8 columns and forces horizontal scrolling below ~1024px, so under lg each
// guest is a compact list row instead — two lines plus an optional third:
//   line 1: status badge · name · edit/delete (icons)
//   line 2: phone · group · headcount   |   contact-status quick-select
//   line 3: over-invite flag + WhatsApp webhook badges (only when present)
// Denser than a stacked card (~90–115px vs ~230px) while dropping no
// information and using no fixed width.
function GuestCard({
  eventId,
  g,
  groupLabel,
}: {
  eventId: string;
  g: GuestListItem;
  groupLabel: string | null;
}) {
  const webhook = webhookStateBadges(g);
  const actualCount = actualConfirmedCount(g);
  const effectiveCount = effectiveAttendingCount(g);
  const adults = Math.max(g.confirmed_adults ?? 0, 0);
  const kids = Math.max(g.confirmed_kids ?? 0, 0);

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Badge variant={GUEST_STATUS_VARIANTS[g.status]}>
          {GUEST_STATUS_LABELS[g.status]}
        </Badge>
        <p className="min-w-0 flex-1 truncate font-medium">{g.full_name}</p>
        <GuestRowActions eventId={eventId} guestId={g.id} compact />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          <span dir="ltr">{g.phone ?? '—'}</span>
          {groupLabel ? ` · ${groupLabel}` : ''}
          {effectiveCount !== null ? (
            <>
              {' · '}
              <span className={g.over_invited ? 'text-warning' : undefined}>
                אישרו {actualCount !== null ? actualCount : 'לא נמסרה כמות'}
              </span>
            </>
          ) : null}
        </p>
        <ContactStatusCell
          eventId={eventId}
          guestId={g.id}
          value={g.contact_status}
          scope="card"
        />
      </div>

      {effectiveCount !== null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          מבוגרים: {adults} · ילדים: {kids} · צפי: {g.expected_count ?? '—'} · נספר כ:{' '}
          {effectiveCount}
        </p>
      ) : null}

      {g.over_invited || webhook ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {g.over_invited ? (
            <Badge variant="warning">מעל הכמות שהוזמנה</Badge>
          ) : null}
          {webhook}
        </div>
      ) : null}
    </li>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function GuestsPage({ params, searchParams }: PageProps) {
  const { id: eventId } = await params;
  const sp = await searchParams;

  // requireOwnedEvent here too so the page title can show the event name and the
  // 404 happens before any list query if the event is not owned.
  const event = await requireEventAccess(eventId, 'guests', 'view');

  const page = Number(first(sp.page)) || 1;
  const search = first(sp.search) ?? '';
  const sort = first(sp.sort);
  const dir = first(sp.dir);
  const status = first(sp.status);
  const contactStatus = first(sp.contact);
  const groupId = first(sp.group);
  const overInvited = first(sp.over) === '1';

  const [result, groups, totals] = await Promise.all([
    listGuests(eventId, {
      page,
      search,
      sort,
      dir,
      status,
      contactStatus,
      groupId,
      overInvited,
    }),
    listGroups(eventId),
    getGuestTotals(eventId),
  ]);

  const { items, total, pageSize } = result;
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  const hasActiveFilters = Boolean(
    search || status || contactStatus || groupId || overInvited,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">מוזמנים</h1>
          <p className="text-sm text-muted-foreground">{event.name}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/app/events/${eventId}/guests/import`}
            className={buttonVariants({ variant: 'outline' })}
          >
            ייבוא מקובץ
          </Link>
          <Link
            href={`/app/events/${eventId}/guests/new`}
            className={buttonVariants()}
          >
            מוזמן חדש
          </Link>
        </div>
      </div>

      <GuestListControls
        eventId={eventId}
        groups={groups}
        current={{ search, sort, dir, status, contact: contactStatus, group: groupId, over: overInvited ? '1' : undefined }}
        hasActiveFilters={hasActiveFilters}
      />

      <GroupsManager eventId={eventId} groups={groups} />

      {/* People-level truth for the WHOLE event (unaffected by filters):
          a household row invited as 4 counts as 4 people; "אישרו" prefers the
          WhatsApp-confirmed headcount over adults+kids. */}
      {totals.rows > 0 ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">מוזמנים (אנשים)</dt>
            <dd className="text-xl font-bold">{totals.invited_people}</dd>
            <p className="text-xs text-muted-foreground">{totals.rows} רשומות</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">אישרו הגעה</dt>
            <dd className="text-xl font-bold text-primary">{totals.attending_people}</dd>
            <p className="text-xs text-muted-foreground">{totals.attending_rows} רשומות</p>
            {totals.over_invited_rows > 0 ? (
              /* Business overage, deliberately NOT styled as an error: the
                 owner's estimate differed from the guests' real answers. */
              <p className="text-xs text-warning">
                מתוכם {totals.over_invited_rows} חריגות · תוספת של{' '}
                {totals.over_invited_people} אנשים
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">לא מגיעים</dt>
            <dd className="text-xl font-bold">{totals.declined_rows}</dd>
            <p className="text-xs text-muted-foreground">רשומות</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">טרם השיבו</dt>
            <dd className="text-xl font-bold">{totals.pending_rows + totals.maybe_rows}</dd>
            <p className="text-xs text-muted-foreground">
              {totals.maybe_rows > 0 ? `מתוכם ${totals.maybe_rows} אולי` : 'רשומות'}
            </p>
          </div>
        </dl>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {total > 0 ? `${total} רשומות ברשימה` : null}
      </p>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          {hasActiveFilters
            ? 'אין מוזמנים התואמים לסינון.'
            : 'עדיין אין מוזמנים. הוסיפו מוזמן או ייבאו מקובץ.'}
        </div>
      ) : (
        <>
          {/* Mobile / tablet (< lg): compact full-width list rows (GuestCard).
              The 8-column table only fits comfortably at ~lg+, so below that
              each guest is a row that uses the whole width instead of forcing
              horizontal scroll. */}
          <ul className="space-y-3 lg:hidden">
            {items.map((g) => (
              <GuestCard
                key={g.id}
                eventId={eventId}
                g={g}
                groupLabel={g.group_id ? groupName.get(g.group_id) ?? null : null}
              />
            ))}
          </ul>

          {/* Desktop (lg+): the full table. Still wrapped in overflow-x-auto so
              it scrolls internally on the rare narrow-lg case rather than
              widening the page (the shell also clips at SidebarInset). */}
          <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
            <table className="w-full min-w-[44rem] text-start text-sm whitespace-nowrap">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">שם</th>
                  <th className="px-4 py-2 font-medium">טלפון</th>
                  <th className="px-4 py-2 font-medium">קבוצה</th>
                  <th className="px-4 py-2 font-medium">סטטוס</th>
                  <th className="px-4 py-2 font-medium">יצירת קשר</th>
                  <th className="px-4 py-2 font-medium">מצב הודעות</th>
                  <th className="px-4 py-2 font-medium">אישרו</th>
                  <th className="px-4 py-2 font-medium">
                    <span className="sr-only">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((g) => {
                  const webhook = webhookStateBadges(g);
                  const headcount = headcountValue(g);
                  return (
                    <tr key={g.id}>
                      <td className="px-4 py-2 font-medium">{g.full_name}</td>
                      <td className="px-4 py-2" dir="ltr">
                        {g.phone ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {g.group_id ? groupName.get(g.group_id) ?? '—' : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={GUEST_STATUS_VARIANTS[g.status]}>
                          {GUEST_STATUS_LABELS[g.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <ContactStatusCell
                          eventId={eventId}
                          guestId={g.id}
                          value={g.contact_status}
                          scope="row"
                        />
                      </td>
                      {/* Webhook-driven state (Meta WhatsApp) — see
                          webhookStateBadges. "—" when there is nothing to show. */}
                      <td className="px-4 py-2">
                        {webhook ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {headcount ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        <GuestRowActions eventId={eventId} guestId={g.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination
        basePath={`/app/events/${eventId}/guests`}
        page={page}
        pageSize={pageSize}
        total={total}
        queryParams={{
          search,
          sort,
          dir,
          status,
          contact: contactStatus,
          group: groupId,
          over: overInvited ? '1' : undefined,
        }}
      />
    </div>
  );
}
