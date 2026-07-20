'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

import {
  grantAdminAction,
  revokeAdminAction,
  suspendUserAction,
  reactivateUserAction,
  grantCreditAction,
} from '../actions';
import {
  assignStaffRoleAction,
  enrollConsoleAgentAction,
  removeConsoleAgentAction,
  revokeStaffRoleAction,
} from '../../roles/actions';

// A platform staff role (id + display label) offered in the selector.
export interface StaffRoleOption {
  id: string;
  label: string;
}

// This user's call-console membership, or null when they are not an agent.
export interface ConsoleAgentState {
  displayName: string;
}

// The owner-only staff panel for one user, threaded page -> gate -> view -> here.
// Declared once and imported by each of those, rather than restated at every hop.
export interface PlatformStaffPanel {
  roles: StaffRoleOption[];
  currentRoleId: string | null;
  consoleAgent: ConsoleAgentState | null;
}

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

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

// Platform staff-role selector (single role per user). Shown only to platform
// owners. Choosing "ללא" revokes staff membership; any role assigns it. Awaits
// the server action and surfaces its FormState (the last-owner guard may reject).
function StaffRoleSelector({
  userId,
  roles,
  currentRoleId,
}: {
  userId: string;
  roles: StaffRoleOption[];
  currentRoleId: string | null;
}) {
  const [selected, setSelected] = useState(currentRoleId ?? '');
  const [state, setState] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  const onSave = (): void => {
    setState(null);
    startTransition(async () => {
      const result =
        selected === ''
          ? await revokeStaffRoleAction({ userId })
          : await assignStaffRoleAction({ userId, roleId: selected });
      setState(result);
    });
  };

  return (
    <section className={sectionClass}>
      <h3 className="font-medium">תפקיד צוות פלטפורמה</h3>
      <p className="text-sm text-muted-foreground">
        תפקיד הצוות של המשתמש בפלטפורמה (בעל מערכת / צוות). בחירת &quot;ללא&quot;
        מסירה את חברות הצוות.
      </p>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-52">
          <label htmlFor="staff-role" className="mb-1 block text-sm font-medium">
            תפקיד
          </label>
          <select
            id="staff-role"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">ללא (לא חבר צוות)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || selected === (currentRoleId ?? '')}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'רגע…' : 'שמירת תפקיד'}
        </button>
      </div>
    </section>
  );
}

// Call-console membership. Deliberately rendered only when the user already holds
// a staff role: the DB requires an agent to be platform staff (FK to
// platform_staff, 20260721005100), so offering the control before then would only
// produce a rejection. Removing the staff role cascades this away — the copy says
// so, because that happens elsewhere on this screen.
function ConsoleAgentSection({
  userId,
  isStaff,
  current,
}: {
  userId: string;
  isStaff: boolean;
  current: ConsoleAgentState | null;
}) {
  const [displayName, setDisplayName] = useState(current?.displayName ?? '');
  const [state, setState] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<FormState>): void => {
    setState(null);
    startTransition(async () => setState(await fn()));
  };

  return (
    <section className={sectionClass}>
      <h3 className="font-medium">סוכן מוקד שיחות</h3>
      <p className="text-sm text-muted-foreground">
        סוכן מוקד רואה את פיד השיחות של כל האירועים. חובה שיהיה חבר צוות פלטפורמה
        — שלילת תפקיד הצוות מסירה אותו מהמוקד אוטומטית.
      </p>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      {!isStaff ? (
        <p className="text-sm text-muted-foreground">
          המשתמש אינו חבר צוות פלטפורמה. הקצו תפקיד צוות תחילה.
        </p>
      ) : current ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            סוכן פעיל בשם <strong>{current.displayName}</strong>
          </span>
          <button
            type="button"
            onClick={() => run(() => removeConsoleAgentAction({ userId }))}
            disabled={pending}
            className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition-opacity hover:bg-red-100 disabled:opacity-60"
          >
            {pending ? 'רגע…' : 'הסרה מהמוקד'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52">
            <label htmlFor="console-display-name" className="mb-1 block text-sm font-medium">
              שם תצוגה במוקד
            </label>
            <input
              id="console-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={() => run(() => enrollConsoleAgentAction({ userId, displayName }))}
            disabled={pending || displayName.trim().length < 2}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? 'רגע…' : 'הוספה כסוכן מוקד'}
          </button>
        </div>
      )}
    </section>
  );
}

