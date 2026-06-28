import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/dal';
import { getUserDetail } from '@/lib/data/admin/users';
import { listPackages } from '@/lib/data/admin/packages';

import { PageHeading, Badge, formatCurrency, formatDateTime } from '../../_components';
import { UserActions } from './user-actions';

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAdmin();
  const user = await getUserDetail(id);
  if (!user) {
    notFound();
  }
  const packages = (await listPackages()).filter((p) => p.active);

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

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">תוכנית / חבילות</h2>
        {user.orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין חבילות.</p>
        ) : (
          <ul className="divide-y divide-border">
            {user.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium">{o.packageName ?? '—'}</span>
                  {o.tier ? <span className="text-muted-foreground"> · {o.tier}</span> : null}
                  {o.withAiAddon ? <span className="text-muted-foreground"> · תוסף AI</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <span>{formatCurrency(o.totalWithVat)}</span>
                  <Badge>{o.status}</Badge>
                </div>
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
                <span className="truncate text-muted-foreground">{c.reason}</span>
                <div className="flex items-center gap-2">
                  <span>{formatCurrency(c.amount)}</span>
                  <span className="text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <UserActions
        userId={user.id}
        isPlatformAdmin={user.isPlatformAdmin}
        suspended={user.suspended}
        isSelf={user.id === actor.id}
        events={user.events}
        orders={user.orders}
        packages={packages.map((p) => ({ id: p.id, name: p.name, tier: p.tier }))}
      />
    </div>
  );
}
