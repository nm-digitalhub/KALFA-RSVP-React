'use client';

import { Check, ClipboardList, Hourglass, RefreshCw, Send, Timer, X } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCountdown, percentLeft, spokenRemaining } from '@/lib/rdp-access/countdown';
import { minutesLabel, PENDING_COPY } from '@/lib/rdp-access/copy';
import type { FormState } from '@/lib/validation/result';

import { cancelRdpRequestAction } from './actions';
import { StatusPoller } from './status-poller';
import { useCountdown } from './use-countdown';

// Station 2: the request is with the owner. The timer is how long the REQUEST stays open (it expires on its own);
// the page refreshes itself, so the person does not have to watch it. Stopping the request goes through a dialog
// whose safe answer ("keep waiting") has the focus and the weight, and whose destructive answer is the quiet one.

export type PendingPanelProps = {
  requestId: string;
  reason: string;
  requestedMinutes: number;
  createdAt: string;
  expiresAt: string;
  serverNow: string;
};

function sentAgoText(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'ממש עכשיו';
  return minutes === 1 ? 'לפני דקה' : `לפני ${minutes} דקות`;
}

export function PendingPanel({ requestId, reason, requestedMinutes, createdAt, expiresAt, serverNow }: PendingPanelProps) {
  const remainingMs = useCountdown(expiresAt, serverNow);
  const totalMs = Date.parse(expiresAt) - Date.parse(createdAt);
  const left = percentLeft(remainingMs, totalMs);
  const timer = formatCountdown(remainingMs, { hours: false });

  const [state, formAction] = useActionState<FormState, FormData>(cancelRdpRequestAction, null);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <StatusPoller deadlineIso={expiresAt} />
      <section aria-labelledby="rdp-pending-title" className="flex flex-col gap-5 rounded-2xl border border-border bg-muted/30 p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="rdp-pending-title" className="text-lg font-bold">
            {PENDING_COPY.title}
          </h2>
          <Badge variant="warning" className="h-7 gap-2 px-3 text-[13px] font-semibold">
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            {PENDING_COPY.badge}
          </Badge>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-3.5">
            <span
              dir="ltr"
              role="timer"
              aria-label={`הבקשה פגה בעוד ${spokenRemaining(remainingMs)}`}
              className="font-mono text-5xl leading-[60px] font-semibold tracking-tight tabular-nums sm:text-[56px]"
            >
              {timer}
            </span>
            <span className="text-[15px] text-foreground/80">{PENDING_COPY.timerHint}</span>
          </div>
          <div role="img" aria-label={`נותרו ${left} אחוזים מזמן הבקשה`} className="h-2 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-warning transition-[width] duration-1000 ease-linear" style={{ width: `${left}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
          <Fact icon={<ClipboardList className="size-4" aria-hidden />} label={PENDING_COPY.purpose} wide>
            {reason}
          </Fact>
          <Fact icon={<Timer className="size-4" aria-hidden />} label={PENDING_COPY.asked}>
            <b className="font-semibold">{minutesLabel(requestedMinutes)}</b>
          </Fact>
          <Fact icon={<Send className="size-4 rtl:-scale-x-100" aria-hidden />} label={PENDING_COPY.sent}>
            <b className="font-semibold">{sentAgoText(totalMs - remainingMs)}</b>
          </Fact>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <span className="inline-flex items-center gap-2 text-sm text-foreground/80">
            <RefreshCw className="size-4" aria-hidden />
            {PENDING_COPY.liveHint}
          </span>

          <form ref={formRef} action={formAction}>
            <input type="hidden" name="requestId" value={requestId} />
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger render={<Button type="button" variant="outline" className="h-12 gap-2 rounded-[14px] px-5 text-[15px] font-semibold" />}>
                <X className="size-4" aria-hidden />
                {PENDING_COPY.cancel}
              </AlertDialogTrigger>
              {/* portaled outside the form, so the confirm button submits it explicitly */}
              <AlertDialogContent className="gap-5 rounded-3xl bg-console p-6 text-console-foreground ring-console-line/40 data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
                <CancelTrack />
                <div className="flex flex-col gap-2">
                  <AlertDialogTitle className="text-2xl leading-8 font-extrabold">{PENDING_COPY.dialog.title}</AlertDialogTitle>
                  <AlertDialogDescription className="text-[15px] leading-6 text-console-muted">{PENDING_COPY.dialog.body}</AlertDialogDescription>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-console-raised px-3.5 py-3">
                  <span className="inline-flex items-center gap-2 text-sm text-console-muted">
                    <Hourglass className="size-4" aria-hidden />
                    {PENDING_COPY.dialog.validFor}
                  </span>
                  <span dir="ltr" className="font-mono text-lg font-semibold tabular-nums">
                    {timer}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  <AlertDialogCancel
                    variant="default"
                    className="h-[52px] w-full gap-2.5 rounded-[14px] border-transparent bg-console-accent text-base font-bold text-console-accent-foreground hover:bg-console-accent/90"
                  >
                    <Hourglass className="size-[18px]" aria-hidden />
                    {PENDING_COPY.dialog.keep}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="outline"
                    className="h-12 w-full gap-2 rounded-[14px] border-console-danger/60 bg-transparent text-[15px] font-semibold text-console-danger hover:bg-console-danger/10 hover:text-console-danger"
                    onClick={() => {
                      setOpen(false);
                      formRef.current?.requestSubmit();
                    }}
                  >
                    <X className="size-4" aria-hidden />
                    {PENDING_COPY.dialog.confirm}
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </form>
        </div>

        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </section>
    </>
  );
}

function Fact({ icon, label, wide, children }: { icon: React.ReactNode; label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 rounded-[14px] border border-border bg-background px-4 py-3.5 ${wide ? 'col-span-full' : ''}`}>
      <dt className="flex items-center gap-2 text-[13px] leading-5 text-foreground/70">
        {icon}
        {label}
      </dt>
      <dd className="m-0 text-[15px] leading-6 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// The track in the dialog: the first station done, the second one marked as the place the request stops.
function CancelTrack() {
  return (
    <div className="flex flex-col gap-2.5">
      <div aria-hidden className="flex items-center">
        <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-console-accent text-console-accent-foreground">
          <Check className="size-4" strokeWidth={2.5} />
        </span>
        <span className="h-[3px] flex-1 bg-console-accent" />
        <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full border-2 border-console-danger/70 bg-console-danger/15 text-console-danger">
          <X className="size-3.5" strokeWidth={2.5} />
        </span>
        <span className="h-0 flex-1 border-t-[3px] border-dashed border-console-line" />
        <span className="size-[30px] shrink-0 rounded-full border-2 border-console-line" />
        <span className="h-0 flex-1 border-t-[3px] border-dashed border-console-line" />
        <span className="size-[30px] shrink-0 rounded-full border-2 border-console-line" />
      </div>
      <span className="text-[13px] leading-5 text-console-muted">{PENDING_COPY.dialog.stoppedAt}</span>
    </div>
  );
}