export function UserActions({
  userId,
  isPlatformAdmin,
  suspended,
  isSelf,
  events,
  platformStaff,
}: {
  userId: string;
  isPlatformAdmin: boolean;
  suspended: boolean;
  isSelf: boolean;
  events: { id: string; name: string; campaignId: string | null }[];
  // Present only when the VIEWER is a platform owner (the only role allowed to
  // manage staff). null/undefined hides the selector entirely. Console membership
  // rides on the same object rather than a parallel prop, so the owner gate stays
  // in exactly one place.
  platformStaff?: PlatformStaffPanel | null;
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
  // Credit scope: controlled event choice so the optional campaign-scope
  // checkbox can follow the selected event's (single) campaign.
  const [creditEventId, setCreditEventId] = useState('');
  const [scopeToCampaign, setScopeToCampaign] = useState(false);
  const creditCampaignId =
    events.find((e) => e.id === creditEventId)?.campaignId ?? null;

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

      {platformStaff ? (
        <>
          <StaffRoleSelector
            userId={userId}
            roles={platformStaff.roles}
            currentRoleId={platformStaff.currentRoleId}
          />
          <ConsoleAgentSection
            userId={userId}
            isStaff={platformStaff.currentRoleId !== null}
            current={platformStaff.consoleAgent}
          />
        </>
      ) : null}

      {events.length > 0 ? (
        <section className={sectionClass}>
          <h3 className="font-medium">מתן הטבה (זיכוי)</h3>
          <form action={creditAction} className="space-y-3">
            {/* The server re-verifies the chosen event is owned by this user. */}
            <input type="hidden" name="user_id" value={userId} />
            <FormError message={creditState?.error} />
            <FormNotice message={creditState?.notice} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="credit-event" className="mb-1 block text-sm font-medium">
                  אירוע
                </label>
                <select
                  id="credit-event"
                  name="event_id"
                  required
                  value={creditEventId}
                  onChange={(e) => {
                    setCreditEventId(e.target.value);
                    setScopeToCampaign(false);
                  }}
                  className={inputClass}
                >
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
            {creditCampaignId ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopeToCampaign}
                  onChange={(e) => setScopeToCampaign(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                שיוך הזיכוי לקמפיין הנוכחי בלבד (אחרת: זיכוי ברמת האירוע)
              </label>
            ) : null}
            <input
              type="hidden"
              name="campaign_id"
              value={scopeToCampaign && creditCampaignId ? creditCampaignId : ''}
            />
            <FieldError errors={creditState?.fieldErrors?.campaign_id} />
            <RowSubmit>מתן הטבה</RowSubmit>
          </form>
        </section>
      ) : (
        // A credit is always scoped to one of the user's OWN events (it is
        // consumed by that event's campaign at close-charge — there is no
        // account-level credit). A user who owns no event has nothing to credit,
        // so explain the absence instead of hiding the section silently.
        <section className={sectionClass}>
          <h3 className="font-medium">מתן הטבה (זיכוי)</h3>
          <p className="text-sm text-muted-foreground">
            הטבה משויכת תמיד לאירוע ספציפי בבעלות המשתמש ונצרכת בסגירת החיוב של
            הקמפיין. למשתמש זה אין אירועים בבעלותו, ולכן אין לְמה לשייך זיכוי.
          </p>
        </section>
      )}
    </div>
  );
}
