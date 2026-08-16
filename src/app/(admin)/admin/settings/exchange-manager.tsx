'use client';

import { useActionState } from 'react';
import { CalendarClock, Mail } from 'lucide-react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import type { ExchangeConnectionView } from '@/lib/data/exchange-connections';
import { formatIsraelDate } from '@/lib/date';
import {
  createExchangeConnectionAction,
  createExchangeTestAppointmentAction,
  deleteExchangeTestAppointmentAction,
  listExchangeCalendarsAction,
  revokeExchangeConnectionAction,
  testExchangeConnectionAction,
} from './exchange-actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

const STATUS_LABEL: Record<ExchangeConnectionView['status'], string> = {
  pending: 'ממתין לבדיקה',
  verified: 'מאומת',
  failed: 'נכשל',
  revoked: 'נותק',
};

const STATUS_BADGE_CLASS: Record<ExchangeConnectionView['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  verified: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  revoked: 'bg-muted text-muted-foreground',
};

function ConnectForm({
  modeNotice,
  needsPassword,
}: {
  modeNotice: string | null;
  needsPassword: boolean;
}) {
  const [state, action] = useActionState(createExchangeConnectionAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormNotice message={state?.notice} />
      <FormError message={state?.error} />
      {modeNotice ? <p className="text-sm text-muted-foreground">{modeNotice}</p> : null}

      <div>
        <label htmlFor="mailboxEmail" className="mb-1 block text-sm font-medium">
          כתובת תיבת הדואר
        </label>
        <input
          id="mailboxEmail"
          name="mailboxEmail"
          type="email"
          dir="ltr"
          inputMode="email"
          autoComplete="off"
          placeholder="name@kalfa.me"
          className={`${inputClass} text-start`}
        />
        <FieldError errors={state?.fieldErrors?.mailboxEmail} />
      </div>

      {/* Shown ONLY when EWS is the active provider, because only NTLM has any
          use for it. Under Graph the app authenticates with its own certificate
          and never reads a mailbox password — asking for one made an admin hand
          over a live secret to create a connection that would not use it, and
          then stored it encrypted indefinitely. */}
      {needsPassword ? (
        <div>
          <label htmlFor="exchangePassword" className="mb-1 block text-sm font-medium">
            סיסמה
          </label>
          <input
            id="exchangePassword"
            name="password"
            type="password"
            dir="ltr"
            autoComplete="off"
            className={`${inputClass} text-start`}
          />
          <FieldError errors={state?.fieldErrors?.password} />
          <p className="mt-1 text-xs text-muted-foreground">
            הסיסמה מוצפנת בשרת מיד עם השליחה ואינה מוצגת שוב במסך זה.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          החיבור מאומת בתעודת האפליקציה מול Microsoft&nbsp;365 — אין צורך בסיסמת
          תיבה, ואף סיסמה אינה נשמרת.
        </p>
      )}

      <div className="max-w-56">
        <SubmitButton>חיבור תיבת Exchange</SubmitButton>
      </div>
    </form>
  );
}

function TestAppointmentControls({ connectionId }: { connectionId: string }) {
  const [createState, createAction] = useActionState(createExchangeTestAppointmentAction, null);
  const [deleteState, deleteAction] = useActionState(deleteExchangeTestAppointmentAction, null);

  // Once a delete SUCCEEDS, the previously-created id is consumed — offer the
  // create button again. A failed delete keeps the id (and the delete button)
  // visible alongside the error, so the owner can just retry.
  const appointmentId = deleteState?.notice ? null : (createState?.appointmentId ?? null);

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">פגישת בדיקה</p>
      <p className="text-xs text-muted-foreground">
        יוצר פגישה קצרה ביומן ומוחק אותה — לאימות שהחיבור עובד גם לכתיבה, לא רק
        לקריאה. בדקו שהיא מופיעה ונעלמת ב-OWA.
      </p>
      <FormNotice message={createState?.notice ?? deleteState?.notice} />
      <FormError message={createState?.error ?? deleteState?.error} />

      {!appointmentId ? (
        <form action={createAction}>
          <input type="hidden" name="connectionId" value={connectionId} />
          <SubmitButton className="w-auto">יצירת פגישת בדיקה</SubmitButton>
        </form>
      ) : (
        <form action={deleteAction}>
          <input type="hidden" name="connectionId" value={connectionId} />
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <SubmitButton className="w-auto">מחיקת פגישת הבדיקה</SubmitButton>
        </form>
      )}
    </div>
  );
}

function ConnectionCard({ connection }: { connection: ExchangeConnectionView }) {
  const [testState, testAction] = useActionState(testExchangeConnectionAction, null);
  const [calendarsState, calendarsAction] = useActionState(listExchangeCalendarsAction, null);
  const [revokeState, revokeAction] = useActionState(revokeExchangeConnectionAction, null);

  const revoked = connection.status === 'revoked';

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-primary" aria-hidden />
          <span className="text-sm font-medium" dir="ltr">
            {connection.mailboxEmail}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[connection.status]}`}
        >
          {STATUS_LABEL[connection.status]}
        </span>
      </div>

      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5" aria-hidden />
          <span>
            אומת לאחרונה:{' '}
            {connection.lastVerifiedAt ? formatIsraelDate(connection.lastVerifiedAt) : 'טרם אומת'}
          </span>
        </div>
        {connection.lastError ? <div>שגיאה אחרונה: {connection.lastError}</div> : null}
      </dl>

      <FormNotice message={testState?.notice ?? calendarsState?.notice ?? revokeState?.notice} />
      <FormError message={testState?.error ?? calendarsState?.error ?? revokeState?.error} />

      {!revoked ? (
        <div className="flex flex-wrap gap-2">
          <form action={testAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <SubmitButton className="w-auto">בדיקת חיבור</SubmitButton>
          </form>
          <form action={calendarsAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <SubmitButton className="w-auto">רשימת יומנים</SubmitButton>
          </form>
          <form action={revokeAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <SubmitButton className="w-auto">ניתוק חיבור</SubmitButton>
          </form>
        </div>
      ) : null}

      {!revoked ? <TestAppointmentControls connectionId={connection.id} /> : null}
    </div>
  );
}

export function ExchangeManager({
  connections,
  mode,
  // Resolved on the server (the provider lives in a server-only env var) and
  // passed down, rather than read here — this is a client component.
  needsPassword,
}: {
  connections: ExchangeConnectionView[];
  mode: 'per_user' | 'per_org';
  needsPassword: boolean;
}) {
  const modeNotice =
    mode === 'per_org'
      ? 'מצב החיבור הנוכחי: משותף לארגון. החיבור שתיצרו ישויך לארגון הפעיל שלכם.'
      : null;

  return (
    <div className="space-y-4">
      {connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
      <div className={connections.length > 0 ? 'rounded-md border border-dashed border-border p-4' : ''}>
        {connections.length > 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">חיבור תיבה נוספת:</p>
        ) : null}
        <ConnectForm modeNotice={modeNotice} needsPassword={needsPassword} />
      </div>
    </div>
  );
}
