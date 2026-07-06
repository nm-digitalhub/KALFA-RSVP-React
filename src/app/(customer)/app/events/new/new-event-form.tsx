'use client';

import { useActionState, useState } from 'react';

import { createEventAction } from '../actions';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import { CELEBRANT_FIELD_LABELS, EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import { FieldError, FormError, SubmitButton } from '@/components/forms';
import { TimeSelect24 } from '@/components/time-select-24';
import { DateSelectIL } from '@/components/date-select-il';

type EventType = (typeof EVENT_TYPES)[number];

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ms-0.5 text-red-500">
      *
    </span>
  );
}

// Celebrant (בעלי שמחה) inputs for the selected event type: plain named
// inputs (celebrants.groom, celebrants.bride, ...) that the server action
// reads per the submitted event_type's kind. Uncontrolled — the parent
// remounts the group via key={eventType} whenever the type changes, so no
// stale value from another kind ever lingers. Every field is optional here
// (no RequiredMark): completeness is enforced only at campaign enablement.
function CelebrantFields({
  eventType,
  errors,
}: {
  eventType: EventType;
  errors?: Record<string, string[] | undefined>;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium">בעלי השמחה</legend>
      <p className="text-xs text-muted-foreground">
        יש למלא לפני הפעלת אישורי הגעה
      </p>
      {Object.entries(CELEBRANT_FIELD_LABELS[eventType]).map(([field, label]) => (
        <div key={field}>
          <label
            htmlFor={`celebrants.${field}`}
            className="mb-1 block text-sm font-medium"
          >
            {label}
          </label>
          <input
            id={`celebrants.${field}`}
            name={`celebrants.${field}`}
            type="text"
            className={inputClass}
          />
          <FieldError errors={errors?.[`celebrants.${field}`]} />
        </div>
      ))}
    </fieldset>
  );
}

export function NewEventForm() {
  const [state, action] = useActionState(createEventAction, null);

  // Controlled so the celebrant field group below follows the selected type.
  const [eventType, setEventType] = useState<EventType>('wedding');

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
          value={eventType}
          // The options are rendered from EVENT_TYPES, so the emitted value
          // is always a valid EventType.
          onChange={(e) => setEventType(e.target.value as EventType)}
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <FieldError errors={state?.fieldErrors?.event_type} />
      </div>

      {/* key={eventType}: remount the uncontrolled group on type change. */}
      <CelebrantFields
        key={eventType}
        eventType={eventType}
        errors={state?.fieldErrors}
      />

      <div>
        <label htmlFor="event_date" className="mb-1 block text-sm font-medium">
          תאריך האירוע
          <RequiredMark />
        </label>
        <DateSelectIL id="event_date" name="event_date" required />
        <p className="mt-1 text-xs text-muted-foreground">יום / חודש / שנה</p>
        <FieldError errors={state?.fieldErrors?.event_date} />
      </div>

      <div>
        <label htmlFor="event_time" className="mb-1 block text-sm font-medium">
          שעת האירוע
        </label>
        <TimeSelect24 id="event_time" name="event_time" />
        <p className="mt-1 text-xs text-muted-foreground">
          רשות — תופיע בהזמנות ובתזכורות (שעון ישראל)
        </p>
        <FieldError errors={state?.fieldErrors?.event_time} />
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
