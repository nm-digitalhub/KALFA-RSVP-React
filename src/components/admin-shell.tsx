'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import {
  Building2,
  ChevronDown,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MailOpen,
  Menu,
  Package,
  PhoneCall,
  Receipt,
  Settings,
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
import { Button } from '@/components/ui/button';

// Admin app shell: a fixed right-side sidebar (RTL) plus a top bar. Dedicated to
// the admin area — it is NOT the customer AppShell. As with the customer shell,
// Base UI defaults to LTR and ignores the DOM `dir`, so DirectionProvider is
// required for the menu/sheet to position correctly in RTL.

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: '/admin', label: 'סקירה', icon: LayoutDashboard },
  { href: '/admin/contacts', label: 'פניות', icon: MailOpen },
  { href: '/admin/callbacks', label: 'בקשות חזרה', icon: PhoneCall },
  { href: '/admin/orders', label: 'הזמנות', icon: Receipt },
  { href: '/admin/packages', label: 'חבילות', icon: Package },
  { href: '/admin/activity', label: 'יומן פעילות', icon: ListChecks },
  { href: '/admin/company', label: 'פרטי חברה', icon: Building2 },
  { href: '/admin/sumit-test', label: 'בדיקת SUMIT', icon: FlaskConical },
  { href: '/admin/settings', label: 'הגדרות', icon: Settings },
];

// '/admin' is active only on an exact match; the rest match their subtree so
// e.g. /admin/packages/new keeps "חבילות" highlighted.
function isActive(pathname: string, href: string): boolean {
  return href === '/admin'
    ? pathname === '/admin'
    : pathname === href || pathname.startsWith(`${href}/`);
}

// Hamburger that opens the sidebar Sheet on mobile only.
function MobileMenuTrigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggleSidebar}
      aria-label="פתיחת תפריט"
      className="md:hidden"
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

export function AdminShell({
  userEmail,
  children,
}: {
  userEmail: string | undefined;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const initial = userEmail?.[0]?.toUpperCase() ?? '?';

  return (
    <DirectionProvider direction="rtl">
      <SidebarProvider>
        {/* side="right" places the sidebar on the inline-end for RTL. */}
        <Sidebar side="right" collapsible="offcanvas">
          <SidebarHeader>
            <Link href="/admin" className="px-2 py-1 text-xl font-bold">
              KALFA · ניהול
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV.map(({ href, label, icon: Icon }) => {
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
            <Link
              href="/app"
              className="truncate px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              חזרה לאזור האישי
            </Link>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
            <MobileMenuTrigger />

            <span className="text-sm font-medium text-muted-foreground">
              אזור ניהול
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="ms-auto h-9 gap-2 px-2">
                    <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {initial}
                    </span>
                    <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline">
                      {userEmail}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                {/* Base UI requires Menu group parts (GroupLabel) to live inside
                    a Menu.Group — otherwise it throws error #31 on open. The
                    profile menu is intentionally minimal: email + logout. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">
                    {userEmail}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <LogoutMenuItem />
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
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
