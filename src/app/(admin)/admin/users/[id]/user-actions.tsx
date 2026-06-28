'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice } from '@/components/forms';

import {
  grantAdminAction,
  revokeAdminAction,
  suspendUserAction,
  reactivateUserAction,
  grantCreditAction,
  updatePlanAction,
} from '../actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';
const UPDATABLE = new Set(['pending', 'failed']);

function RowSubmit({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: 'danger';
}) {
  const { pending } = useFormStatus();
  const style =
    variant === 'danger'
      ? 'bg-red-50 text-red-700 hover:bg-red-100'
      : 'bg-primary text-primary-foreground hover:opacity-90';
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60 ${style}`}
    >
      {pending ? 'רגע…' : children}
    </button>
  );
}

export function UserActions({
  userId,
  isPlatformAdmin,
  suspended,
  isSelf,
  events,
  orders,
  packages,
}: {
  userId: string;
  isPlatformAdmin: boolean;
  suspended: boolean;
  isSelf: boolean;
  events: { id: string; name: string }[];
  orders: { id: string; packageName: string | null; status: string }[];
  packages: { id: string; name: string; tier: string | null }[];
}) {
  const [adminState, adminAction] = useActionState(
    isPlatformAdmin ? revokeAdminAction : grantAdminAction,
    null,
  );
  const [suspendState, suspendAction] = useActionState(
    suspended ? reactivateUserAction : suspendUserAction,
    null,
  );
  const [creditState, creditAction] = useActionState(grantCreditAction, null);
  const [planState, planAction] = useActionState(updatePlanAction, null);

  const updatableOrders = orders.filter((o) => UPDATABLE.has(o.status));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">פעולות מנהל</h2>

      <section className={sectionClass}>
        <h3 className="font-medium">הרשאות וסטטוס</h3>
        <div className="flex flex-wrap items-center gap-3">
          <form action={adminAction}>
            <input type="hidden" name="user_id" value={userId} />
            <RowSubmit variant={isPlatformAdmin ? 'danger' : undefined}>
              {isPlatformAdmin ? 'שלילת הרשאת מנהל' : 'הענקת הרשאת מנהל'}
            </RowSubmit>
          </form>

          {isSelf ? null : (
            <form action={suspendAction}>
              <input type="hidden" name="user_id" value={userId} />
              <RowSubmit variant={suspended ? undefined : 'danger'}>
                {suspended ? 'שחזור משתמש' : 'השהיית משתמש'}
              </RowSubmit>
            </form>
          )}
        </div>
        {adminState?.error ? <FormError message={adminState.error} /> : null}
        {adminState?.notice ? <FormNotice message={adminState.notice} /> : null}
        {suspendState?.error ? <FormError message={suspendState.error} /> : null}
        {suspendState?.notice ? <FormNotice message={suspendState.notice} /> : null}
      </section>

      {events.length > 0 ? (
        <section className={sectionClass}>
          <h3 className="font-medium">מתן הטבה (זיכוי)</h3>
          <form action={creditAction} className="space-y-3">
            <FormError message={creditState?.error} />
            <FormNotice message={creditState?.notice} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="credit-event" className="mb-1 block text-sm font-medium">
                  אירוע
                </label>
                <select id="credit-event" name="event_id" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    בחר/י אירוע
                  </option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <FieldError errors={creditState?.fieldErrors?.event_id} />
              </div>
              <div>
                <label htmlFor="credit-amount" className="mb-1 block text-sm font-medium">
                  סכום (₪)
                </label>
                <input
                  id="credit-amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  className={inputClass}
                />
                <FieldError errors={creditState?.fieldErrors?.amount} />
              </div>
              <div>
                <label htmlFor="credit-reason" className="mb-1 block text-sm font-medium">
                  סיבה
                </label>
                <input id="credit-reason" name="reason" type="text" required className={inputClass} />
                <FieldError errors={creditState?.fieldErrors?.reason} />
              </div>
            </div>
            <RowSubmit>מתן הטבה</RowSubmit>
          </form>
        </section>
      ) : null}

      {updatableOrders.length > 0 && packages.length > 0 ? (
        <section className={sectionClass}>
          <h3 className="font-medium">עדכון תוכנית</h3>
          <p className="text-sm text-muted-foreground">
            ניתן לעדכן רק הזמנות שטרם שולמו.
          </p>
          <form action={planAction} className="space-y-3">
            <FormError message={planState?.error} />
            <FormNotice message={planState?.notice} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="plan-order" className="mb-1 block text-sm font-medium">
                  הזמנה
                </label>
                <select id="plan-order" name="order_id" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    בחר/י הזמנה
                  </option>
                  {updatableOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {(o.packageName ?? 'ללא חבילה') + ' · ' + o.status}
                    </option>
                  ))}
                </select>
                <FieldError errors={planState?.fieldErrors?.order_id} />
              </div>
              <div>
                <label htmlFor="plan-package" className="mb-1 block text-sm font-medium">
                  חבילה חדשה
                </label>
                <select id="plan-package" name="package_id" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    בחר/י חבילה
                  </option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.tier ? ` · ${p.tier}` : ''}
                    </option>
                  ))}
                </select>
                <FieldError errors={planState?.fieldErrors?.package_id} />
              </div>
            </div>
            <RowSubmit>עדכון תוכנית</RowSubmit>
          </form>
        </section>
      ) : null}
    </div>
  );
}
