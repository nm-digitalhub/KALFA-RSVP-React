'use client';

import { SiteLink as Link } from '@/components/site/site-link';
import { LayoutDashboard, LifeBuoy, Settings } from 'lucide-react';
import { useT } from 'next-i18next/client';

import { AccountMenuLabel, LogoutMenuItem } from '@/components/account-menu-parts';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getInitials } from '@/lib/utils';

// Header avatar + account menu for a signed-in visitor on the public landing
// page. Mirrors the account menu in AppShell (src/components/app-shell.tsx) —
// same initials derivation, same primitives, same logout mechanism — so the
// two stay consistent. Base UI's menu portal ignores the DOM `dir` attribute
// and reads the DirectionProvider of the root layout, which follows the language.

export function LandingUserMenu({
  userEmail,
  userName,
}: {
  userEmail: string | undefined;
  // Full name from the profile; falls back to the email when empty, same
  // fallback rule as AppShell.
  userName?: string;
}) {
  const { t } = useT('public');
  const displayName = userName || userEmail || '';
  const initials = getInitials(displayName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            // 44px hit area around the 32px avatar (the `icon` size is 32px;
            // this is the only account control in the public header).
            className="size-11 rounded-full"
            aria-label={t('site.header.userMenu.ariaLabel', 'תפריט משתמש')}
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
          {/* Full name only — no email line (owner directive). Falls back to
              the email as the label solely when the profile has no name, since
              something has to identify the row. */}
          <AccountMenuLabel initials={initials} displayName={displayName} />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={
              <Link href="/app">
                <LayoutDashboard />
                {t('site.header.userMenu.account', 'לאזור האישי')}
              </Link>
            }
          />
          <DropdownMenuItem
            render={
              <Link href="/app/settings">
                <Settings />
                {t('site.header.userMenu.settings', 'הגדרות')}
              </Link>
            }
          />
          <DropdownMenuItem
            render={
              <Link href="/contact?t=support">
                <LifeBuoy />
                {t('site.header.userMenu.help', 'עזרה ותמיכה')}
              </Link>
            }
          />
          <DropdownMenuSeparator />
          <LogoutMenuItem label={t('site.header.userMenu.logout', 'התנתקות')} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
