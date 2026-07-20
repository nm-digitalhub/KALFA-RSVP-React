'use client';

import { useState, useTransition } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/forms';
import type { AdminUserDetail } from '@/lib/data/admin/users';

import { Badge, formatCurrency, formatDateTime } from '../../_components';
import { UserActions, type PlatformStaffPanel } from './user-actions';
import { voidCreditAction } from '../actions';

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// Confirm-gated per-credit void. On success it flips to a "בוטל" badge locally
// (immediate feedback on both the self-view and the reason-gated other-user
// view, whose detail is held in client state); a later reload reflects the
// server-side strike-through + ledger via voidCreditAction's revalidate.
function VoidCreditButton({
  creditId,
  userId,
  amount,
}: {
  creditId: string;
  userId: string;
  amount: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return <Badge>בוטל</Badge>;

  const onConfirm = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await voidCreditAction({
        credit_id: creditId,
        user_id: userId,
        reason,
      });
      if (result?.error || result?.fieldErrors) {
        setError(result.error ?? 'נא להזין סיבה לביטול');
        return;
      }
      setDone(true);
      setOpen(false);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="xs" className="text-red-700">
            ביטול
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ביטול זיכוי</AlertDialogTitle>
          <AlertDialogDescription>
            ביטול זיכוי בסך {formatCurrency(amount)} יסיר אותו ממאגר הזיכויים של
            האירוע ומהחיוב הסופי העתידי. השורה נשמרת לביקורת. לא ניתן לבטל זיכוי
            שכבר נוצל בחיוב שנסגר.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <label htmlFor={`void-reason-${creditId}`} className="block text-sm font-medium">
            סיבת הביטול
          </label>
          <input
            id={`void-reason-${creditId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        {error ? <FormError message={error} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>חזרה</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirm}
            disabled={pending || reason.trim().length < 3}
          >
            {pending ? 'מבטל…' : 'ביטול הזיכוי'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
  platformStaff: PlatformStaffPanel | null;
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
                <span
                  className={`truncate text-muted-foreground ${c.voidedAt ? 'line-through' : ''}`}
                >
                  {c.reason}
                  {c.campaignId ? ' · מוגבל לקמפיין' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <span className={c.voidedAt ? 'text-muted-foreground line-through' : ''}>
                    {formatCurrency(c.amount)}
                  </span>
                  <span className="text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                  {c.voidedAt ? (
                    <Badge>בוטל</Badge>
                  ) : (
                    <VoidCreditButton creditId={c.id} userId={user.id} amount={c.amount} />
                  )}
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
