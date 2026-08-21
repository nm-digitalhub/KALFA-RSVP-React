'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import {
  Activity,
  Ban,
  Bot,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleQuestionMark,
  Cookie,
  ChevronsUpDown,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  BellRing,
  ChartColumn,
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';
import type { AdminNavCounts } from '@/lib/data/admin/nav-counts';
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
import {
  AvailabilityDot,
  AvailabilityMenuSection,
} from '@/components/availability/availability-status';
import type {
  AvailabilityBlock,
  PresenceSnapshot,
} from '@/lib/data/exchange-availability';
import { SoftphonePanelLazy } from '@/components/console/softphone-panel-lazy';
import type { SoftphoneGateInfo } from '@/components/console/softphone-panel';
import { cn, getInitials } from '@/lib/utils';

// Admin app shell: a fixed right-side sidebar (RTL) plus a top bar. Dedicated to
// the admin area — it is NOT the customer AppShell. As with the customer shell,
// Base UI defaults to LTR and ignores the DOM `dir`, so DirectionProvider is
// required for the menu/sheet to position correctly in RTL.

type NavItem = { href: string; label: string; icon: LucideIcon };

// Groups are ordered by workflow, top to bottom. The first group is unlabelled
// (the pinned overview, always shown). Every labelled group is collapsible via
// its header; `defaultOpen` sets the initial state (open unless false — the
// diagnostics group starts collapsed). Grouping is by what each page *does*
// (domain / job-to-be-done), not by its label.
type NavGroup = { label?: string; defaultOpen?: boolean; items: NavItem[] };

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
      { href: '/admin/cancellations', label: 'בקשות ביטול', icon: Ban },
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
      { href: '/admin/faq', label: 'שאלות נפוצות', icon: CircleQuestionMark },
    ],
  },
  {
    label: 'קמפיינים ושליחה',
    items: [
      { href: '/admin/campaigns', label: 'קמפיינים', icon: Send },
      { href: '/admin/voice', label: 'מוקד שיחות AI', icon: Bot },
      { href: '/admin/channels', label: 'ערוצי תקשורת', icon: MessagesSquare },
      { href: '/admin/templates', label: 'תבניות פנייה', icon: Megaphone },
      { href: '/admin/recordings', label: 'הקלטות שיחות', icon: Voicemail },
      // Console audit 12.8 — the page (src/app/(admin)/admin/voice/console-history)
      // was fully built and server-side gated (requirePlatformPermission
      // 'manage_voice') but had no nav entry anywhere, making it reachable
      // only by typing the URL directly. Placed beside recordings — its own
      // header comment distinguishes it from both /admin/recordings
      // (call_attempts, the AI ledger) and /admin/voice/events/[id].
      { href: '/admin/voice/console-history', label: 'היסטוריית מוקד', icon: History },
      { href: '/admin/dnc', label: 'חסימת שיחות (DNC)', icon: PhoneOff },
    ],
  },
  {
    label: 'מערכת ותפעול',
    items: [
      { href: '/admin/settings', label: 'הגדרות', icon: Settings },
      { href: '/admin/calendar', label: 'יומן Exchange', icon: CalendarDays },
      { href: '/admin/fleet', label: 'פניות סוכנים', icon: Bot },
      { href: '/admin/alerts', label: 'התראות תפעול', icon: BellRing },
      { href: '/admin/analytics', label: 'אנליטיקת אתר', icon: ChartColumn },
      { href: '/admin/cookie-consent', label: 'הסכמת עוגיות', icon: Cookie },
      { href: '/admin/activity', label: 'יומן פעילות', icon: ListChecks },
      { href: '/admin/access-log', label: 'יומן גישת צוות', icon: ShieldCheck },
    ],
  },
  {
    label: 'כלי בדיקה ואבחון',
    defaultOpen: false,
    items: [
      // Server-side gated to the platform owner (requirePlatformOwner), not
      // just admin — surfaces raw process/server internals. Visible to every
      // admin here regardless (nav visibility is convenience only, never a
      // gate — see requireAdmin's own comment in src/lib/auth/dal.ts); a
      // non-owner admin who clicks it is redirected by the page itself,
      // consistent with every other admin-only link.
      { href: '/admin/debug', label: 'Debug Mode', icon: Activity },
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

// Which nav items get a "needs attention" badge, and which AdminNavCounts key
// feeds it. Static mapping — the counts themselves are per-request server
// data, threaded in via the navCounts prop, never baked into this module.
const NAV_COUNT_KEY: Partial<Record<string, keyof AdminNavCounts>> = {
  '/admin/contacts': 'contacts',
  '/admin/callbacks': 'callbacks',
  '/admin/campaigns': 'campaigns',
  '/admin/fleet': 'fleet',
};

// Renders one nav row: a Link with subtree-based active highlighting, plus an
// optional count badge. Shared by every group so the markup lives in exactly
// one place. The badge MUST be a sibling of SidebarMenuButton inside
// SidebarMenuItem, never nested inside the Link/render prop — SidebarMenuBadge
// positions itself off `peer/menu-button` (a previous-sibling selector) and
// the button's `[&>span:last-child]:truncate` would otherwise retarget from
// the label to the badge, breaking Hebrew label truncation.
function renderNavItem(item: NavItem, pathname: string, count?: number) {
  const { href, label, icon: Icon } = item;

  const active = isActive(pathname, href);
  return (
    <SidebarMenuItem key={href}>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        className={count ? 'pe-8' : undefined}
        render={
          <Link href={href} aria-current={active ? 'page' : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        }
      />
      {count ? <SidebarMenuBadge>{count > 99 ? '99+' : count}</SidebarMenuBadge> : null}
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
  availabilityBlocks,
  availabilityPresence,
  hasExchangeConnection,
  navCounts,
  softphone,
  children,
}: {
  userEmail: string | undefined;
  // Availability constraints in effect / scheduled (Exchange-backed presence).
  // Passed in from the layout so the avatar dot renders server-side with no
  // client fetch; the menu section takes over interactively from there.
  availabilityBlocks: AvailabilityBlock[];
  // Live presence from Exchange (not from our table) — a meeting created in
  // Outlook colours the dot exactly like a status set from this menu.
  availabilityPresence: PresenceSnapshot;
  hasExchangeConnection: boolean;
  // Full name from the profile (materialised at signup by the handle_new_user
  // trigger). The account menu shows the name as the primary identity and the
  // email as a secondary line, falling back to the email when the name is empty.
  userName?: string;
  // "Needs attention" counts per domain, resolved server-side under the
  // caller's own platform permissions (a null value means the viewer lacks
  // that domain's permission — NAV_COUNT_KEY lookups against it stay
  // undefined, so no badge renders rather than showing a stale 0).
  navCounts: AdminNavCounts;
  // Browser call-center softphone gate (call-center stage 3). Optional so any
  // other future caller of AdminShell renders byte-identically without it;
  // the layout always supplies it today. The panel component itself decides
  // whether to render anything — see SoftphonePanel's early return.
  softphone?: SoftphoneGateInfo;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const displayName = userName || userEmail || '';
  const initials = getInitials(displayName);

  // Expanded/collapsed state for every labelled group, keyed by label. Each
  // group starts from its `defaultOpen` (open unless explicitly false).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      NAV_GROUPS.flatMap((group) =>
        group.label ? [[group.label, group.defaultOpen ?? true]] : [],
      ),
    ),
  );

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
                  {group.items.map((item) => {
                    const countKey = NAV_COUNT_KEY[item.href];
                    const count = countKey ? (navCounts[countKey] ?? undefined) : undefined;
                    return renderNavItem(item, pathname, count);
                  })}
                </SidebarMenu>
              );

              // The unlabelled overview group is always shown (nothing to
              // collapse — it has no header).
              if (!group.label) {
                return (
                  <SidebarGroup key={index}>
                    <SidebarGroupContent>{menu}</SidebarGroupContent>
                  </SidebarGroup>
                );
              }

              // Every labelled group is collapsible: its header is a native
              // toggle button and the menu is conditionally rendered from local
              // state. The chevron rotates to signal open/closed.
              const label = group.label;
              const open = openGroups[label] ?? true;
              return (
                <SidebarGroup key={label}>
                  <SidebarGroupLabel
                    render={<button type="button" />}
                    aria-expanded={open}
                    onClick={() =>
                      setOpenGroups((state) => ({ ...state, [label]: !open }))
                    }
                    className="w-full cursor-pointer hover:text-sidebar-foreground"
                  >
                    {label}
                    <ChevronDown
                      className={cn(
                        'ms-auto size-4 transition-transform',
                        open && 'rotate-180',
                      )}
                    />
                  </SidebarGroupLabel>
                  {open ? (
                    <SidebarGroupContent>{menu}</SidebarGroupContent>
                  ) : null}
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
                        <span className="relative inline-flex">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          {/* Presence dot on the avatar itself — the standard
                              affordance; bottom-end so it stays clear of the
                              initials in both directions. */}
                          <AvailabilityDot
                            presence={availabilityPresence}
                            className="absolute -bottom-0.5 -end-0.5"
                          />
                        </span>
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
                      <AvailabilityMenuSection
                        initialBlocks={availabilityBlocks}
                        initialPresence={availabilityPresence}
                        hasConnection={hasExchangeConnection}
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

        {/* Sibling of SidebarInset (not a child of it) so it floats over the
            page content and survives navigation — AdminShell itself is not
            remounted between admin pages, only `children` swaps. Mounted
            inside DirectionProvider/SidebarProvider: any portaled Base UI
            piece the panel grows later needs that ancestor for RTL (see
            SidebarInset RTL memory — Base UI ignores the DOM `dir`). */}
        {softphone ? <SoftphonePanelLazy {...softphone} /> : null}
      </SidebarProvider>
    </DirectionProvider>
  );
}
