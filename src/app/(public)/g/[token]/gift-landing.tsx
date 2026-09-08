import { Fragment } from 'react';
import Image from 'next/image';
import { Gift, Navigation } from 'lucide-react';

import { AddToCalendar } from '@/components/add-to-calendar';
import { FlipCard } from '@/components/motion/flip-card';
import {
  EVENT_TYPE_ICON,
  eventHeadingFor,
  eventHeadingSegmentsFor,
} from '@/lib/data/celebrant-display';
import { EVENT_THEME } from '@/lib/data/event-theme';
import { formatEventDateLine, GIFT_BRAND } from '@/lib/data/event-display';
import type { GiftView } from '@/lib/data/gift';

// Public gift landing page — an event-type-adaptive, celebratory page shown when
// a guest taps the WhatsApp gift/event-day button, before the payment redirect.
// Server Component: no client state, so dates render once on the server in
// Israel time (no hydration mismatch). The raw payment URL never reaches here —
// the CTA navigates to `/g/[token]/go`, which performs the server-side redirect.
//
// Presentation (motion spec §9): a two-faced card. FRONT = the invitation image
// + greeting + the essentials (date, venue); BACK = the extras (Waze, calendar).
// The FlipCard island flips to the back by itself after ~1.4s and offers a
// toggle both ways. Two things are deliberately OUTSIDE the card (security
// review 2026-09-08): the page's h1 heading (visually hidden, so it is exposed to
// assistive tech from the first paint regardless of which face shows) and the
// payment CTA — a guest whose JavaScript never runs still sees the invitation
// and can still pay. Both faces are rendered here, on the server; the island
// holds only the flipped/not-flipped state.
export function GiftLanding({
  view,
  token,
  inviteImageUrl,
}: {
  view: GiftView;
  token: string;
  inviteImageUrl: string | null;
}) {
  const eventType = view.event_type;
  const heading = eventHeadingFor(eventType, view.celebrants, view.name);
  const AccentIcon = EVENT_TYPE_ICON[eventType];
  const theme = EVENT_THEME[eventType];
  const dateLine = formatEventDateLine(view.event_date);
  const brand = GIFT_BRAND[view.giftProvider];
  // The visible title = heading.title split so a line break falls between
  // people, never inside a name ("החתונה של אייל / מלכה ושלומית קאקון" on the
  // owner's iPhone, 2026-09-08). The sr-only h1 keeps the plain string.
  const title = eventHeadingSegmentsFor(eventType, view.celebrants, view.name).map((segment, i) =>
    segment.noWrap ? (
      <span key={i} className="whitespace-nowrap">
        {segment.text}
      </span>
    ) : (
      <Fragment key={i}>{segment.text}</Fragment>
    ),
  );

  const front = (
    <>
      {inviteImageUrl ? (
        <a
          href={inviteImageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="פתיחת ההזמנה בגודל מלא"
          // The image box is reserved by width/height; while the signed
          // storage image loads (and in any letterbox around it) the box shows
          // the event-type wash instead of a blank white block. No blur source
          // is available without an extra fetch, so no `placeholder="blur"`.
          className={`${theme.banner} block border-b border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
        >
          <Image
            src={inviteImageUrl}
            alt="הזמנת האירוע"
            width={512}
            height={640}
            priority
            // Height cap = the small viewport minus the rest of the first
            // screen (card offset + banner + toggle row + gap + payment CTA ≈
            // 30rem, MEASURED 2026-09-08 on a 2-line title / 2-line venue
            // event), never under 10rem. Keeps the payment CTA inside the
            // first viewport on 667px phones (was 36px below the fold) and
            // for portrait invitations on 844px phones; the picture
            // letterboxes on the event wash the <a> paints. The FlipCard
            // cell rule is untouched: the card is still the taller face.
            className="h-auto max-h-[max(10rem,calc(100svh_-_30rem))] w-full object-contain"
          />
        </a>
      ) : null}

      {/* Per-event-type celebratory banner + the essentials. Meta lines are
          `text-foreground/70`, not `text-muted-foreground`: on the tinted
          wash the muted grey measures 3.84–4.25:1 (fails AA 4.5) while
          foreground at 70% measures 6.92–7.27:1 on every event-type wash
          (computed 2026-09-08; the greeting keeps /80 as the stronger line). */}
      <div className={`${theme.banner} px-6 py-8 text-center`}>
        <AccentIcon
          aria-hidden
          className={`mx-auto size-10 motion-safe:animate-k-pop k-delay-300 ${theme.accent}`}
        />
        <p className="mt-3 text-balance text-2xl font-bold break-words text-foreground">
          {title}
        </p>
        {heading.subtitle ? (
          <p className="mt-1 text-sm text-foreground/70 break-words">
            {heading.subtitle}
          </p>
        ) : null}
        <p className="mt-2 text-sm font-medium text-foreground/80">
          {theme.greeting}
        </p>
        {dateLine ? (
          <p className="mt-3 text-sm text-foreground/70">{dateLine}</p>
        ) : null}
        {view.venue_name ? (
          <p className="mt-1 text-sm text-foreground/70 break-words">
            {view.venue_name}
            {view.venue_address ? `, ${view.venue_address}` : ''}
          </p>
        ) : null}
      </div>
    </>
  );

  // The back face is as tall as the front (shared grid cell, see FlipCard), so
  // its content is centred by FlipCard and the whole face carries the event
  // wash (`backClassName` below) — the spare height is designed surface.
  const back = (
    <div className="space-y-4 px-6 py-10 text-center">
      <AccentIcon aria-hidden className={`mx-auto size-10 ${theme.accent}`} />
      <p className="text-balance text-xl font-bold break-words text-foreground">
        {title}
      </p>
      {dateLine ? (
        <p className="text-sm text-foreground/70">{dateLine}</p>
      ) : null}
      {view.venue_address ? (
        <p className="text-sm">
          <a
            href={`https://waze.com/ul?q=${encodeURIComponent(view.venue_address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Navigation aria-hidden className="size-4" /> ניווט עם Waze
          </a>
        </p>
      ) : null}
      {/* One shared control with /r (see add-to-calendar.tsx). Its menu is a
          portaled dialog on document.body, so the card's overflow/3D transform
          never clips it; the button itself is inert only while this face is.
          `outline`: this page has ONE primary action — the payment CTA below
          the card — so the calendar button is a visibly secondary control
          (hierarchy decision, docs/design/add-to-calendar-button.md §11). */}
      <AddToCalendar
        variant="outline"
        className="pt-1"
        icsHref={`/g/${token}/event.ics`}
        event={{
          name: view.name,
          event_type: view.event_type,
          event_date: view.event_date,
          venue_name: view.venue_name,
          venue_address: view.venue_address,
          celebrants: view.celebrants,
        }}
      />
    </div>
  );

  return (
    <>
      <h1 className="sr-only">{heading.title}</h1>

      <FlipCard
        className="transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-4"
        backClassName={theme.banner}
        // With an invitation, the auto-flip waits for the image to load and
        // dwells 2.5s on it (flip-card.tsx / auto-flip.ts); without one, the
        // plain 1.4s timer stays.
        autoFlipAwaitsFrontImage={inviteImageUrl !== null}
        front={front}
        back={back}
        frontToggleLabel="ניווט ויומן"
        backToggleLabel="חזרה להזמנה"
      />

      {/* Gift CTA — OUTSIDE the card on purpose: always visible, never inert,
          works with zero JavaScript. Navigates same-tab to the server-side
          redirect (/go). */}
      <div className="text-center">
        <a
          href={`/g/${token}/go`}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground shadow-sm shadow-primary/25 transition hover:opacity-90 hover:shadow-md hover:shadow-primary/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring duration-300 ease-k-out motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]"
        >
          {brand ? (
            <Image
              src={brand.icon}
              alt=""
              aria-hidden
              width={22}
              height={22}
              className="size-[22px] rounded-[6px]"
            />
          ) : (
            <Gift aria-hidden className="size-5" />
          )}
          {brand?.label ?? 'שליחת מתנה'}
        </a>
      </div>
    </>
  );
}
