'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import { cn } from '@/lib/utils';

// Desktop header navigation for the public landing pages — shadcn
// NavigationMenu on Base UI (ui.shadcn.com/docs/components/base/navigation-menu,
// base-ui.com/react/components/navigation-menu, both read 2026-08-24).
//
// Flat links only, ON PURPOSE: five destinations (three in-page anchors + two
// routes) do not justify Trigger/Content dropdowns — a popup that opens on
// hover to reveal three links is friction, not structure. What the primitive
// buys us over the previous bare <a> row: a real <nav><ul> landmark, roving
// keyboard navigation, the shared focus ring, and `active` (data-active) for
// the current route. Base UI's `render` prop keeps Next.js <Link> (client
// navigation + prefetch) for the routed items; the in-page anchors stay plain
// anchors so the browser handles the scroll.
//
// Direction: the NavigationMenu root here renders inline (no Portal is used
// without Trigger/Content), and the root layout's DirectionProvider covers the
// rest of Base UI (shadcn RTL guide: `rtl: true` in components.json +
// DirectionProvider in the root layout).

export const LANDING_NAV_ITEMS: readonly { href: string; label: string }[] = [
  { href: '#features', label: 'יכולות' },
  { href: '#how', label: 'איך זה עובד' },
  { href: '#trust', label: 'אמון' },
  { href: '/faq', label: 'שאלות נפוצות' },
  { href: '/contact', label: 'יצירת קשר' },
];

// shadcn rule: className is for layout only — the link's colours, hover,
// active and focus treatment come from the primitive's own
// navigationMenuTriggerStyle() (the documented "Link" pattern), not from
// overrides that reproduce the old bare-anchor look.
export function LandingHeaderNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <NavigationMenu className={cn('max-w-none', className)} aria-label="ניווט ראשי">
      <NavigationMenuList className="gap-1">
        {LANDING_NAV_ITEMS.map((item) => {
          const isRoute = item.href.startsWith('/');
          return (
            <NavigationMenuItem key={item.href}>
              <NavigationMenuLink
                className={navigationMenuTriggerStyle()}
                active={isRoute && pathname === item.href}
                render={isRoute ? <Link href={item.href} /> : <a href={item.href} />}
              >
                {item.label}
              </NavigationMenuLink>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
