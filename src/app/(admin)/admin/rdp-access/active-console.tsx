'use client';

import { useRouter } from 'next/navigation';
import { ClipboardList, Clock, Download, Laptop, Monitor, Power, Smartphone, Terminal, TriangleAlert, type LucideIcon } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { formatIsraelTime } from '@/lib/date';
import { ACTIVE_COPY, DEVICES, downloadFailureText, type DeviceId } from '@/lib/rdp-access/copy';
import { formatCountdown, percentLeft, spokenRemaining } from '@/lib/rdp-access/countdown';
import type { FormState } from '@/lib/validation/result';

import { endRdpGrantAction } from './actions';
import { StatusPoller } from './status-poller';
import { useCountdown } from './use-countdown';

// Station 3: the owner said yes. A dark console with what is left (time and downloads), the one big action
// (download the connection file) and the quiet one (end the access), then how to open the file on each device.
//
// The file comes from POST /api/admin/rdp-access/file, which derives the grant from the signed-in user: nothing
// here tells the server WHICH grant. A refusal is shown as the fixed sentence for its code, never as the server's
// words.

export type ActiveConsoleProps = {
  reason: string;
  startsAt: string;
  expiresAt: string;
  serverNow: string;
  filesIssued: number;
  maxFiles: number;
};

const DEVICE_ICON: Record<DeviceId, LucideIcon> = {
  windows: Monitor,
  mac: Laptop,
  mobile: Smartphone,
  linux: Terminal,
};

type Download = { kind: 'idle' } | { kind: 'busy' } | { kind: 'failed'; message: string } | { kind: 'done' };

async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') return body.error;
  } catch {
    // not JSON: the generic sentence applies
  }
  return null;
}

