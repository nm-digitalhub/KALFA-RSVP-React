'use client';

import { useActionState, useState } from 'react';

import { updateEventAction } from './actions';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import { CELEBRANT_FIELD_LABELS, EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import type { EventDetail } from '@/lib/data/events';
import { todayIL } from '@/lib/data/event-date';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';

type EventType = (typeof EVENT_TYPES)[number];

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60';

// event_date is a timestamptz in the DB, so the value arrives as a full ISO
// string; a <input type="date"> needs YYYY-MM-DD. Slice the date portion for
// both date fields (rsvp_deadline is already a date, so the slice is a no-op).
function dateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

// events.celebrants is schemaless jsonb (Json | null), so narrow defensively:
// prefill only from a plain object's string values — no cast of the stored
// value to a celebrant shape. CelebrantFields renders (and therefore reads)
// only the CURRENTLY selected type's fields, so a stored shape left over from
// a different kind simply yields empty inputs, never a wrong prefill.
function celebrantDefaults(value: EventDetail['celebrants']): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const defaults: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') defaults[key] = entry;
  }
  return defaults;
}

// Celebrant (בעלי שמחה) inputs for the selected event type: plain named
// inputs (celebrants.groom, celebrants.bride, ...) that the server action
// reads per the submitted event_type's kind. Uncontrolled — the parent
// remounts the group via key={eventType} whenever the type changes, so no
// stale value from another kind ever lingers. Every field is optional here:
// completeness is enforced only at campaign enablement.
function CelebrantFields({
  eventType,
  defaults,
  errors,
}: {
  eventType: EventType;
  defaults: Record<string, string>;
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
            defaultValue={defaults[field] ?? ''}
            className={inputClass}
          />
          <FieldError errors={errors?.[`celebrants.${field}`]} />
        </div>
      ))}
    </fieldset>
  );
}

export function EditEventForm({ event }: { event: EventDetail }) {
  const action = updateEventAction.bind(null, event.id);
  const [state, formAction] = useActionState(action, null);

  // R5: date fields are editable only while draft. Status itself is no longer
  // editable here at all (R6) — Publish/Close (EventStatusActions) are the only
  // legitimate transitions; a free dropdown would let the owner "choose" a
  // status the server silently ignores (updateEvent no longer accepts it).
  const isDraft = event.status === 'draft';

  // Controlled so the celebrant field group below follows the selected type.
  const [eventType, setEventType] = useState<EventType>(event.event_type);

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
          value={eventType}
          // The options are rendered from EVENT_TYPES, so the emitted value
          // is always a valid EventType.
          onChange={(e) => setEventType(e.target.value as EventType)}
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

      {/* key={eventType}: remount the uncontrolled group on type change, so
          the stored defaults prefill only while the selected kind matches. */}
      <CelebrantFields
        key={eventType}
        eventType={eventType}
        defaults={celebrantDefaults(event.celebrants)}
        errors={state?.fieldErrors}
      />

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
