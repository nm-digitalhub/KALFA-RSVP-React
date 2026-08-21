'use client';

import { useActionState, useState } from 'react';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { FormState } from '@/lib/validation/result';
import { resolveCancellationRequestAction } from '../actions';

type Resolution = 'full_cancellation' | 'partial_charge' | 'declined';
// Same three-way split resolveCancellationRequest itself computes: 'capture'
// (pre-charge, real SUMIT charge), 'credit' (post-charge + card on file, real
// SUMIT credit), 'manual' (post-charge, no card on file — nothing automatic).
type MoneyOutcome = 'capture' | 'credit' | 'manual';

const CONFIRM_TEXT: Record<Resolution, (outcome: MoneyOutcome) => string> = {
  full_cancellation: (outcome) =>
    outcome === 'capture'
      ? 'לאשר ביטול מלא? לא יבוצע חיוב על הכרטיס.'
      : outcome === 'credit'
        ? 'לאשר ביטול מלא? יבוצע זיכוי אוטומטי מלא לכרטיס.'
        : 'לאשר ביטול מלא? אין פרטי כרטיס שמורים — לא יבוצע זיכוי אוטומטי, יש להחזיר ידנית ב-SUMIT.',
  partial_charge: (outcome) =>
    outcome === 'capture'
      ? 'לאשר חיוב חלקי? יבוצע חיוב אמיתי בסכום שהוזן.'
      : outcome === 'credit'
        ? 'לאשר חיוב חלקי? יבוצע זיכוי אוטומטי של ההפרש לכרטיס.'
        : 'לאשר חיוב חלקי? אין פרטי כרטיס שמורים — לא יבוצע זיכוי אוטומטי, יש להחזיר ידנית ב-SUMIT.',
  declined: () => 'לדחות את בקשת הביטול?',
};

export function ResolveForm({
  requestId,
  suggestedAmount,
  moneyOutcome,
}: {
  requestId: string;
  suggestedAmount: number;
  moneyOutcome: MoneyOutcome;
}) {
  const action = resolveCancellationRequestAction.bind(null, requestId);
  const [state, formAction] = useActionState<FormState, FormData>(action, null);
  const [resolution, setResolution] = useState<Resolution>('full_cancellation');

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        if (!window.confirm(CONFIRM_TEXT[resolution](moneyOutcome))) {
          e.preventDefault();
        }
      }}
    >
      <RadioGroup
        name="resolution"
        value={resolution}
        onValueChange={(v) => setResolution(v as Resolution)}
        className="space-y-2"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="full_cancellation" />
          ביטול מלא
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="partial_charge" />
          חיוב חלקי
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="declined" />
          דחיית הבקשה
        </label>
      </RadioGroup>

      {resolution === 'partial_charge' ? (
        <div>
          <label htmlFor="resolutionAmount" className="mb-1 block text-sm font-medium">
            סכום לחיוב (₪) — מוצע לפי מדיניות דמי הביטול, ניתן לעריכה
          </label>
          <input
            id="resolutionAmount"
            name="resolutionAmount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={suggestedAmount.toFixed(2)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <FieldError errors={state?.fieldErrors?.resolutionAmount} />
        </div>
      ) : null}

      <div>
        <label htmlFor="resolutionNote" className="mb-1 block text-sm font-medium">
          הודעה ללקוח
        </label>
        <textarea
          id="resolutionNote"
          name="resolutionNote"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <FieldError errors={state?.fieldErrors?.resolutionNote} />
      </div>

      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        אישור הטיפול בבקשה
      </button>

      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
