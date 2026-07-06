'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import type { OrgMemberDTO, OrgInvitationDTO, OrgRoleDTO } from '@/lib/data/orgs';

import {
  inviteMemberAction,
  changeMemberRoleAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from './actions';
import { formatIsraelDate } from '@/lib/date';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const selectSmall =
  'rounded-md border border-border bg-background px-2 py-1 text-sm';
const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

// Pending-aware submit for the inline row/section forms. Must render inside a
// <form>; useFormStatus reflects that form's submission state.
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

function InviteForm({ roles }: { roles: OrgRoleDTO[] }) {
  const [state, action] = useActionState(inviteMemberAction, null);
  return (
    <section className={sectionClass}>
      <h2 className="text-lg font-semibold">הזמנת משתמש</h2>
      <form action={action} className="space-y-3">
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label htmlFor="invite-email" className="mb-1 block text-sm font-medium">
              אימייל
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              dir="ltr"
              className={inputClass}
            />
            <FieldError errors={state?.fieldErrors?.email} />
          </div>
          <div>
            <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">
              תפקיד
            </label>
            <select
              id="invite-role"
              name="role_id"
              required
              defaultValue=""
              className={inputClass}
            >
              <option value="" disabled>
                בחר/י תפקיד
              </option>
              {roles
                .filter((r) => !r.isOwnerRole)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </select>
            <FieldError errors={state?.fieldErrors?.role_id} />
          </div>
          <RowSubmit>שליחת הזמנה</RowSubmit>
        </div>
      </form>
    </section>
  );
}

function MemberRow({
  member,
  roles,
  canManage,
  isSelf,
}: {
  member: OrgMemberDTO;
  roles: OrgRoleDTO[];
  canManage: boolean;
  isSelf: boolean;
}) {
  const [roleState, roleAction] = useActionState(changeMemberRoleAction, null);
  const [removeState, removeAction] = useActionState(removeMemberAction, null);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {member.fullName || member.email || '—'}
            {isSelf ? <span className="text-muted-foreground"> (אני)</span> : null}
          </p>
          {member.email ? (
            <p className="truncate text-sm text-muted-foreground" dir="ltr">
              {member.email}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge>{member.roleLabel}</Badge>
          <Badge>פעיל</Badge>
        </div>
      </div>

      {canManage && !isSelf ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form action={roleAction} className="flex items-center gap-2">
            <input type="hidden" name="member_id" value={member.id} />
            <select name="role_id" defaultValue={member.roleId} className={selectSmall}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <RowSubmit>עדכון תפקיד</RowSubmit>
          </form>
          <form action={removeAction}>
            <input type="hidden" name="member_id" value={member.id} />
            <RowSubmit variant="danger">הסרה</RowSubmit>
          </form>
        </div>
      ) : null}

      {roleState?.error ? <FormError message={roleState.error} /> : null}
      {roleState?.notice ? <FormNotice message={roleState.notice} /> : null}
      {removeState?.error ? <FormError message={removeState.error} /> : null}
    </li>
  );
}

function InvitationRow({ invitation }: { invitation: OrgInvitationDTO }) {
  const [resendState, resendAction] = useActionState(resendInvitationAction, null);
  const [revokeState, revokeAction] = useActionState(revokeInvitationAction, null);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" dir="ltr">
            {invitation.email}
          </p>
          <p className="text-sm text-muted-foreground">
            תוקף עד {formatIsraelDate(invitation.expiresAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{invitation.roleLabel}</Badge>
          <Badge>ממתינה</Badge>
          <form action={resendAction}>
            <input type="hidden" name="invitation_id" value={invitation.id} />
            <RowSubmit>חידוש</RowSubmit>
          </form>
          <form action={revokeAction}>
            <input type="hidden" name="invitation_id" value={invitation.id} />
            <RowSubmit variant="danger">ביטול</RowSubmit>
          </form>
        </div>
      </div>
      {resendState?.error ? <FormError message={resendState.error} /> : null}
      {resendState?.notice ? <FormNotice message={resendState.notice} /> : null}
      {revokeState?.error ? <FormError message={revokeState.error} /> : null}
      {revokeState?.notice ? <FormNotice message={revokeState.notice} /> : null}
    </li>
  );
}

export function TeamClient({
  members,
  invitations,
  roles,
  canManage,
  currentUserId,
}: {
  members: OrgMemberDTO[];
  invitations: OrgInvitationDTO[];
  roles: OrgRoleDTO[];
  canManage: boolean;
  currentUserId: string;
}) {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">ניהול משתמשים</h1>

      {canManage ? <InviteForm roles={roles} /> : null}

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">חברי הצוות</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין חברים עדיין.</p>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                roles={roles}
                canManage={canManage}
                isSelf={m.userId === currentUserId}
              />
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold">הזמנות ממתינות</h2>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין הזמנות ממתינות.</p>
          ) : (
            <ul className="divide-y divide-border">
              {invitations.map((i) => (
                <InvitationRow key={i.id} invitation={i} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
