'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import {
  Building2,
  CalendarClock,
  ChevronsUpDown,
  FileText,
  FlaskConical,
  LayoutDashboard,
  BellRing,
  ListChecks,
  Send,
  LogOut,
  MailOpen,
  Megaphone,
  Menu,
  MessagesSquare,
  Package,
  PhoneCall,
  Settings,
  ShieldCheck,
  Users,
  Webhook,
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';

// Admin app shell: a fixed right-side sidebar (RTL) plus a top bar. Dedicated to
// the admin area — it is NOT the customer AppShell. As with the customer shell,
// Base UI defaults to LTR and ignores the DOM `dir`, so DirectionProvider is
// required for the menu/sheet to position correctly in RTL.

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: '/admin', label: 'סקירה', icon: LayoutDashboard },
  { href: '/admin/users', label: 'משתמשים', icon: Users },
  { href: '/admin/roles', label: 'תפקידי צוות', icon: ShieldCheck },
  { href: '/admin/campaigns', label: 'קמפיינים', icon: Send },
  { href: '/admin/contacts', label: 'פניות', icon: MailOpen },
  { href: '/admin/callbacks', label: 'בקשות חזרה', icon: PhoneCall },
  { href: '/admin/packages', label: 'חבילות', icon: Package },
  { href: '/admin/activity', label: 'יומן פעילות', icon: ListChecks },
  { href: '/admin/company', label: 'פרטי חברה', icon: Building2 },
  { href: '/admin/agreement', label: 'חוזה', icon: FileText },
  { href: '/admin/channels', label: 'ערוצי תקשורת', icon: MessagesSquare },
  { href: '/admin/templates', label: 'תבניות פנייה', icon: Megaphone },
  { href: '/admin/webhooks', label: 'בדיקת Webhooks', icon: Webhook },
  { href: '/admin/sumit-test', label: 'בדיקת SUMIT', icon: FlaskConical },
  { href: '/admin/alerts', label: 'התראות תפעול', icon: BellRing },
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

export function AdminShell({
  userEmail,
  userName,
  jobsDashboardUrl,
  children,
}: {
  userEmail: string | undefined;
  // Full name from the profile (materialised at signup by the handle_new_user
  // trigger). The account menu shows the name as the primary identity and the
  // email as a secondary line, falling back to the email when the name is empty.
  userName?: string;
  // External pg-boss ops dashboard (separate process behind its own Basic Auth,
  // served on a dedicated port) — rendered only when configured via env.
  jobsDashboardUrl?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const displayName = userName || userEmail || '';
  const initials = getInitials(displayName);

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
                  {jobsDashboardUrl ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="משימות מתוזמנות"
                        render={
                          <a
                            href={jobsDashboardUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <CalendarClock />
                            <span>משימות מתוזמנות</span>
                          </a>
                        }
                      />
                    </SidebarMenuItem>
                  ) : null}
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
                          <Link href="/app">
                            <LayoutDashboard />
                            חזרה לאזור האישי
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

            <span className="text-sm font-medium text-muted-foreground">
              אזור ניהול
            </span>
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
