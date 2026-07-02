import Link from 'next/link';

import { Badge, Pagination, type BadgeVariant } from '@/app/(admin)/admin/_components';
import { buttonVariants } from '@/components/ui/button';
import { requireOwnedEvent } from '@/lib/data/events';
import { listGuests, listGroups } from '@/lib/data/guests';
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
import { GuestRowActions } from './guest-row-actions';
import { ContactStatusCell } from './contact-status-cell';

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
  const event = await requireOwnedEvent(eventId);

  const page = Number(first(sp.page)) || 1;
  const search = first(sp.search) ?? '';
  const sort = first(sp.sort);
  const dir = first(sp.dir);
  const status = first(sp.status);
  const contactStatus = first(sp.contact);
  const groupId = first(sp.group);

  const [result, groups] = await Promise.all([
    listGuests(eventId, {
      page,
      search,
      sort,
      dir,
      status,
      contactStatus,
      groupId,
    }),
    listGroups(eventId),
  ]);

  const { items, total, pageSize } = result;
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  const hasActiveFilters = Boolean(
    search || status || contactStatus || groupId,
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
        current={{ search, sort, dir, status, contact: contactStatus, group: groupId }}
      />

      <p className="text-sm text-muted-foreground">
        {total > 0 ? `${total} מוזמנים` : null}
      </p>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          {hasActiveFilters
            ? 'אין מוזמנים התואמים לסינון.'
            : 'עדיין אין מוזמנים. הוסיפו מוזמן או ייבאו מקובץ.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
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
              {items.map((g) => (
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
                    />
                  </td>
                  {/* Webhook-driven state (Meta WhatsApp): outreach op_status
                      (meaningful OUTCOMES only — see HIDDEN_OP_STATUS), latest
                      delivery, and opt-out. Distinct from the CRM contact status
                      to its right. "—" when there is no webhook state to show. */}
                  <td className="px-4 py-2">
                    {(g.op_status && !HIDDEN_OP_STATUS.has(g.op_status)) ||
                    g.delivery_status ||
                    g.removal_requested ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {g.op_status && !HIDDEN_OP_STATUS.has(g.op_status) ? (
                          <Badge variant={OP_STATUS_VARIANTS[g.op_status]}>
                            {OP_STATUS_LABELS[g.op_status]}
                          </Badge>
                        ) : null}
                        {g.delivery_status ? (
                          <Badge
                            variant={deliveryStatusVariant(g.delivery_status)}
                          >
                            {deliveryStatusLabel(g.delivery_status)}
                          </Badge>
                        ) : null}
                        {g.removal_requested ? (
                          <Badge variant={REMOVAL_REQUESTED_VARIANT}>
                            {REMOVAL_REQUESTED_LABEL}
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {g.status === 'attending'
                      ? `${(g.confirmed_adults ?? 0) + (g.confirmed_kids ?? 0)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <GuestRowActions eventId={eventId} guestId={g.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        }}
      />
    </div>
  );
}
