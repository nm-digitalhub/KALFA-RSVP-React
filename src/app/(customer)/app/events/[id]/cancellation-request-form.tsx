'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, FieldError } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import type { OwnCancellationRequest } from '@/lib/data/event-cancellation';

type BoundAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

const RESOLUTION_LABELS: Record<string, string> = {
  full_cancellation: 'הביטול אושר במלואו',
  partial_charge: 'הביטול אושר עם חיוב חלקי',
  declined: 'הבקשה נדחתה',
};

// Renders the open-request status instead of the form when one already
// exists and is not resolved-as-declined — one open request at a time (no DB
// uniqueness constraint enforces this, so the UI is what enforces it).
export function CancellationRequestForm({
  existingRequest,
  action,
}: {
  existingRequest: OwnCancellationRequest | null;
  action: BoundAction;
}) {
  const [state, formAction] = useActionState(action, null);

  if (existingRequest && existingRequest.status === 'pending') {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="font-medium">בקשת ביטול #{existingRequest.requestNumber} — ממתינה לטיפול</p>
        <p className="mt-1 text-muted-foreground">נעדכן אותך במייל ברגע שתטופל.</p>
      </div>
    );
  }

  if (existingRequest && existingRequest.status === 'resolved' && existingRequest.resolution !== 'declined') {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="font-medium">
          בקשת ביטול #{existingRequest.requestNumber} —{' '}
          {RESOLUTION_LABELS[existingRequest.resolution ?? ''] ?? existingRequest.resolution}
        </p>
        {existingRequest.resolutionNote ? (
          <p className="mt-1 text-muted-foreground">{existingRequest.resolutionNote}</p>
        ) : null}
      </div>
    );
  }

  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">בקשת ביטול אירוע</summary>
      <form action={formAction} className="mt-3 space-y-3">
        <div>
          <label htmlFor="cancellation-reason" className="mb-1 block text-sm font-medium">
            סיבת הביטול
          </label>
          <textarea
            id="cancellation-reason"
            name="reason"
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <FieldError errors={state?.fieldErrors?.reason} />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="smsConsent"
            defaultChecked={false}
            className="mt-0.5 size-4 rounded border-input"
          />
          אני מאשר/ת קבלת עדכון SMS לגבי בקשה זו (בנוסף לעדכון במייל, שיישלח בכל מקרה)
        </label>

        <button
          type="submit"
          className="rounded-md border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10"
        >
          שליחת בקשת ביטול
        </button>

        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </form>
    </details>
  );
}
