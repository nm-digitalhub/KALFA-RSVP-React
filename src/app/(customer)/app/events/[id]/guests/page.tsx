import Link from 'next/link';

import { requireOwnedEvent } from '@/lib/data/events';
import { listGuests, listGroups } from '@/lib/data/guests';
import { GUEST_STATUS_LABELS } from './labels';
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
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  // Preserve current filters when building pagination links.
  function pageHref(targetPage: number): string {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (sort) q.set('sort', sort);
    if (dir) q.set('dir', dir);
    if (status) q.set('status', status);
    if (contactStatus) q.set('contact', contactStatus);
    if (groupId) q.set('group', groupId);
    q.set('page', String(targetPage));
    return `/app/events/${eventId}/guests?${q.toString()}`;
  }

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
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            ייבוא מקובץ
          </Link>
          <Link
            href={`/app/events/${eventId}/guests/new`}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
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
          <table className="w-full text-right text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">שם</th>
                <th className="px-4 py-2 font-medium">טלפון</th>
                <th className="px-4 py-2 font-medium">קבוצה</th>
                <th className="px-4 py-2 font-medium">סטטוס</th>
                <th className="px-4 py-2 font-medium">יצירת קשר</th>
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
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                      {GUEST_STATUS_LABELS[g.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <ContactStatusCell
                      eventId={eventId}
                      guestId={g.id}
                      value={g.contact_status}
                    />
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

      {totalPages > 1 ? (
        <nav
          className="flex items-center justify-center gap-2"
          aria-label="עימוד"
        >
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
            >
              הקודם
            </Link>
          ) : null}
          <span className="text-sm text-muted-foreground">
            עמוד {page} מתוך {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
            >
              הבא
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
