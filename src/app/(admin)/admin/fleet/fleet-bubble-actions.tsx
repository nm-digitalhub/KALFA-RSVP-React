'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Copy, MessageSquareReply, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/forms';
import { answerFleetRequestAction } from './actions';
import { useComposer } from './fleet-composer';

// The client islands of a (server-rendered) bubble: verdict buttons on an
// agent's open request, and the buttons that switch the composer into
// "reply" / "continue". Actions appear ONLY on an agent bubble that is still
// pending — never on a message the owner sent (plan D4; B1).

function VerdictButton({
  verdict,
  variant = 'default',
  label,
  children,
}: {
  verdict: 'approved' | 'denied' | 'answered';
  variant?: 'default' | 'destructive' | 'outline';
  label: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="verdict"
      value={verdict}
      variant={variant}
      disabled={pending}
      aria-label={label}
      className="min-h-11 md:min-h-9"
    >
      {children}
    </Button>
  );
}

export function PendingRequestActions({
  id,
  kind,
  title,
  titleId,
}: {
  id: string;
  kind: string;
  title: string;
  /** id of the bubble's title element, for aria-describedby. */
  titleId: string;
}) {
  const [state, action] = useActionState(answerFleetRequestAction, null);
  const { start, busy } = useComposer();

  const replyButton = (label: string) => (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={() => start({ type: 'reply', id, title, kind })}
      aria-label={`${label}: ${title}`}
      className="min-h-11 md:min-h-9"
    >
      <MessageSquareReply aria-hidden />
      {label}
    </Button>
  );

  return (
    <form action={action} className="space-y-2 border-t border-border pt-3" aria-describedby={titleId}>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'approval' ? (
          <>
            <VerdictButton verdict="approved" label={`אשר: ${title}`}>
              <Check aria-hidden />
              אשר
            </VerdictButton>
            {/* Space between the two, and no confirm dialog (owner Q2 is
                open; the always-visible prepared command is the safeguard). */}
            <span className="w-2" aria-hidden />
            <VerdictButton verdict="denied" variant="destructive" label={`דחה: ${title}`}>
              <X aria-hidden />
              דחה
            </VerdictButton>
            {replyButton('הוסף הערה')}
          </>
        ) : kind === 'fyi' ? (
          <>
            {/* A verdict like any other: the answer-watcher may wake the
                agent on it (plan D4, R12) — same as before the redesign. */}
            <VerdictButton verdict="answered" variant="outline" label={`אשר קריאה: ${title}`}>
              <Check aria-hidden />
              אשר קריאה
            </VerdictButton>
            {replyButton('השב')}
          </>
        ) : (
          replyButton('השב')
        )}
      </div>
      <FormError message={state?.error} />
    </form>
  );
}

// "השב" on a CLOSED message (agent or owner) → the composer's "continue"
// mode: a new message threaded on this one, so the agent gets the thread
// root as context. Only the id travels; the server derives the rest.
export function ContinueButton({ id, title }: { id: string; title: string }) {
  const { start, busy } = useComposer();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => start({ type: 'continue', id, title })}
      aria-label={`השב על: ${title}`}
      className="inline-flex min-h-6 items-center gap-1 rounded-sm px-1 font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      <MessageSquareReply className="size-3.5" aria-hidden />
      השב
    </button>
  );
}

export function CopyCommandButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? 'הועתק' : 'העתקת הפקודה'}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}
