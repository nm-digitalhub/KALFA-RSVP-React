import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isPlatformOwner, requirePlatformPermission } from '@/lib/auth/dal';
import { getUserDetail } from '@/lib/data/admin/users';
import {
  getUserStaffRoleId,
  listPlatformRoles,
} from '@/lib/data/admin/platform-roles';

import { PageHeading, Badge, formatCurrency, formatDateTime } from '../../_components';
import { UserActions } from './user-actions';

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePlatformPermission('manage_staff');
  const user = await getUserDetail(id);
  if (!user) {
    notFound();
  }

  // Staff-role management is owner-only. Fetch the role catalog + this user's
  // current staff role only when the viewer is a platform owner; otherwise the
  // selector is hidden entirely.
  const owner = await isPlatformOwner();
  const platformStaff = owner
    ? {
        roles: (await listPlatformRoles()).map((r) => ({ id: r.id, label: r.label })),
        currentRoleId: await getUserStaffRoleId(user.id),
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeading>{user.fullName || user.email || 'משתמש'}</PageHeading>
        <Link
          href="/admin/users"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          חזרה לרשימה
        </Link>
      </div>

      <section className={sectionClass}>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">פרטי משתמש</h2>
          {user.isPlatformAdmin ? <Badge>מנהל מערכת</Badge> : null}
          {user.suspended ? <Badge>מושהה</Badge> : null}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">אימייל</dt>
            <dd dir="ltr">{user.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">שם מלא</dt>
            <dd>{user.fullName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">טלפון</dt>
            <dd dir="ltr">{user.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">נרשם</dt>
            <dd>{user.createdAt ? formatDateTime(user.createdAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">כניסה אחרונה</dt>
            <dd>{user.lastSignInAt ? formatDateTime(user.lastSignInAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">אירועים בבעלות</dt>
            <dd>{user.ownedEventCount}</dd>
          </div>
        </dl>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">ארגונים ({user.orgs.length})</h2>
        {user.orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין ארגונים.</p>
        ) : (
          <ul className="divide-y divide-border">
            {user.orgs.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                <span>{o.name || '—'}</span>
                <Badge>{o.roleLabel || '—'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {user.credits.length > 0 ? (
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold">הטבות שניתנו</h2>
          <ul className="divide-y divide-border">
            {user.credits.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="truncate text-muted-foreground">
                  {c.reason}
                  {c.campaignId ? ' · מוגבל לקמפיין' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <span>{formatCurrency(c.amount)}</span>
                  <span className="text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
          {user.creditBalances.length > 0 ? (
            <ul className="space-y-1 border-t border-border pt-3 text-sm">
              {user.creditBalances.map((b) => (
                <li key={b.eventId} className="flex items-center justify-between gap-2">
                  <span className="truncate text-muted-foreground">{b.eventName || '—'}</span>
                  <span>
                    נוצל {formatCurrency(b.applied)} · נותר {formatCurrency(b.remaining)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <UserActions
        userId={user.id}
        isPlatformAdmin={user.isPlatformAdmin}
        suspended={user.suspended}
        isSelf={user.id === actor.id}
        events={user.events}
        platformStaff={platformStaff}
      />
    </div>
  );
}
