'use client';

import type { AdminUserDetail } from '@/lib/data/admin/users';

import { Badge, formatCurrency, formatDateTime } from '../../_components';
import { UserActions, type StaffRoleOption } from './user-actions';

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// Presentational body of the user-detail page: the customer's PII (identity,
// orgs, granted benefits) plus the admin action panel. Rendered directly by the
// page for the self-view, or by UserDetailGate AFTER a break-glass reason has
// been supplied and the audit row written. Kept as a client component so the
// gate can mount it post-reveal; it holds no server-only imports (the DTO type
// is erased at compile time via `import type`).
export function UserDetailView({
  user,
  actorId,
  platformStaff,
}: {
  user: AdminUserDetail;
  actorId: string;
  platformStaff: { roles: StaffRoleOption[]; currentRoleId: string | null } | null;
}) {
  return (
    <div className="space-y-6">
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
        isSelf={user.id === actorId}
        events={user.events}
        platformStaff={platformStaff}
      />
    </div>
  );
}
