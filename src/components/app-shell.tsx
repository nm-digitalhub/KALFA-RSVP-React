'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import {
  CalendarDays,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { OrgSwitcher, type OrgOption } from '@/components/org-switcher';
import { getInitials } from '@/lib/utils';

// Customer app shell: a fixed right-side sidebar (RTL) plus a top bar. The
// customer layout stays a Server Component and renders this client shell so
// navigation can highlight the active link, toggle the mobile drawer, and open
// the profile menu. Base UI defaults to LTR and ignores the DOM `dir`
// attribute, so DirectionProvider is required for the menu/sheet to position
// correctly in RTL (the HTML `dir="rtl"` is already set on <html>).

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: '/app', label: 'לוח בקרה', icon: LayoutDashboard },
  { href: '/app/events', label: 'האירועים שלי', icon: CalendarDays },
  { href: '/app/settings', label: 'הגדרות', icon: Settings },
];

// '/app' is active only on an exact match; the rest match their subtree so
// e.g. /app/events/new keeps "האירועים שלי" highlighted.
function isActive(pathname: string, href: string): boolean {
  return href === '/app'
    ? pathname === '/app'
    : pathname === href || pathname.startsWith(`${href}/`);
}

// Hamburger that opens the sidebar Sheet on mobile only. The desktop sidebar is
// fixed (per the approved design), so the trigger is hidden from md upward.
function MobileMenuTrigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggleSidebar}
      aria-label="פתיחת תפריט"
      className="size-11 md:hidden"
    >
      <Menu />
    </Button>
  );
}

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

export function AppShell({
  userEmail,
  userName,
  isAdmin = false,
  orgs = [],
  activeOrgId = null,
  showTeam = false,
  children,
}: {
  userEmail: string | undefined;
  // Full name from the profile (materialised at signup by the handle_new_user
  // trigger). The account menu shows the name as the primary identity and the
  // email as a secondary line, falling back to the email when the name is empty.
  userName?: string;
  // Whether to reveal the admin nav link. Determined server-side by the layout;
  // this is a convenience link only — the /admin layout enforces authorization.
  isAdmin?: boolean;
  // Organizations the user belongs to + the active one (for the switcher) and
  // whether to reveal the user-management nav link (members.view). All resolved
  // server-side in the layout; the /app/team route re-checks the permission.
  orgs?: OrgOption[];
  activeOrgId?: string | null;
  showTeam?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const displayName = userName || userEmail || '';
  const initials = getInitials(displayName);

  // dashboard/events, then the team link (if permitted), then settings, then
  // the admin link (admins only). The /app/team and /admin routes re-check
  // their own authorization server-side.
  const nav: NavItem[] = [
    ...NAV.slice(0, 2),
    ...(showTeam
      ? [{ href: '/app/team', label: 'ניהול משתמשים', icon: Users }]
      : []),
    ...NAV.slice(2),
    ...(isAdmin ? [{ href: '/admin', label: 'ניהול', icon: Shield }] : []),
  ];

  return (
    <DirectionProvider direction="rtl">
      <SidebarProvider>
        {/* side="right" places the sidebar on the inline-end for RTL. */}
        <Sidebar side="right" collapsible="offcanvas">
          <SidebarHeader>
            <Link href="/app" className="px-2 py-1 text-xl font-bold">
              KALFA
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {nav.map(({ href, label, icon: Icon }) => {
                    const active = isActive(pathname, href);
                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={label}
                          render={
                            <Link
                              href={href}
                              aria-current={active ? 'page' : undefined}
                            >
                              <Icon />
                              <span>{label}</span>
                            </Link>
                          }
                        />
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton size="lg">
                        <Avatar className="size-8">
                          <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="grid flex-1 text-start text-sm leading-tight">
                          <span className="truncate font-medium">
                            {displayName}
                          </span>
                          {userName ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {userEmail}
                            </span>
                          ) : null}
                        </div>
                        <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
                      </SidebarMenuButton>
                    }
                  />
                  {/* Menu group parts must live inside a Menu.Group (Base UI) or
                      it throws #31 on open. Opens upward from the sidebar footer. */}
                  <DropdownMenuContent side="top" align="end" className="w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="p-0 font-normal">
                        <div className="flex items-center gap-2 px-2 py-1.5">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="grid flex-1 text-start text-sm leading-tight">
                            <span className="truncate font-medium">
                              {displayName}
                            </span>
                            {userName ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {userEmail}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        render={
                          <Link href="/app/settings">
                            <Settings />
                            הגדרות
                          </Link>
                        }
                      />
                      <DropdownMenuSeparator />
                      <LogoutMenuItem />
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
            <MobileMenuTrigger />

            {/* Search — visual placeholder (no behavior yet); hidden on mobile
                until it works. A spacer keeps the controls at the inline-end. */}
            <div className="flex-1 sm:hidden" aria-hidden />
            <div className="relative hidden max-w-md flex-1 sm:block">
              <Search
                className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                aria-label="חיפוש"
                placeholder="חיפוש…"
                className="ps-8"
              />
            </div>

            <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
          </header>

          {/* SidebarInset already renders the page <main> landmark. */}
          <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </DirectionProvider>
  );
}
