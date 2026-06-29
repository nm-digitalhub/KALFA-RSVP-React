'use client';

// Shared (?) help icon that opens a detailed explanation bubble on CLICK / TAP /
// keyboard (Enter/Space) — works on desktop, touch (mobile/tablet) AND keyboard,
// unlike a hover-only tooltip. Uses Base UI Popover; RTL-correct via the
// admin-shell DirectionProvider. `type="button"` is required because the icon
// lives inside <form> elements — without it a click would submit the form.

import { Popover } from '@base-ui/react/popover';
import { CircleHelp } from 'lucide-react';

export function HelpTip({ text }: { text: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label="הסבר"
        className="inline-flex items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <CircleHelp className="size-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          sideOffset={6}
          className="isolate z-50"
        >
          <Popover.Popup
            dir="rtl"
            className="z-50 max-w-xs rounded-md border border-border bg-card px-3 py-2 text-right text-xs leading-relaxed text-foreground shadow-md outline-none"
          >
            {text}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
