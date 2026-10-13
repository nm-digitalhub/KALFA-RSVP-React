import type { Metadata } from 'next';
import Link from 'next/link';

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  listStaffAssignments,
  type AssignmentListFilters,
  type StaffAssignmentList,
  type StaffAssignmentListRow,
} from '@/lib/data/admin/coupon-assignments';
import { listOffers } from '@/lib/data/admin/offers';
import { formatIsraelDate } from '@/lib/date';
import { Pagination } from '@/components/pagination';
import { sanitizedListSearch } from './list-params';
import { PageHeading, Badge, formatDateTime } from '../_components';

export const metadata: Metadata = { title: 'הטבות אישיות' };

// The staff benefits list (admin-panel change, spec §6): concise rows only — customer,
// offer, unified display status, expiry, details link. Search/filter/sort/pagination are
// URL params the SERVER applies (admin_list_coupon_assignments); the global exception
// count is independent of the page and the filters, and a failed check says so instead
// of pretending a clean bill. Everything heavier lives on the detail page.

const STATUS_OPTIONS: { key: NonNullable<AssignmentListFilters['status']> | ''; label: string }[] = [
  { key: '', label: 'הכול' },
  { key: 'waiting', label: 'ממתינה לשימוש' },
  { key: 'bound', label: 'משויכת לאירוע' },
  { key: 'consumed', label: 'מומשה' },
  { key: 'cancelled', label: 'בוטלה' },
  { key: 'expired', label: 'פגה' },
];

const SORT_OPTIONS: { key: NonNullable<AssignmentListFilters['sort']>; label: string }[] = [
  { key: 'newest', label: 'חדשים תחילה' },
  { key: 'oldest', label: 'ישנים תחילה' },
  { key: 'expiry', label: 'תוקף קרוב' },
];

type RawParams = { q?: string; status?: string; source?: string; offer?: string; sort?: string; page?: string };

// A claimed row whose name and email could not be resolved is shown as exactly that —
// never as "—", which would read as "no customer".
function targetLine(row: StaffAssignmentListRow): { text: string; ltr: boolean } {
  const { name, email, phoneMasked, claimed } = row.target;
  const text = name ?? email ?? phoneMasked;
  if (text) return { text, ltr: name === null };
  return { text: claimed ? 'חשבון — הפרטים אינם זמינים' : '—', ltr: false };
}

