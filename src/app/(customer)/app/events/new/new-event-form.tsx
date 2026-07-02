'use client';

import { useActionState } from 'react';

import { createEventAction } from '../actions';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import { FieldError, FormError, SubmitButton } from '@/components/forms';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ms-0.5 text-red-500">
      *
    </span>
  );
}

export function NewEventForm() {
  const [state, action] = useActionState(createEventAction, null);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />

      <p className="text-xs text-muted-foreground">
        שדות המסומנים ב-<span className="text-red-500">*</span> הם חובה
      </p>

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          שם האירוע
          <RequiredMark />
        </label>
        <input id="name" name="name" type="text" required className={inputClass} />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div>
        <label htmlFor="event_type" className="mb-1 block text-sm font-medium">
          סוג אירוע
          <RequiredMark />
        </label>
        <select
          id="event_type"
          name="event_type"
          required
          className={inputClass}
          defaultValue="wedding"
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <FieldError errors={state?.fieldErrors?.event_type} />
      </div>

      <div>
        <label htmlFor="event_date" className="mb-1 block text-sm font-medium">
          תאריך האירוע
          <RequiredMark />
        </label>
        <input
          id="event_date"
          name="event_date"
          type="date"
          required
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">בחרו תאריך מהלוח</p>
        <FieldError errors={state?.fieldErrors?.event_date} />
      </div>

      <div>
        <label htmlFor="venue_name" className="mb-1 block text-sm font-medium">
          שם המקום
        </label>
        <input id="venue_name" name="venue_name" type="text" className={inputClass} />
        <FieldError errors={state?.fieldErrors?.venue_name} />
      </div>

      <SubmitButton>יצירת אירוע</SubmitButton>
    </form>
  );
}
