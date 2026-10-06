'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice } from '@/components/forms';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
const rowButtonClass =
  'rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60';
const dangerStyle = 'bg-red-50 text-red-700 hover:bg-red-100';

// Pending-aware submit for the inline row/section forms. Must render inside a
// <form>; useFormStatus reflects that form's submission state.
function RowSubmit({
  children,
  variant,
  ariaLabel,
}: {
  children: React.ReactNode;
  variant?: 'danger';
  // Row buttons repeat per member; the accessible name carries whose row it is.
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  const style =
    variant === 'danger'
      ? dangerStyle
      : 'bg-primary text-primary-foreground hover:opacity-90';
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={ariaLabel}
      className={`${rowButtonClass} ${style}`}
    >
      {pending ? 'רגע…' : children}
    </button>
  );
}

// The dialog trigger for a confirm-gated row form. Rendered inside the <form>,
// so useFormStatus reflects the submission the dialog starts.
function PendingDangerTrigger({ children, ...props }: React.ComponentProps<'button'>) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      {...props}
      disabled={pending}
      className={`${rowButtonClass} ${dangerStyle}`}
    >
      {pending ? 'רגע…' : children}
    </button>
  );
}

// "הסרה" is irreversible for the member's access, so it asks first. The
// dialog content is portaled outside the <form>, so confirming submits the
// form by ref rather than by a submit button.
function RemoveMemberForm({
  action,
  memberId,
  memberName,
}: {
  action: (formData: FormData) => void;
  memberId: string;
  memberName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  const onConfirm = (): void => {
    formRef.current?.requestSubmit();
    setOpen(false);
  };

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="member_id" value={memberId} />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={
            <PendingDangerTrigger aria-label={`הסרה של ${memberName}`}>הסרה</PendingDangerTrigger>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>הסרה מהצוות</AlertDialogTitle>
            <AlertDialogDescription>
              הגישה של «{memberName}» לארגון תבוטל.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirm}>
              הסרה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
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
  const memberName = member.fullName || member.email || 'חבר צוות';
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
            <select
              name="role_id"
              defaultValue={member.roleId}
              aria-label={`תפקיד של ${memberName}`}
              className={selectSmall}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <RowSubmit ariaLabel={`עדכון תפקיד של ${memberName}`}>עדכון תפקיד</RowSubmit>
          </form>
          <RemoveMemberForm action={removeAction} memberId={member.id} memberName={memberName} />
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
  canManageRoles,
  currentUserId,
}: {
  members: OrgMemberDTO[];
  invitations: OrgInvitationDTO[];
  roles: OrgRoleDTO[];
  canManage: boolean;
  // Whether to reveal the entry point to the roles-matrix screen (owner-only;
  // /app/team/roles re-checks requireOrgOwner independently).
  canManageRoles: boolean;
  currentUserId: string;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">ניהול משתמשים</h1>
        {canManageRoles ? (
          <Button variant="outline" size="sm" render={<Link href="/app/team/roles" />}>
            הרשאות תפקידים
          </Button>
        ) : null}
      </div>

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