export default async function AdminAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  // Optimistic gate; the real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const raw = await searchParams;
  const filters: AssignmentListFilters = {
    q: raw.q,
    status: raw.status as AssignmentListFilters['status'],
    source: raw.source as AssignmentListFilters['source'],
    offer: raw.offer,
    sort: raw.sort as AssignmentListFilters['sort'],
    page: Number(raw.page) || undefined,
  };

  let list: StaffAssignmentList | null = null;
  let offers: { id: string; title: string }[] = [];
  try {
    [list, offers] = await Promise.all([
      listStaffAssignments(filters),
      listOffers().then((all) => all.map((o) => ({ id: o.id, title: o.title }))),
    ]);
  } catch {
    // A fetch failure is an ERROR state with a retry — never an empty list (spec §6).
  }

  const listSearch = sanitizedListSearch(raw as Record<string, string | undefined>);
  const queryParams: Record<string, string | undefined> = {
    q: raw.q,
    status: raw.status,
    source: raw.source,
    offer: raw.offer,
    sort: raw.sort,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <PageHeading>הטבות אישיות</PageHeading>
          <p className="text-sm text-muted-foreground">
            מעקב אחר הטבות שהוקצו ללקוחות בשיחה עם עומר או על ידי הצוות.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/offers"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            הגדרת הצעות
          </Link>
          <Link
            href="/admin/assignments/new"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            הקצאת הטבה
          </Link>
        </div>
      </div>

      {list === null ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm">
          <p className="font-medium text-destructive">טעינת ההטבות נכשלה.</p>
          <Link href="/admin/assignments" className="mt-2 inline-block text-primary hover:underline">
            ניסיון חוזר
          </Link>
        </div>
      ) : (
        <>
          {list.guardCheckStatus === 'failed' ? (
            <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              בדיקת חריגות המימוש אינה זמינה כרגע — אין לראות בכך אישור שאין חריגות.
            </p>
          ) : list.globalGuardCount && list.globalGuardCount > 0 ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              נמצאו {list.globalGuardCount} הטבות הדורשות בדיקת מימוש.{' '}
              <Link href="/admin/assignments?status=guard" className="font-medium underline">
                לצפייה בחריגות
              </Link>
            </p>
          ) : null}

          <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
            <div className="min-w-48 flex-1 space-y-1">
              <label htmlFor="assignments-q" className="block text-xs font-medium text-muted-foreground">
                חיפוש
              </label>
              <input
                id="assignments-q"
                name="q"
                type="search"
                defaultValue={raw.q ?? ''}
                placeholder="אימייל מדויק או מספר טלפון"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="assignments-status" className="block text-xs font-medium text-muted-foreground">
                מצב
              </label>
              <select
                id="assignments-status"
                name="status"
                defaultValue={raw.status ?? ''}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
                {list.globalGuardCount && list.globalGuardCount > 0 ? (
                  <option value="guard">דורש בדיקה</option>
                ) : null}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="assignments-source" className="block text-xs font-medium text-muted-foreground">
                מקור
              </label>
              <select
                id="assignments-source"
                name="source"
                defaultValue={raw.source ?? ''}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">הכול</option>
                <option value="agent">שיחה עם עומר</option>
                <option value="staff">צוות</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="assignments-offer" className="block text-xs font-medium text-muted-foreground">
                הצעה
              </label>
              <select
                id="assignments-offer"
                name="offer"
                defaultValue={raw.offer ?? ''}
                className="h-9 max-w-44 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">הכול</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="assignments-sort" className="block text-xs font-medium text-muted-foreground">
                מיון
              </label>
              <select
                id="assignments-sort"
                name="sort"
                defaultValue={raw.sort ?? 'newest'}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              סינון
            </button>
            {raw.q || raw.status || raw.source || raw.offer || raw.sort ? (
              <Link href="/admin/assignments" className="h-9 content-center text-sm text-muted-foreground hover:underline">
                ניקוי מסננים
              </Link>
            ) : null}
          </form>

          {list.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              {list.total === 0 && !raw.q && !raw.status && !raw.source && !raw.offer ? (
                <>
                  עדיין לא הוקצו הטבות אישיות.{' '}
                  <Link href="/admin/assignments/new" className="text-primary hover:underline">
                    הקצאת הטבה
                  </Link>
                </>
              ) : (
                <>
                  לא נמצאו הטבות התואמות לחיפוש.{' '}
                  <Link href="/admin/assignments" className="text-primary hover:underline">
                    ניקוי מסננים
                  </Link>
                </>
              )}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {list.total} הטבות{list.total > list.pageSize ? ` · עמוד ${list.page}` : ''}
              </p>

              {/* Desktop: a concise table. */}
              <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                <table className="w-full border-collapse text-sm">
                  <thead className="border-b border-border text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-start font-medium">לקוח</th>
                      <th className="px-4 py-3 text-start font-medium">הטבה</th>
                      <th className="px-4 py-3 text-start font-medium">מצב</th>
                      <th className="px-4 py-3 text-start font-medium">תוקף</th>
                      <th className="px-4 py-3 text-start font-medium">
                        <span className="sr-only">פרטים</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3">
                          <span dir={targetLine(row).ltr ? 'ltr' : undefined}>{targetLine(row).text}</span>
                          {!row.target.claimed ? (
                            <div className="text-xs text-muted-foreground">טרם שויכה לחשבון</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">{row.offerTitle || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge>{row.display.label}</Badge>
                          {row.display.reasonLabel ? (
                            <div className="mt-1 text-xs text-muted-foreground">{row.display.reasonLabel}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{formatIsraelDate(row.expiresAt)}</td>
                        <td className="px-4 py-3 text-end">
                          <Link href={`/admin/assignments/${row.id}${listSearch}`} className="text-primary hover:underline">
                            פרטים
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: cards, same content order, no horizontal scroll (spec §6). */}
              <ul className="space-y-3 md:hidden">
                {list.rows.map((row) => (
                  <li key={row.id} className="rounded-lg border border-border p-4 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium" dir={targetLine(row).ltr ? 'ltr' : undefined}>
                          {targetLine(row).text}
                        </p>
                        {!row.target.claimed ? (
                          <p className="text-xs text-muted-foreground">טרם שויכה לחשבון</p>
                        ) : null}
                      </div>
                      <Badge>{row.display.label}</Badge>
                    </div>
                    <p className="mt-2">{row.offerTitle || '—'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      בתוקף עד {formatIsraelDate(row.expiresAt)} · הוקצתה {formatDateTime(row.createdAt)}
                    </p>
                    <Link
                      href={`/admin/assignments/${row.id}${listSearch}`}
                      className="mt-3 inline-flex min-h-11 items-center text-primary hover:underline"
                    >
                      פרטים
                    </Link>
                  </li>
                ))}
              </ul>

              <Pagination
                basePath="/admin/assignments"
                page={list.page}
                pageSize={list.pageSize}
                total={list.total}
                queryParams={queryParams}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
