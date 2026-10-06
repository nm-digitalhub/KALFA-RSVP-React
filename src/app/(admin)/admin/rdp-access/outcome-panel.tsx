import { MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { formatIsraelTime } from '@/lib/date';
import { ENDED_REASON_TEXT, filesDownloadedText, OUTCOME_COPY } from '@/lib/rdp-access/copy';
import type { RdpAccessView } from '@/lib/data/admin/rdp-access';
import { cn } from '@/lib/utils';

import { stationStatesFor, type StationStates } from '@/lib/rdp-access/status';

import { MiniTrack } from './access-track';

// What is left on screen when a request is over: where it stopped (the short track), what happened, and the way
// to start again. Server-rendered: the only interaction is a link back to the form.

export type OutcomeView = Extract<RdpAccessView, { kind: 'denied' | 'expired' | 'cancelled' | 'ended' }>;

export const NEW_REQUEST_HREF = '/admin/rdp-access?new=1';

function trackFor(view: OutcomeView): { states: StationStates; label: string } {
  const states = stationStatesFor(view.kind, view.kind === 'ended' ? view.filesIssued : 0);
  if (view.kind === 'ended') {
    return { states, label: view.filesIssued > 0 ? 'הבקשה אושרה, הקובץ הורד והגישה הסתיימה' : 'הבקשה אושרה, אבל לא הורד קובץ' };
  }
  const label =
    view.kind === 'denied'
      ? 'הבקשה נשלחה, ונעצרה בשלב אישור הבעלים'
      : view.kind === 'cancelled'
        ? 'הבקשה נשלחה, וביטלתם אותה לפני החלטת הבעלים'
        : 'הבקשה נשלחה, ופגה לפני שהבעלים ענה';
  return { states, label };
}

export function OutcomePanel({ view }: { view: OutcomeView }) {
  const track = trackFor(view);
  const denied = view.kind === 'denied';
  return (
    <section
      aria-labelledby="rdp-outcome-title"
      className={cn('flex flex-col gap-5 rounded-2xl border bg-background px-5 py-6 sm:px-7', denied ? 'border-destructive/30' : 'border-border')}
    >
      <MiniTrack states={track.states} label={track.label} />

      <div className="flex flex-col gap-3">
        <h2 id="rdp-outcome-title" className="text-[22px] leading-[30px] font-extrabold">
          {OUTCOME_COPY[view.kind].title}
        </h2>

        {view.kind === 'denied' && view.note ? (
          <p className="flex items-start gap-2.5 rounded-xl bg-muted px-3.5 py-3 text-[15px] leading-6">
            <MessageSquare className="mt-1 size-[18px] shrink-0 text-foreground/70" aria-hidden />
            <span>
              <b>{OUTCOME_COPY.denied.noteLabel}</b> {view.note}
            </span>
          </p>
        ) : null}
        {view.kind === 'expired' || view.kind === 'cancelled' ? (
          <p className="text-[15px] leading-6 text-foreground/80">{OUTCOME_COPY[view.kind].body}</p>
        ) : null}
        {view.kind === 'ended' ? <EndedDetails view={view} /> : null}
      </div>

      <div>
        <Link href={NEW_REQUEST_HREF} className={cn(buttonVariants({ variant: 'default' }), 'h-12 gap-2 rounded-[14px] px-6 text-[15px] font-bold md:h-12')}>
          <Plus className="size-[18px]" aria-hidden />
          {OUTCOME_COPY.newRequest}
        </Link>
      </div>
    </section>
  );
}

function EndedDetails({ view }: { view: Extract<OutcomeView, { kind: 'ended' }> }) {
  const reason = view.endedReason ? ENDED_REASON_TEXT[view.endedReason] : null;
  return (
    <>
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[15px] leading-6 text-foreground/80">
        {view.endedAt ? (
          <li>
            הסתיימה ב-
            <b dir="ltr" className="font-mono font-semibold">
              {formatIsraelTime(view.endedAt)}
            </b>
          </li>
        ) : null}
        {reason ? <li>{reason}</li> : null}
        <li>{filesDownloadedText(view.filesIssued)}</li>
      </ul>
      <p className="text-[15px] leading-6 text-foreground/80">{OUTCOME_COPY.ended.closed}</p>
    </>
  );
}
