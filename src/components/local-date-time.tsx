'use client';

import { useId } from 'react';

// Viewer-local timestamp for ADMIN-OPERATIONAL times (when a request/goal/run
// was created, answered, etc.) — the opposite case from src/lib/date.ts,
// which pins every date to Asia/Jerusalem ON PURPOSE because an event's
// date/time is a fact about ISRAEL (where it happens), not about whoever is
// looking at it. "When did I see/create this" is genuinely about the viewer,
// so THIS component is the one place in the app that should NOT force a
// fixed zone. Do not reuse it for event dates, RSVP deadlines, or anything
// guest-facing — those stay on formatIsraelDateTime.
//
// There is no server-side way to know a visitor's time zone (unlike locale,
// `Accept-Language` carries no TZ — Next's own docs confirm this), so the
// server renders its own zone (Asia/Jerusalem, same as today) and an inline
// script corrects the DOM to the browser's real zone SYNCHRONOUSLY during
// HTML parsing, before React hydrates — no flash, no hydration error.
// Pattern is Next.js's own documented fix, not invented here:
// node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
// (`LocalDate` + inline-script example). Locale/format stay fixed to he-IL —
// this is a Hebrew-only admin panel; only the WALL-CLOCK zone should adapt to
// the viewer, not the language.

const LOCALE = 'he-IL';
const OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

function format(iso: string): string {
  const ms = new Date(iso).getTime();
  // No `timeZone` here on purpose: this resolves to whatever runtime executes
  // it — the server's Asia/Jerusalem on first render, the browser's own zone
  // both in the inline script (below) and on any later client-side render.
  return Number.isNaN(ms) ? '' : new Intl.DateTimeFormat(LOCALE, OPTIONS).format(ms);
}

/** '12.07.2026, 17:30' in the VIEWER's own time zone. '' for invalid input. */
export function LocalDateTime({ iso }: { iso: string }) {
  const id = useId();
  const serverRender = format(iso);

  return (
    <time dateTime={iso} id={id} suppressHydrationWarning>
      {serverRender}
      <script
        type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html:
            `{var n=document.getElementById(${JSON.stringify(id)});` +
            `if(n)n.textContent=new Intl.DateTimeFormat(${JSON.stringify(LOCALE)},` +
            `${JSON.stringify(OPTIONS)}).format(new Date(${JSON.stringify(iso)}))}`,
        }}
      />
    </time>
  );
}
