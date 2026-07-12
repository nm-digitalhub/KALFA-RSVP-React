import Image from 'next/image';

import { EVENT_TYPE_ICON, eventHeadingFor } from '@/lib/data/celebrant-display';
import { EVENT_THEME, EVENT_THANKYOU_GREETING } from '@/lib/data/event-theme';
import { formatEventDateLine } from '@/lib/data/event-display';
import type { ThankyouView } from '@/lib/data/thankyou';

// Public post-event thank-you page — an event-type-adaptive page shown after a
// guest taps the WhatsApp thank-you message's link. Server Component: no client
// state, so the date renders once on the server in Israel time (no hydration
// mismatch). Unlike the gift landing page, there is NO CTA — this page is pure
// gratitude, nothing to click through to.
export function ThankyouLanding({
  view,
  inviteImageUrl,
}: {
  view: ThankyouView;
  inviteImageUrl: string | null;
}) {
  const eventType = view.event_type;
  const heading = eventHeadingFor(eventType, view.celebrants, view.name);
  const AccentIcon = EVENT_TYPE_ICON[eventType];
  const theme = EVENT_THEME[eventType];
  const dateLine = formatEventDateLine(view.event_date);

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
          {EVENT_THANKYOU_GREETING[eventType]}
        </p>
      </div>

      {/* Event details — past-tense, no CTA */}
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
      </div>
    </div>
  );
}
