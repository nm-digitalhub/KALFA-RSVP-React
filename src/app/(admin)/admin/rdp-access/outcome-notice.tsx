import { History, MessageSquare } from 'lucide-react';

import { formatIsraelTime } from '@/lib/date';
import type { RdpAccessView } from '@/lib/data/admin/rdp-access';
import { ENDED_REASON_TEXT, filesDownloadedText, LAST_REQUEST_COPY } from '@/lib/rdp-access/copy';
import { cn } from '@/lib/utils';

// What happened to the person's LAST request, as a small notice above the request form. The form is always what the
// page leads with when nothing is waiting or live: a finished request is information, not a place to stop. A refusal
// carries the owner's note, which is the one thing the person may need to read before asking again.

export type OutcomeView = Extract<RdpAccessView, { kind: 'denied' | 'expired' | 'cancelled' | 'ended' }>;

export function isOutcome(view: RdpAccessView): view is OutcomeView {
  return view.kind === 'denied' || view.kind === 'expired' || view.kind === 'cancelled' || view.kind === 'ended';
}

function endedText(view: Extract<OutcomeView, { kind: 'ended' }>): string {
  const parts = [
    view.endedAt ? `${LAST_REQUEST_COPY.ended} ${LAST_REQUEST_COPY.endedAt} ${formatIsraelTime(view.endedAt)}` : LAST_REQUEST_COPY.ended,
    view.endedReason ? ENDED_REASON_TEXT[view.endedReason] : null,
    filesDownloadedText(view.filesIssued),
    // what the gateway recorded, not what the downloads imply
    view.connectedAt ? `${LAST_REQUEST_COPY.connected}${formatIsraelTime(view.connectedAt)}` : LAST_REQUEST_COPY.notConnected,
  ];
  return parts.filter((part): part is string => part !== null).join(' · ');
}

export function OutcomeNotice({ view }: { view: OutcomeView }) {
  const denied = view.kind === 'denied';
  const text = view.kind === 'ended' ? endedText(view) : `${LAST_REQUEST_COPY.label}: ${LAST_REQUEST_COPY[view.kind]}`;
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm leading-6',
        denied ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/40',
      )}
    >
      <p className="flex items-start gap-2.5">
        <History className="mt-1 size-4 shrink-0 text-foreground/70" aria-hidden />
        <span>{text}</span>
      </p>
      {view.kind === 'denied' && view.note ? (
        <p className="flex items-start gap-2.5">
          <MessageSquare className="mt-1 size-4 shrink-0 text-foreground/70" aria-hidden />
          <span>
            <b>{LAST_REQUEST_COPY.noteLabel}</b> {view.note}
          </span>
        </p>
      ) : null}
    </div>
  );
}
