'use client';

import { useState, useSyncExternalStore } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { CalendarPlus, Download, ExternalLink, Smartphone, XIcon } from 'lucide-react';

import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import type { CalendarWebLinks } from '@/lib/calendar/event-calendar';
import {
  detectCalendarPlatform,
  googleCalendarAndroidIntent,
  type CalendarPlatform,
} from '@/lib/calendar/platform';
import { cn } from '@/lib/utils';

// Client half of <AddToCalendar>: the "הוספה ליומן" button and its menu.
//
// The menu is KALFA's own (Base UI Dialog, portaled to <body>, RTL via the root
// DirectionProvider): a bottom sheet under `sm`, a centred 360px card above.
// Each row is a plain <a> — the browser/OS does the hand-off, nothing here
// opens windows or races timers:
//
//   iOS      יומן Apple → the token-gated ICS route, same tab, no `download`:
//            Safari renders inline text/calendar as the Calendar preview
//            ("Add All"). Google / Outlook.com / Microsoft 365 → their web
//            editors (new tab). No documented iOS scheme or universal link
//            exists for a pre-filled Google or Outlook event, so none is used.
//   Android  יומן Google → Chrome `intent:` URL that opens the Google Calendar
//            APP pre-filled, with `S.browser_fallback_url` back to the web
//            editor when the app is missing (OS-mediated, documented by Chrome);
//            inside a `wv` WebView the plain URL. יומן אחר → ICS download (the
//            download notification opens Samsung/Google/any calendar).
//            Outlook.com / Microsoft 365 → web editors.
//   desktop  Google / Outlook.com / Microsoft 365 → web editors; קובץ יומן →
//            ICS download (Apple Calendar, Outlook desktop, Thunderbird…).
//
// The platform is read from the user agent after hydration (server snapshot =
// desktop); the rows only exist inside the dialog, which opens client-side, so
// the server HTML never depends on it. Every href is server-generated
// (calendar-link web links, the ICS route) except the Android intent wrapper,
// which is built from Chrome's documented syntax around the Google URL.

// `primary` = the gift CTA's look (bg-primary, primary-tinted shadow, lift on
// hover); `outline` = indigo text + indigo 1px border, transparent fill, for a
// page that already has one primary action (the gift card — hierarchy decision
// and contrast figures in docs/design/add-to-calendar-button.md §11: indigo on
// every event-type wash ≥ 5.23:1; a neutral `border-border` outline fails
// 3:1 on the tinted wash). Both 48px targets.
const BUTTON_BASE =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-6 py-3 text-base font-medium transition duration-300 ease-k-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]';
const BUTTON_VARIANT: Record<'primary' | 'outline', string> = {
  primary:
    'bg-primary text-primary-foreground shadow-sm shadow-primary/25 hover:opacity-90 hover:shadow-md hover:shadow-primary/30 motion-safe:hover:-translate-y-0.5',
  outline: 'border border-primary bg-transparent text-primary hover:bg-primary/10',
};

const ROW_CLASS =
  'flex min-h-14 items-center gap-3 rounded-md px-2 text-start text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

const SERVER_PLATFORM: CalendarPlatform = { os: 'other', webview: false };
const noop = () => () => {};
// useSyncExternalStore compares snapshots by identity: a fresh object per call
// re-renders forever (React error #185 — caught by the headless harness before
// this shipped), so the detection result is memoised per user-agent string.
let cachedUa: string | null = null;
let cachedPlatform: CalendarPlatform = SERVER_PLATFORM;
function clientPlatform(): CalendarPlatform {
  const ua = navigator.userAgent;
  if (ua !== cachedUa) {
    cachedUa = ua;
    cachedPlatform = detectCalendarPlatform(ua);
  }
  return cachedPlatform;
}
function usePlatform(): CalendarPlatform {
  return useSyncExternalStore(noop, clientPlatform, () => SERVER_PLATFORM);
}

interface Row {
  key: string;
  label: string;
  /** What will happen, in the guest's words — the surprise the owner reported. */
  hint: string;
  href: string;
  newTab: boolean;
  download?: string;
  icon: typeof Download;
}

