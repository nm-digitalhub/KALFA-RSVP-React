'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Copy, Eye, EyeOff, RotateCw } from 'lucide-react';

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

function ReprocessSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm('לעבד את האירוע מחדש?')) e.preventDefault();
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
    >
      <RotateCw className="size-3.5" />
      {pending ? 'מעבד…' : 'עיבוד מחדש'}
    </button>
  );
}

// Re-queue a webhook_inbox row for the worker (admin). Confirms first; the server
// action resets the row so the next drain reclaims it.
export function ReprocessButton({ id }: { id: string }) {
  return (
    <form action={reprocessWebhookEventAction}>
      <input type="hidden" name="id" value={id} />
      <ReprocessSubmit />
    </form>
  );
}

