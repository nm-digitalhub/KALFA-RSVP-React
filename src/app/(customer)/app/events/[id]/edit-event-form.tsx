'use client';

import { useActionState, useState } from 'react';

import { updateEventAction } from './actions';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import type { EventDetail } from '@/lib/data/events';
import { todayIL } from '@/lib/data/event-date';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60';

// event_date is a timestamptz in the DB, so the value arrives as a full ISO
// string; a <input type="date"> needs YYYY-MM-DD. Slice the date portion for
// both date fields (rsvp_deadline is already a date, so the slice is a no-op).
function dateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function EditEventForm({ event }: { event: EventDetail }) {
  const action = updateEventAction.bind(null, event.id);
  const [state, formAction] = useActionState(action, null);

  // R5: date fields are editable only while draft. Status itself is no longer
  // editable here at all (R6) — Publish/Close (EventStatusActions) are the only
  // legitimate transitions; a free dropdown would let the owner "choose" a
  // status the server silently ignores (updateEvent no longer accepts it).
  const isDraft = event.status === 'draft';

  // Keep the two date fields coupled so the picker itself prevents the illogical
  // case (deadline after the event). The server (Zod refine + DB triggers) stays
  // authoritative; this is UX only.
  const [eventDate, setEventDate] = useState(dateInputValue(event.event_date));
  const [rsvpDeadline, setRsvpDeadline] = useState(
    dateInputValue(event.rsvp_deadline),
  );

  // R2: event_date >= tomorrow. R2b: rsvp_deadline >= today. Both combined with
  // the existing mutual coupling (deadline <= event date). Computed once via a
  // lazy useState initializer (Date.now() is impure — calling it directly
  // during render is disallowed; the lazy initializer runs once at mount).
  const [tomorrowIL] = useState(() => todayIL(Date.now() + 24 * 60 * 60 * 1000));
  const [todayILValue] = useState(() => todayIL());
  const eventDateMin =
    rsvpDeadline && rsvpDeadline > tomorrowIL ? rsvpDeadline : tomorrowIL;

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          שם האירוע
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={event.name}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div>
        <label htmlFor="event_type" className="mb-1 block text-sm font-medium">
          סוג אירוע
        </label>
        <select
          id="event_type"
          name="event_type"
          required
          defaultValue={event.event_type}
          className={inputClass}
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
        </label>
        <input
          id="event_date"
          name={isDraft ? 'event_date' : undefined}
          type="date"
          value={eventDate}
          min={isDraft ? eventDateMin : undefined}
          disabled={!isDraft}
          onChange={(e) => setEventDate(e.target.value)}
          className={inputClass}
        />
        {!isDraft ? (
          <p className="mt-1 text-xs text-muted-foreground">נעול לאחר פרסום</p>
        ) : null}
        <FieldError errors={state?.fieldErrors?.event_date} />
      </div>

      <div>
        <label htmlFor="rsvp_deadline" className="mb-1 block text-sm font-medium">
          מועד אחרון לאישור הגעה
        </label>
        <input
          id="rsvp_deadline"
          name={isDraft ? 'rsvp_deadline' : undefined}
          type="date"
          value={rsvpDeadline}
          min={isDraft ? todayILValue : undefined}
          max={isDraft ? eventDate || undefined : undefined}
          disabled={!isDraft}
          onChange={(e) => setRsvpDeadline(e.target.value)}
          className={inputClass}
        />
        {!isDraft ? (
          <p className="mt-1 text-xs text-muted-foreground">נעול לאחר פרסום</p>
        ) : null}
        <FieldError errors={state?.fieldErrors?.rsvp_deadline} />
      </div>

      <div>
        <label htmlFor="venue_name" className="mb-1 block text-sm font-medium">
          מיקום
        </label>
        <input
          id="venue_name"
          name="venue_name"
          type="text"
          defaultValue={event.venue_name ?? ''}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.venue_name} />
      </div>

      <div>
        <label htmlFor="venue_address" className="mb-1 block text-sm font-medium">
          כתובת המקום
        </label>
        <input
          id="venue_address"
          name="venue_address"
          type="text"
          defaultValue={event.venue_address ?? ''}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.venue_address} />
      </div>

      <SubmitButton>שמירת שינויים</SubmitButton>
    </form>
  );
}