export function ActiveConsole({ reason, startsAt, expiresAt, serverNow, filesIssued, maxFiles }: ActiveConsoleProps) {
  const router = useRouter();
  const remainingMs = useCountdown(expiresAt, serverNow);
  const totalMs = Date.parse(expiresAt) - Date.parse(startsAt);
  const left = percentLeft(remainingMs, totalMs);

  const [download, setDownload] = useState<Download>({ kind: 'idle' });
  const [endState, endAction] = useActionState<FormState, FormData>(endRdpGrantAction, null);
  const [endOpen, setEndOpen] = useState(false);
  const endFormRef = useRef<HTMLFormElement>(null);

  async function downloadFile() {
    if (download.kind === 'busy') return;
    setDownload({ kind: 'busy' });
    try {
      const response = await fetch('/api/admin/rdp-access/file', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        setDownload({ kind: 'failed', message: downloadFailureText(await errorCodeOf(response), maxFiles) });
        router.refresh();
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'kalfa-desktop.rdp';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDownload({ kind: 'done' });
    } catch {
      setDownload({ kind: 'failed', message: downloadFailureText(null, maxFiles) });
    }
    router.refresh();
  }

  const busy = download.kind === 'busy';
  return (
    <div className="flex flex-col gap-8">
      <StatusPoller deadlineIso={expiresAt} />
      <section aria-labelledby="rdp-active-title" className="flex flex-col gap-6 rounded-2xl bg-console p-5 text-console-foreground sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="rdp-active-title" className="flex items-center gap-2.5 text-base font-bold">
            <span aria-hidden className="size-2.5 rounded-full bg-console-live ring-4 ring-console-live/30" />
            {ACTIVE_COPY.title}
          </h2>
          <span className="text-sm text-console-muted">{ACTIVE_COPY.approvedBy}</span>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3.5">
            <span
              dir="ltr"
              role="timer"
              aria-label={`נותרו ${spokenRemaining(remainingMs)}`}
              className="font-mono text-5xl leading-[52px] font-semibold tracking-tight tabular-nums sm:text-6xl sm:leading-[68px]"
            >
              {formatCountdown(remainingMs, { hours: true })}
            </span>
            <span className="text-[15px] text-console-muted">{ACTIVE_COPY.remaining}</span>
          </div>
          <div role="img" aria-label={`נותרו ${left} אחוזים מהזמן שאושר`} className="h-2 overflow-hidden rounded-full bg-console-raised">
            <div className="h-full rounded-full bg-console-accent transition-[width] duration-1000 ease-linear" style={{ width: `${left}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
          <Stat icon={<Clock className="size-4" aria-hidden />} label={ACTIVE_COPY.validUntil}>
            <span dir="ltr" className="font-mono text-xl leading-7 font-semibold">
              {formatIsraelTime(expiresAt)}
            </span>
          </Stat>
          <Stat icon={<Download className="size-4" aria-hidden />} label={ACTIVE_COPY.downloads}>
            <span className="text-xl leading-7 font-bold">{`${filesIssued} מתוך ${maxFiles}`}</span>
          </Stat>
          <Stat icon={<ClipboardList className="size-4" aria-hidden />} label={ACTIVE_COPY.purpose}>
            <span className="text-base leading-7 font-semibold [overflow-wrap:anywhere]">{reason}</span>
          </Stat>
        </dl>

        <div className="flex flex-wrap items-center gap-3.5">
          <button
            type="button"
            onClick={() => void downloadFile()}
            disabled={busy}
            aria-busy={busy}
            className="inline-flex h-14 items-center justify-center gap-2.5 rounded-[14px] bg-console-accent px-7 text-[17px] font-bold text-console-accent-foreground transition-opacity outline-none focus-visible:ring-4 focus-visible:ring-console-accent/50 disabled:opacity-60"
          >
            <Download className="size-5" aria-hidden />
            {busy ? ACTIVE_COPY.downloading : ACTIVE_COPY.download}
          </button>

          <form ref={endFormRef} action={endAction}>
            <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 gap-2 rounded-[14px] border-console-line bg-transparent px-5 text-[15px] font-semibold text-console-foreground hover:bg-console-raised hover:text-console-foreground dark:border-console-line dark:bg-transparent dark:hover:bg-console-raised"
                  />
                }
              >
                <Power className="size-4" aria-hidden />
                {ACTIVE_COPY.end}
              </AlertDialogTrigger>
              <AlertDialogContent className="gap-5 rounded-3xl bg-console p-6 text-console-foreground ring-console-line/40 data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
                <div className="flex flex-col gap-2">
                  <AlertDialogTitle className="text-2xl leading-8 font-extrabold">{ACTIVE_COPY.endDialog.title}</AlertDialogTitle>
                  <AlertDialogDescription className="text-[15px] leading-6 text-console-muted">{ACTIVE_COPY.endDialog.body}</AlertDialogDescription>
                </div>
                <div className="flex flex-col gap-2.5">
                  <AlertDialogCancel
                    variant="default"
                    className="h-[52px] w-full gap-2.5 rounded-[14px] border-transparent bg-console-accent text-base font-bold text-console-accent-foreground hover:bg-console-accent/90"
                  >
                    {ACTIVE_COPY.endDialog.keep}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="outline"
                    className="h-12 w-full gap-2 rounded-[14px] border-console-danger/60 bg-transparent text-[15px] font-semibold text-console-danger hover:bg-console-danger/10 hover:text-console-danger"
                    onClick={() => {
                      setEndOpen(false);
                      endFormRef.current?.requestSubmit();
                    }}
                  >
                    <Power className="size-4" aria-hidden />
                    {ACTIVE_COPY.endDialog.confirm}
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </form>

          <span className="inline-flex items-center gap-2 text-sm text-console-muted">
            <Clock className="size-4" aria-hidden />
            {ACTIVE_COPY.fileValidity}
          </span>
        </div>

        {download.kind === 'failed' ? (
          <p role="alert" className="rounded-xl bg-console-raised px-3.5 py-3 text-sm leading-6 text-console-danger">
            {download.message}
          </p>
        ) : null}
        {download.kind === 'done' ? (
          <p role="status" className="rounded-xl bg-console-raised px-3.5 py-3 text-sm leading-6 text-console-muted">
            {ACTIVE_COPY.fileReady}
          </p>
        ) : null}
        <FormError message={endState?.error} />
        <FormNotice message={endState?.notice} />

        <p className="flex items-start gap-2.5 rounded-xl bg-console-warning px-3.5 py-3 text-sm leading-[22px] text-console-warning-foreground">
          <TriangleAlert className="mt-0.5 size-[18px] shrink-0" aria-hidden />
          <span>
            <b>{ACTIVE_COPY.shared}</b> {ACTIVE_COPY.sharedBody}
          </span>
        </p>
      </section>

      <section aria-labelledby="rdp-device-title" className="flex flex-col gap-4">
        <h2 id="rdp-device-title" className="text-lg font-bold">
          {ACTIVE_COPY.deviceTitle}
        </h2>
        <Tabs defaultValue={DEVICES[0]!.id}>
          <TabsList className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2 rounded-2xl border-0 bg-muted p-1.5">
            {DEVICES.map((device) => {
              const Icon = DEVICE_ICON[device.id];
              return (
                <TabsTab key={device.id} value={device.id} className="h-12 justify-center gap-2 rounded-xl px-3.5 text-sm">
                  <Icon className="size-5" aria-hidden />
                  {device.label}
                </TabsTab>
              );
            })}
          </TabsList>
          {DEVICES.map((device) => (
            <TabsPanel key={device.id} value={device.id}>
              <ol className="m-0 flex list-none flex-col gap-3.5 rounded-2xl border border-border bg-muted/30 px-5 py-5 sm:px-6">
                {device.steps.map((step, index) => (
                  <li key={step} className="flex items-center gap-3.5 text-[15px] leading-6">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </TabsPanel>
          ))}
        </Tabs>
      </section>
    </div>
  );
}

function Stat({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] bg-console-raised px-4 py-3.5">
      <dt className="flex items-center gap-2 text-[13px] leading-5 text-console-muted">
        {icon}
        {label}
      </dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}
