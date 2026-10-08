import { Monitor } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { isPlatformOwner } from '@/lib/auth/dal';
import { getMyRdpAccessState, type RdpAccessView } from '@/lib/data/admin/rdp-access';
import { formatIsraelTime } from '@/lib/date';
import { PAGE_TITLE } from '@/lib/rdp-access/copy';
import { RDP_FILE_VALID_MINUTES, RDP_REQUEST_TTL_MINUTES } from '@/lib/rdp-access/policy';
import { stationStatesFor, type StationStates } from '@/lib/rdp-access/status';
import { cn } from '@/lib/utils';

import { AccessTrack } from './access-track';
import { ActiveConsole } from './active-console';
import { isOutcome, OutcomeNotice } from './outcome-notice';
import { PendingPanel } from './pending-panel';
import { RequestForm } from './request-form';

export const metadata = { title: PAGE_TITLE };

// The state is per signed-in person and changes while the page is open (the owner answers, the window ends).
export const dynamic = 'force-dynamic';

// A person's own remote-desktop access: ask for it, wait for the owner, download the connection file, end it.
// The permission gate lives in getMyRdpAccessState (and in every action and the file route); the page only draws
// the state it is given, along the four-station track.

type Step = { number: 1 | 2 | 3 | 4; states: StationStates; hints: readonly [string, string, string, string] };

function stepFor(view: RdpAccessView): Step {
  if (view.kind === 'pending') {
    return {
      number: 2,
      states: stationStatesFor('pending', { filesIssued: 0, connected: false }),
      hints: ['נשלחה', 'ממתין להחלטה', 'אחרי האישור', 'עד סוף הזמן'],
    };
  }
  if (view.kind === 'active') {
    const connected = view.connectedAt !== null;
    return {
      number: connected ? 4 : 3,
      states: stationStatesFor('active', { filesIssued: view.filesIssued, connected }),
      // the fourth station is what the gateway recorded, not a promise
      hints: ['נשלחה', 'אושר', 'מוכן להורדה', view.connectedAt ? `השער אישר חיבור ב-${formatIsraelTime(view.connectedAt)}` : 'אחרי פתיחת הקובץ'],
    };
  }
  return {
    number: 1,
    states: ['current', 'upcoming', 'upcoming', 'upcoming'],
    hints: ['מטרה ומשך', `עד ${RDP_REQUEST_TTL_MINUTES} דקות`, `תקף ${RDP_FILE_VALID_MINUTES} דקות`, 'עד סוף הזמן'],
  };
}

export default async function RdpAccessPage() {
  const [{ view, serverNow }, owner] = await Promise.all([getMyRdpAccessState(), isPlatformOwner()]);

  // A finished request is information, not a place to stop: the page leads with the form and shows how the last one
  // ended as a small notice above it.
  const lastOutcome = isOutcome(view) ? view : null;
  const shown: RdpAccessView = lastOutcome ? { kind: 'none' } : view;
  const step = stepFor(shown);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <Monitor className="size-[30px] text-primary" aria-hidden />
          <h1 className="text-2xl leading-[34px] font-extrabold sm:text-[26px]">{PAGE_TITLE}</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center rounded-full bg-muted px-3.5 py-1.5 text-[13px] leading-5 font-semibold text-foreground/80">
            {`שלב ${step.number} מתוך 4`}
          </span>
          {owner ? (
            <Link href="/admin/rdp-access/requests" className={cn(buttonVariants({ variant: 'outline' }), 'h-10 rounded-xl px-4 text-sm')}>
              כל הבקשות
            </Link>
          ) : null}
        </div>
      </div>

      <AccessTrack states={step.states} hints={step.hints} />

      {lastOutcome ? <OutcomeNotice view={lastOutcome} /> : null}
      {shown.kind === 'none' ? <RequestForm serverNow={serverNow} /> : null}
      {shown.kind === 'pending' ? (
        <PendingPanel
          requestId={shown.requestId}
          reason={shown.reason}
          requestedMinutes={shown.requestedMinutes}
          createdAt={shown.createdAt}
          expiresAt={shown.expiresAt}
          serverNow={serverNow}
        />
      ) : null}
      {shown.kind === 'active' ? (
        <ActiveConsole
          reason={shown.reason}
          startsAt={shown.startsAt}
          expiresAt={shown.expiresAt}
          serverNow={serverNow}
          filesIssued={shown.filesIssued}
          maxFiles={shown.maxFiles}
        />
      ) : null}
    </div>
  );
}
