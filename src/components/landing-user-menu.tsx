'use client';

import Link from 'next/link';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { LayoutDashboard, LifeBuoy, LogOut, Settings } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getInitials } from '@/lib/utils';

// Header avatar + account menu for a signed-in visitor on the public landing
// page. Mirrors the account menu in AppShell (src/components/app-shell.tsx) —
// same initials derivation, same primitives, same logout mechanism — so the
// two stay consistent. Base UI's menu portal ignores the DOM `dir` attribute,
// so it needs its own DirectionProvider (the landing page has no ancestor
// one, unlike the customer app shell's sidebar).

function LogoutMenuItem() {
  // The menu closes (and unmounts via an exit animation) on item click, which
  // can race the native form submit. requestSubmit() fires the POST
  // synchronously on click, independent of when the popup unmounts.
  return (
    <form action="/auth/logout" method="post">
      <DropdownMenuItem
        variant="destructive"
        render={
          <button
            type="submit"
            className="w-full"
            onClick={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <LogOut />
            התנתקות
          </button>
        }
      />
    </form>
  );
}

export function LandingUserMenu({
  userEmail,
  userName,
}: {
  userEmail: string | undefined;
  // Full name from the profile; falls back to the email when empty, same
  // fallback rule as AppShell.
  userName?: string;
}) {
  const displayName = userName || userEmail || '';
  const initials = getInitials(displayName);

  return (
    <DirectionProvider direction="rtl">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="תפריט משתמש"
            >
              <Avatar>
                <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          }
        />
        <DropdownMenuContent side="bottom" align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-start text-sm leading-tight">
                  {/* Full name only — no email line (owner directive). Falls
                      back to the email as the label solely when the profile
                      has no name, since something has to identify the row. */}
                  <span className="truncate font-medium">{displayName}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <Link href="/app">
                  <LayoutDashboard />
                  לאזור האישי
                </Link>
              }
            />
            <DropdownMenuItem
              render={
                <Link href="/app/settings">
                  <Settings />
                  הגדרות
                </Link>
              }
            />
            <DropdownMenuItem
              render={
                <Link href="/contact?t=support">
                  <LifeBuoy />
                  עזרה ותמיכה
                </Link>
              }
            />
            <DropdownMenuSeparator />
            <LogoutMenuItem />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </DirectionProvider>
  );
}
