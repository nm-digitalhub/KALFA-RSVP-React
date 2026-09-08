import Image from 'next/image';

import { TiltCard } from '@/components/motion/tilt-card';

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
    // Entrance wrapper OUTSIDE TiltCard (see its caller contract): TiltCard
    // remounts its children when it switches to the tilt island (mouse on
    // desktop, finger on touch), so an entrance on the card itself would replay.
    // The outer `perspective-distant` gives the 6° starting tilt its depth.
    <div className="perspective-distant">
      <div className="transition-[opacity,translate,transform] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-4 motion-safe:starting:rotate-x-6">
        <TiltCard maxAngle={6} scale={1.01}>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {inviteImageUrl ? (
              <a
                href={inviteImageUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="פתיחת ההזמנה בגודל מלא"
                className="block border-b border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
              <AccentIcon
                aria-hidden
                className={`mx-auto size-10 motion-safe:animate-k-pop k-delay-300 ${theme.accent}`}
              />
              <h1 className="mt-3 text-balance text-2xl font-bold break-words text-foreground">
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
        </TiltCard>
      </div>
    </div>
  );
}
