'use client';

import { useActionState, useState } from 'react';

import { updateEventAction } from './actions';
import { EVENT_TYPES, EVENT_STATUSES } from '@/lib/validation/schemas';
import type { EventDetail } from '@/lib/data/events';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';

const EVENT_TYPE_LABELS: Record<(typeof EVENT_TYPES)[number], string> = {
  wedding: 'חתונה',
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  brit: 'ברית',
  britah: 'בריתה',
  henna: 'חינה',
  engagement: 'אירוסין',
  birthday: 'יום הולדת',
  other: 'אחר',
};

const EVENT_STATUS_LABELS: Record<(typeof EVENT_STATUSES)[number], string> = {
  draft: 'טיוטה',
  active: 'פעיל',
  closed: 'סגור',
};

// event_date is a timestamptz in the DB, so the value arrives as a full ISO
// string; a <input type="date"> needs YYYY-MM-DD. Slice the date portion for
// both date fields (rsvp_deadline is already a date, so the slice is a no-op).
function dateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function EditEventForm({ event }: { event: EventDetail }) {
  const action = updateEventAction.bind(null, event.id);
  const [state, formAction] = useActionState(action, null);

  // Keep the two date fields coupled so the picker itself prevents the illogical
  // case (deadline after the event). The server (Zod refine + DB CHECK
  // events_rsvp_deadline_within_event) stays authoritative; this is UX only.
  const [eventDate, setEventDate] = useState(dateInputValue(event.event_date));
  const [rsvpDeadline, setRsvpDeadline] = useState(
    dateInputValue(event.rsvp_deadline),
  );

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
        <label htmlFor="status" className="mb-1 block text-sm font-medium">
          סטטוס
        </label>
        <select
          id="status"
          name="status"
          required
          defaultValue={event.status}
          className={inputClass}
        >
          {EVENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {EVENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <FieldError errors={state?.fieldErrors?.status} />
      </div>

      <div>
        <label htmlFor="event_date" className="mb-1 block text-sm font-medium">
          תאריך האירוע
        </label>
        <input
          id="event_date"
          name="event_date"
          type="date"
          value={eventDate}
          min={rsvpDeadline || undefined}
          onChange={(e) => setEventDate(e.target.value)}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.event_date} />
      </div>

      <div>
        <label htmlFor="rsvp_deadline" className="mb-1 block text-sm font-medium">
          מועד אחרון לאישור הגעה
        </label>
        <input
          id="rsvp_deadline"
          name="rsvp_deadline"
          type="date"
          value={rsvpDeadline}
          max={eventDate || undefined}
          onChange={(e) => setRsvpDeadline(e.target.value)}
          className={inputClass}
        />
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
