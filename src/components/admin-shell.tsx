'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import {
  Building2,
  CalendarClock,
  ChevronDown,
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
  PhoneOff,
  Settings,
  ShieldCheck,
  Users,
  UserSearch,
  Voicemail,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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

// Groups are ordered by workflow, top to bottom. The first group is unlabelled
// (the pinned overview). The last group is collapsible and collapsed by default
// so day-to-day nav is not cluttered by diagnostic tooling. Grouping is by what
// each page *does* (domain / job-to-be-done), not by its label.
type NavGroup = { label?: string; collapsible?: boolean; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ href: '/admin', label: 'סקירה', icon: LayoutDashboard }],
  },
  {
    label: 'לקוחות ופניות',
    items: [
      { href: '/admin/support', label: 'תמיכת לקוחות', icon: UserSearch },
      { href: '/admin/contacts', label: 'פניות', icon: MailOpen },
      { href: '/admin/callbacks', label: 'בקשות חזרה', icon: PhoneCall },
    ],
  },
  {
    label: 'חשבונות והרשאות',
    items: [
      { href: '/admin/users', label: 'משתמשים', icon: Users },
      { href: '/admin/roles', label: 'תפקידי צוות', icon: ShieldCheck },
    ],
  },
  {
    label: 'מוצר וחוזה',
    items: [
      { href: '/admin/packages', label: 'חבילות', icon: Package },
      { href: '/admin/agreement', label: 'חוזה', icon: FileText },
      { href: '/admin/company', label: 'פרטי חברה', icon: Building2 },
    ],
  },
  {
    label: 'קמפיינים ושליחה',
    items: [
      { href: '/admin/campaigns', label: 'קמפיינים', icon: Send },
      { href: '/admin/channels', label: 'ערוצי תקשורת', icon: MessagesSquare },
      { href: '/admin/templates', label: 'תבניות פנייה', icon: Megaphone },
      { href: '/admin/recordings', label: 'הקלטות שיחות', icon: Voicemail },
      { href: '/admin/dnc', label: 'חסימת שיחות (DNC)', icon: PhoneOff },
    ],
  },
  {
    label: 'מערכת ותפעול',
    items: [
      { href: '/admin/settings', label: 'הגדרות', icon: Settings },
      { href: '/admin/alerts', label: 'התראות תפעול', icon: BellRing },
      { href: '/admin/activity', label: 'יומן פעילות', icon: ListChecks },
    ],
  },
  {
    label: 'כלי בדיקה ואבחון',
    collapsible: true,
    items: [
      { href: '/admin/webhooks', label: 'בדיקת Webhooks', icon: Webhook },
      { href: '/admin/sumit-test', label: 'בדיקת SUMIT', icon: FlaskConical },
      // Internal same-origin link: the pg-boss dashboard is reverse-proxied at
      // /admin/jobs behind requireAdmin (no separate login). See that route.
      { href: '/admin/jobs', label: 'משימות מתוזמנות', icon: CalendarClock },
    ],
  },
];

// '/admin' is active only on an exact match; the rest match their subtree so
// e.g. /admin/packages/new keeps "חבילות" highlighted.
function isActive(pathname: string, href: string): boolean {
  return href === '/admin'
    ? pathname === '/admin'
    : pathname === href || pathname.startsWith(`${href}/`);
}

// Renders one nav row: a Link with subtree-based active highlighting. Shared by
// every group so the markup lives in exactly one place.
function renderNavItem(item: NavItem, pathname: string) {
  const { href, label, icon: Icon } = item;

  const active = isActive(pathname, href);
  return (
    <SidebarMenuItem key={href}>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        render={
          <Link href={href} aria-current={active ? 'page' : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        }
      />
    </SidebarMenuItem>
  );
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
  children,
}: {
  userEmail: string | undefined;
  // Full name from the profile (materialised at signup by the handle_new_user
  // trigger). The account menu shows the name as the primary identity and the
  // email as a secondary line, falling back to the email when the name is empty.
  userName?: string;
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
            {NAV_GROUPS.map((group, index) => {
              const menu = (
                <SidebarMenu>
                  {group.items.map((item) => renderNavItem(item, pathname))}
                </SidebarMenu>
              );

              // The diagnostic-tools group collapses; its label is the toggle
              // (Base UI `render`, not `asChild`) and a chevron rotates off the
              // Collapsible root's `data-open` state.
              if (group.collapsible) {
                return (
                  <Collapsible
                    key={group.label ?? index}
                    defaultOpen={false}
                    className="group/collapsible"
                  >
                    <SidebarGroup>
                      <SidebarGroupLabel
                        render={<CollapsibleTrigger />}
                        className="w-full cursor-pointer hover:text-sidebar-foreground"
                      >
                        {group.label}
                        <ChevronDown className="ms-auto size-4 transition-transform group-data-[open]/collapsible:rotate-180" />
                      </SidebarGroupLabel>
                      <CollapsiblePanel>
                        <SidebarGroupContent>{menu}</SidebarGroupContent>
                      </CollapsiblePanel>
                    </SidebarGroup>
                  </Collapsible>
                );
              }

              return (
                <SidebarGroup key={group.label ?? index}>
                  {group.label ? (
                    <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  ) : null}
                  <SidebarGroupContent>{menu}</SidebarGroupContent>
                </SidebarGroup>
              );
            })}
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
