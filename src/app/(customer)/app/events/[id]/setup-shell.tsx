import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { EventStatusActions } from './event-status-actions';
import { SetupStepper, type SetupStepperBack, type SetupStepView } from './setup-stepper';

// The one frame of the setup flow (design D3), shared by /setup and the package payment page so the step list stays in
// view while paying: the header, the stepper (once), ONE content surface, and the close (design D5). The surface is the
// only framed panel a step gets; what a step renders inside it are sections with headings, never another frame.
// Server component: the steps, the back link and whether the close is offered are decided by the page, on the server.
export function SetupShell({
  eventId,
  eventName,
  steps,
  back,
  close,
  children,
}: {
  eventId: string;
  eventName: string;
  steps: SetupStepView[];
  back: SetupStepperBack | null;
  // null when the viewer does not hold `events.close`: no control is rendered (closeEvent refuses them anyway).
  close: ComponentProps<typeof EventStatusActions> | null;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">הקמת אישורי הגעה</h1>
          <Link
            href={`/app/events/${eventId}`}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden="true">→</span>
            חזרה לאירוע
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">{eventName}</p>
      </header>

      <section className="rounded-lg border border-border bg-card p-6">
        <SetupStepper steps={steps} back={back} />
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">{children}</section>

      {close ? <EventStatusActions {...close} /> : null}
    </div>
  );
}