function rows(platform: CalendarPlatform, links: CalendarWebLinks, ics: { href: string; filename: string }): Row[] {
  const web = (key: string, label: string, href: string): Row => ({
    key,
    label,
    hint: 'נפתח בדפדפן',
    href,
    newTab: true,
    icon: ExternalLink,
  });
  const outlook = web('outlookcom', 'Outlook.com', links.outlookcom);
  const ms365 = web('ms365', 'Microsoft 365', links.ms365);

  if (platform.os === 'ios') {
    return [
      {
        key: 'apple',
        label: 'יומן Apple',
        hint: 'נפתח ביומן של האייפון',
        href: ics.href,
        newTab: false,
        icon: CalendarPlus,
      },
      web('google', 'יומן Google', links.google),
      outlook,
      ms365,
    ];
  }

  if (platform.os === 'android') {
    return [
      platform.webview
        ? web('google', 'יומן Google', links.google)
        : {
            key: 'google',
            label: 'יומן Google',
            hint: 'נפתח באפליקציה (או בדפדפן אם אינה מותקנת)',
            href: googleCalendarAndroidIntent(links.google),
            newTab: false,
            icon: Smartphone,
          },
      {
        key: 'ical',
        label: 'יומן אחר (Samsung ועוד)',
        hint: 'הורדת קובץ יומן ופתיחה באפליקציה',
        href: ics.href,
        newTab: false,
        download: ics.filename,
        icon: Download,
      },
      outlook,
      ms365,
    ];
  }

  return [
    web('google', 'יומן Google', links.google),
    outlook,
    ms365,
    {
      key: 'ical',
      label: 'קובץ יומן (Apple, Outlook ועוד)',
      hint: 'הורדת קובץ .ics',
      href: ics.href,
      newTab: false,
      download: ics.filename,
      icon: Download,
    },
  ];
}

export function AddToCalendarIsland({
  links,
  ics,
  variant = 'primary',
  className,
}: {
  links: CalendarWebLinks;
  ics: { href: string; filename: string };
  variant?: 'primary' | 'outline';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const platform = usePlatform();
  const items = rows(platform, links, ics);

  return (
    <div className={cn('flex justify-center', className)}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger className={cn(BUTTON_BASE, BUTTON_VARIANT[variant])}>
          <CalendarPlus aria-hidden className="size-5" />
          הוספה ליומן
        </DialogPrimitive.Trigger>
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Popup
            className={cn(
              // Shared: popover surface, focus outline off (rows carry their own).
              'fixed z-50 flex flex-col bg-popover text-popover-foreground outline-none ring-1 ring-foreground/10',
              'transition duration-200 ease-k-out motion-reduce:transition-none data-starting-style:translate-y-6 data-starting-style:opacity-0 data-ending-style:translate-y-6 data-ending-style:opacity-0',
              // Bottom sheet on phones: full width, top corners, safe-area padding.
              'inset-x-0 bottom-0 rounded-t-2xl px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]',
              // Card from `sm`: centred by auto margins (no transforms), 360px.
              'sm:inset-0 sm:m-auto sm:h-fit sm:w-full sm:max-w-[22.5rem] sm:rounded-2xl sm:px-3 sm:pb-3',
            )}
          >
            <div className="flex items-center justify-between gap-4 py-2">
              <DialogTitle className="text-lg font-bold text-foreground">הוספה ליומן</DialogTitle>
              <DialogPrimitive.Close
                aria-label="סגירה"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <XIcon aria-hidden className="size-5" />
              </DialogPrimitive.Close>
            </div>
            <DialogDescription className="sr-only">בחרו את היומן שבו לשמור את האירוע</DialogDescription>
            <ul className="divide-y divide-border border-t border-border">
              {items.map((row) => {
                const Icon = row.icon;
                return (
                  <li key={row.key}>
                    <a
                      href={row.href}
                      className={ROW_CLASS}
                      {...(row.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      {...(row.download ? { download: row.download } : {})}
                      onClick={() => setOpen(false)}
                    >
                      <Icon aria-hidden className="size-5 shrink-0 text-primary" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span>{row.label}</span>
                        <span className="text-xs font-normal text-muted-foreground">{row.hint}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
            {platform.os === 'ios' && platform.webview ? (
              <p className="pt-3 text-xs text-muted-foreground">
                בדפדפן פנימי של אפליקציה (כמו WhatsApp) יומן Apple לא תמיד נפתח — אם זה קורה, פתחו את הקישור
                בספארי.
              </p>
            ) : null}
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
      {/* Zero-JS fallback: the button needs the island, the web editor does not. */}
      <noscript>
        <a
          href={links.google}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          הוספה ליומן Google
        </a>
      </noscript>
    </div>
  );
}
