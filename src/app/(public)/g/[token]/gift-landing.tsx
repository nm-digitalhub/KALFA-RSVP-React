import Image from 'next/image';
import { Gift, Navigation } from 'lucide-react';

import { EVENT_TYPE_ICON, eventHeadingFor } from '@/lib/data/celebrant-display';
import { EVENT_THEME } from '@/lib/data/event-theme';
import { formatEventDateLine, GIFT_BRAND } from '@/lib/data/event-display';
import type { GiftView } from '@/lib/data/gift';

// Public gift landing page — an event-type-adaptive, celebratory page shown when
// a guest taps the WhatsApp gift/event-day button, before the payment redirect.
// Server Component: no client state, so dates render once on the server in
// Israel time (no hydration mismatch). The raw payment URL never reaches here —
// the CTA navigates to `/g/[token]/go`, which performs the server-side redirect.
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

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {inviteImageUrl ? (
        <a
          href={inviteImageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="פתיחת ההזמנה בגודל מלא"
          className="block border-b border-border"
        >
          <Image
            src={inviteImageUrl}
            alt="הזמנת האירוע"
            width={512}
            height={640}
            priority
            className="h-auto w-full object-contain"
          />
        </a>
      ) : null}

      {/* Per-event-type celebratory banner */}
      <div className={`${theme.banner} px-6 py-8 text-center`}>
        <AccentIcon aria-hidden className={`mx-auto size-10 ${theme.accent}`} />
        <h1 className="mt-3 text-2xl font-bold break-words text-foreground">
          {heading.title}
        </h1>
        {heading.subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground break-words">
            {heading.subtitle}
          </p>
        ) : null}
        <p className="mt-2 text-sm font-medium text-foreground/80">
          {theme.greeting}
        </p>
      </div>

      {/* Event details */}
      <div className="space-y-3 px-6 py-6 text-center">
        {dateLine ? (
          <p className="text-sm text-muted-foreground">{dateLine}</p>
        ) : null}
        {view.venue_name ? (
          <p className="text-sm text-muted-foreground break-words">
            {view.venue_name}
            {view.venue_address ? `, ${view.venue_address}` : ''}
          </p>
        ) : null}
        {view.venue_address ? (
          <p className="text-sm">
            <a
              href={`https://waze.com/ul?q=${encodeURIComponent(view.venue_address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <Navigation aria-hidden className="size-4" /> ניווט עם Waze
            </a>
          </p>
        ) : null}

        {/* Gift CTA — navigates same-tab to the server-side redirect (/go). */}
        <div className="pt-2">
          <a
            href={`/g/${token}/go`}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
      </div>
    </div>
  );
}
