'use client';

import { LogOut } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';

// The pieces of the signed-in account menu that are the same wherever it is
// shown: the admin shell, the customer shell and the public landing header.
// Presentation only — which links a menu offers, and to whom, stays with each
// caller.

// The 32px initials avatar.
export function AccountAvatar({ initials }: { initials: string }) {
  return (
    <Avatar className="size-8">
      <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

// The name as the primary line, with the email line under it whenever `email`
// is passed (an empty string still renders the line, as the shells always did).
export function AccountIdentityText({
  displayName,
  email,
}: {
  displayName: string;
  email?: string;
}) {
  return (
    <div className="grid flex-1 text-start text-sm leading-tight">
      <span className="truncate font-medium">{displayName}</span>
      {email !== undefined ? (
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      ) : null}
    </div>
  );
}

// The identity row that heads the open menu. Must sit inside a
// DropdownMenuGroup (Base UI throws #31 for a group label outside one).
export function AccountMenuLabel({
  initials,
  displayName,
  email,
}: {
  initials: string;
  displayName: string;
  email?: string;
}) {
  return (
    <DropdownMenuLabel className="p-0 font-normal">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <AccountAvatar initials={initials} />
        <AccountIdentityText displayName={displayName} email={email} />
      </div>
    </DropdownMenuLabel>
  );
}

export function LogoutMenuItem({ label }: { label: string }) {
  // The menu closes (and unmounts via an exit animation) on item click, which
  // can race the native form submit. requestSubmit() fires the POST
  // synchronously on click, independent of when the popup unmounts.
  return (
    <form action="/auth/logout" method="post">
      <DropdownMenuItem
        nativeButton
        variant="destructive"
        render={
          <button
            type="submit"
            className="w-full"
            onClick={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <LogOut />
            {label}
          </button>
        }
      />
    </form>
  );
}
