'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError, FormError, FormNotice } from '@/components/forms';
import type { FleetRequestEntry } from '@/lib/data/admin/fleet';
import { answerFleetRequestAction } from './actions';

// Local verdict submit: like the shared SubmitButton but carries the verdict
// as the button's name/value pair (one form, several verdicts) and supports
// the destructive tone for "deny". Base UI Buttons default to type="button",
// so type="submit" is explicit.
function VerdictButton({
  verdict,
  variant = 'default',
  children,
}: {
  verdict: 'approved' | 'denied' | 'answered';
  variant?: 'default' | 'destructive';
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="verdict" value={verdict} disabled={pending} variant={variant}>
      {pending ? 'רגע…' : children}
    </Button>
  );
}

// Answer card for a single pending fleet request. The verdict is carried by
// the pressed submit button (name="verdict"): approval requests offer
// approve/deny, questions require a textual answer, FYIs just get acknowledged.

const KIND_LABEL: Record<string, string> = {
  approval: 'בקשת אישור',
  question: 'שאלה',
  fyi: 'עדכון',
};

const TIER_LABEL: Record<number, string> = {
  0: 'דרגה 0 — דיווח',
  1: 'דרגה 1 — קוד/בטא',
  2: 'דרגה 2 — רגיש',
};

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function formatDateTimeLabel(iso: string, formatted: string) {
  return <time dateTime={iso}>{formatted}</time>;
}

export function PendingRequestCard({
  request,
  createdAtLabel,
  expiresAtLabel,
}: {
  request: FleetRequestEntry;
  createdAtLabel: string;
  expiresAtLabel: string;
}) {
  const [state, action] = useActionState(answerFleetRequestAction, null);
  const preparedCommand =
    request.payload &&
    typeof request.payload === 'object' &&
    !Array.isArray(request.payload) &&
    typeof (request.payload as { prepared_command?: unknown }).prepared_command === 'string'
      ? ((request.payload as { prepared_command: string }).prepared_command)
      : null;

  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={request.kind === 'approval' ? 'warning' : 'secondary'}>
          {KIND_LABEL[request.kind] ?? request.kind}
        </Badge>
        <Badge variant={request.tier === 2 ? 'destructive' : 'outline'}>
          {TIER_LABEL[request.tier] ?? `דרגה ${request.tier}`}
        </Badge>
        <Badge variant="outline">{request.role}</Badge>
        <span className="ms-auto text-xs text-muted-foreground">
          {formatDateTimeLabel(request.created_at, createdAtLabel)}
        </span>
      </header>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">
          <Link href={`/admin/fleet/${request.id}`} className="hover:underline">
            {request.title}
          </Link>
        </h2>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request.body}</p>
        {preparedCommand ? (
          <pre
            dir="ltr"
            className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
          >
            <code>{preparedCommand}</code>
          </pre>
        ) : null}
        <p className="text-xs text-muted-foreground">בתוקף עד {expiresAtLabel}</p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={request.id} />
        <div>
          <label htmlFor={`answer-${request.id}`} className="mb-1 block text-sm font-medium">
            {request.kind === 'question' ? 'תשובה (חובה)' : 'הערה (אופציונלי)'}
          </label>
          <textarea
            id={`answer-${request.id}`}
            name="answer"
            rows={3}
            required={request.kind === 'question'}
            className={inputClass}
            placeholder={
              request.kind === 'question' ? 'כתוב את התשובה לסוכן…' : 'הנחיה נוספת לסוכן…'
            }
          />
          <FieldError errors={state?.fieldErrors?.answer} />
        </div>

        <div className="flex flex-wrap gap-2">
          {request.kind === 'approval' ? (
            <>
              <VerdictButton verdict="approved">אשר</VerdictButton>
              <VerdictButton verdict="denied" variant="destructive">
                דחה
              </VerdictButton>
            </>
          ) : (
            <VerdictButton verdict="answered">
              {request.kind === 'question' ? 'שלח תשובה' : 'אשר קריאה'}
            </VerdictButton>
          )}
        </div>
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </form>
    </article>
  );
}
