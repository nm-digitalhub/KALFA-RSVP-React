import { requirePlatformPermission } from '@/lib/auth/dal';
import Link from 'next/link';

import { listAllUsers } from '@/lib/data/admin/users';

import { PageHeading, EmptyState, Badge, Pagination, parsePageParam } from '../_components';

export const metadata = { title: 'משתמשים' };

// Admin user management — list of all platform users (search by email +
// pagination). Authorization is enforced by the /admin layout (requireAdmin)
// and again in listAllUsers.
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  // Optimistic gate: redirect early instead of rendering an empty page. The
  // real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_staff');
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const search = typeof sp.q === 'string' && sp.q.trim() !== '' ? sp.q : undefined;

  const { items, total, page: current, pageSize } = await listAllUsers({ page, search });

  return (
    <div className="space-y-6">
      <PageHeading>משתמשים</PageHeading>

      <form method="get" action="/admin/users" className="flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={search ?? ''}
          placeholder="חיפוש לפי אימייל…"
          dir="ltr"
          className="w-full max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          חיפוש
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState>לא נמצאו משתמשים.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((u) => (
            <li key={u.id} className="px-4 py-3">
              <Link
                href={`/admin/users/${u.id}`}
                className="flex flex-wrap items-center justify-between gap-2 hover:opacity-80"
              >
                <div className="min-w-0">
                  <p className="font-medium">{u.fullName || u.email || '—'}</p>
                  <p className="truncate text-sm text-muted-foreground" dir="ltr">
                    {u.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {u.isPlatformAdmin ? <Badge>מנהל מערכת</Badge> : null}
                  {u.suspended ? <Badge>מושהה</Badge> : null}
                  <Badge>{u.orgCount} ארגונים</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/users"
        page={current}
        pageSize={pageSize}
        total={total}
        queryParams={{ q: search }}
      />
    </div>
  );
}
