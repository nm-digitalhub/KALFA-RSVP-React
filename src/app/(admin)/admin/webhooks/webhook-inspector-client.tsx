'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { JsonView, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { Check, Copy, Eye, EyeOff, RotateCw, TriangleAlert } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { reprocessWebhookEventAction } from './actions';

// Detail drawer for the webhook inspector. Open state is driven by the URL
// (?inspect=<id>): the page renders this only when inspect is present, so it
// mounts open; dismissing (Esc / backdrop / close button) replaces the URL back
// to the filtered list, which unmounts it. The detail body is server-rendered and
// passed as children — no PII fetching in the browser.
export function InspectorDrawer({
  closeHref,
  title,
  children,
}: {
  closeHref: string;
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.replace(closeHref);
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 p-4 pt-0 text-sm">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

// Copy a technical value to the clipboard (zero-dep). Mirrors channels-client's
// CopyRow. Shows a brief check on success.
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label ?? 'העתקה'}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
      className="inline-flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

// Mask a recipient phone (PII) to its last 4 digits until explicitly revealed.
export function PhoneReveal({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  const masked = `••• ${value.slice(-4)}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span dir="ltr">{shown ? value : masked}</span>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="inline-flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
        aria-label={shown ? 'הסתרה' : 'הצגה'}
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </span>
  );
}

// Raw payload (PII) — collapsed behind an explicit reveal, with copy. Never
// rendered until the admin opts in.
export function PayloadViewer({ json }: { json: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {shown ? 'הסתרה' : 'הצגת payload (PII)'}
        </button>
        {shown ? <CopyButton value={json} label="העתקת payload" /> : null}
      </div>
      {shown ? (
        <pre
          dir="ltr"
          className="max-h-80 overflow-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          {json}
        </pre>
      ) : null}
    </div>
  );
}

// Collapsible JSON tree (react-json-view-lite) behind an explicit reveal, with
// copy. Used for both the normalized event and the verbatim Meta envelope —
// both are PII, so neither renders until the admin opts in. LTR: JSON keys and
// ids read left-to-right regardless of the page direction.
export function JsonTree({
  data,
  revealLabel,
  copyLabel,
}: {
  data: unknown;
  revealLabel: string;
  copyLabel: string;
}) {
  const [shown, setShown] = useState(false);
  const json = JSON.stringify(data, null, 2);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {shown ? 'הסתרה' : revealLabel}
        </button>
        {shown ? <CopyButton value={json} label={copyLabel} /> : null}
      </div>
      {shown ? (
        <div
          dir="ltr"
          className="max-h-96 overflow-auto rounded-md bg-muted px-3 py-2 text-xs"
        >
          <JsonView
            data={data as object}
            style={defaultStyles}
            shouldExpandNode={(level) => level < 3}
            clickToExpandNode
          />
        </div>
      ) : null}
    </div>
  );
}

// Re-queue a webhook_inbox row for the worker (admin). An explicit dialog (not
// window.confirm): it names the consequence, and for an inbound guest-list
// message it says what a re-run does — the importer is idempotent by wamid
// (source_message_id) so no duplicate list is created, but the row is
// re-evaluated end to end. The server action resets the row so the next drain
// reclaims it, and logs the admin action.
export function ReprocessButton({
  id,
  isImportMessage,
}: {
  id: string;
  isImportMessage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onConfirm() {
    setFailed(false);
    const formData = new FormData();
    formData.set('id', id);
    startTransition(async () => {
      try {
        await reprocessWebhookEventAction(formData);
        setOpen(false);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          />
        }
      >
        <RotateCw className="size-3.5" />
        עיבוד מחדש
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>לעבד את האירוע מחדש?</AlertDialogTitle>
          <AlertDialogDescription>
            השורה תסומן כלא-מעובדת וה-worker יריץ אותה שוב בדקה הקרובה. חיוב כפול
            נחסם ברמת ה-DB (אינטראקציה אחת לכל הודעה).
            {isImportMessage ? (
              <span className="mt-2 flex items-start gap-1.5 text-warning-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                זו הודעת ייבוא מוזמנים: רשימה שכבר נקלטה מההודעה הזו לא תיווצר שוב
                ולא תישלח תשובה נוספת לבעל האירוע — אבל אם הרשימה נמחקה, היא תיווצר
                מחדש.
              </span>
            ) : null}
            {failed ? (
              <span className="mt-2 block text-destructive">העיבוד מחדש נכשל. נסו שוב.</span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {pending ? 'מעבד…' : 'עיבוד מחדש'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

