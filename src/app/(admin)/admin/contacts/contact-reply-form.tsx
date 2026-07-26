'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import { sendInquiryReplyAction } from './actions';

// Inline reply composer for a contact message — same useActionState + native
// pattern as ContactStatusForm (no portal/RTL pitfalls). When a support-drafter
// draft exists (and the inquiry isn't answered yet) it pre-fills the textarea,
// so the admin reviews/edits the AI draft and sends it. Rendered only when the
// inquiry has an email address (phone-only submissions can't be emailed).
export function ContactReplyForm({
  id,
  defaultReply,
  alreadyReplied,
}: {
  id: string;
  defaultReply?: string | null;
  alreadyReplied: boolean;
}) {
  const [state, formAction, pending] = useActionState(sendInquiryReplyAction, null);
  const textareaId = `reply-${id}`;

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={textareaId} className="text-xs font-semibold text-muted-foreground">
        {alreadyReplied ? 'שליחת מענה נוסף במייל' : 'כתיבת מענה ושליחה במייל ללקוח'}
      </label>
      <textarea
        id={textareaId}
        name="reply"
        rows={4}
        maxLength={4000}
        defaultValue={defaultReply ?? ''}
        placeholder="המענה יישלח ללקוח בדוא״ל…"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'שולח…' : 'שליחת מענה'}
        </button>
      </div>
      <FieldError errors={state?.fieldErrors?.reply} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
