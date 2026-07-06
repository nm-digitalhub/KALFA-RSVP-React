'use client';

import { useActionState, useState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { RSVP_STATUSES, type RsvpStatus } from '@/lib/constants';
import { ISRAEL_LOCALE, ISRAEL_TIME_ZONE } from '@/lib/date';
import type { RsvpView } from '@/lib/data/rsvp';

import { submitRsvpAction } from './actions';

const STATUS_LABELS: Record<RsvpStatus, string> = {
  attending: 'מגיע/ה',
  maybe: 'אולי',
  declined: 'לא מגיע/ה',
};

// Absolute fallback cap when the guest has no invited count (expected_count
// NULL) — mirrors COUNT_MAX in the Zod schema so the UI never offers a value
// the server would reject.
const COUNT_FALLBACK_CAP = 50;

function formatEventDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // timeZone pinned to Israel: this is a PUBLIC page — a guest opening the
  // link abroad (or a server/browser TZ mismatch during hydration) must still
  // see the event's Israel date, not their device's local calendar day.
  return new Intl.DateTimeFormat(ISRAEL_LOCALE, {
    timeZone: ISRAEL_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function Stepper({
  label,
  name,
  value,
  max,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div>
      <span id={`${name}-label`} className="mb-1 block text-sm font-medium">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${name}-label`}
        className="flex items-center justify-between rounded-md border border-input bg-background px-2 py-1"
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`הפחתת ${label}`}
          className="h-9 w-9 rounded-md text-lg leading-none hover:bg-muted disabled:opacity-40"
          disabled={value <= 0}
        >
          −
        </button>
        <span aria-live="polite" className="min-w-8 text-center text-base font-semibold">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`הוספת ${label}`}
          className="h-9 w-9 rounded-md text-lg leading-none hover:bg-muted disabled:opacity-40"
          disabled={value >= max}
        >
          +
        </button>
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

export function RsvpForm({ token, view }: { token: string; view: RsvpView }) {
  const { guest, event, questions, can_respond: canRespond } = view;

  const [state, formAction] = useActionState(
    submitRsvpAction.bind(null, token),
    null,
  );

  const initialStatus = (RSVP_STATUSES as readonly string[]).includes(guest.status)
    ? (guest.status as RsvpStatus)
    : null;
  const [status, setStatus] = useState<RsvpStatus | null>(initialStatus);
  const [adults, setAdults] = useState<number>(
    guest.confirmed_adults && guest.confirmed_adults > 0 ? guest.confirmed_adults : 1,
  );
  const [kids, setKids] = useState<number>(guest.confirmed_kids ?? 0);

  const eventDate = formatEventDate(event.event_date);
  const attending = status === 'attending';
  // Combined ceiling: adults + kids must not exceed expected_count (or the
  // sanity cap when uninvited-count). Per-field caps leave the remainder.
  const hardCap = guest.expected_count ?? COUNT_FALLBACK_CAP;

  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <p className="text-sm text-muted-foreground">שלום {guest.full_name},</p>
        <h1 className="text-2xl font-bold">{event.name}</h1>
        {eventDate ? <p className="text-muted-foreground">{eventDate}</p> : null}
        {event.venue_name ? (
          <p className="text-sm text-muted-foreground">
            {event.venue_name}
            {event.venue_address ? `, ${event.venue_address}` : ''}
          </p>
        ) : null}
      </header>

      {!canRespond ? (
        <p
          role="status"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          המועד לאישור הגעה חלף. לפרטים נא לפנות למארגן/ת האירוע.
        </p>
      ) : (
        <form action={formAction} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">האם תגיעו?</legend>
            <div className="grid grid-cols-3 gap-2">
              {RSVP_STATUSES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setStatus(option)}
                  aria-pressed={status === option}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    status === option
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-muted'
                  }`}
                >
                  {STATUS_LABELS[option]}
                </button>
              ))}
            </div>
            <input type="hidden" name="status" value={status ?? ''} />
            <FieldError errors={state?.fieldErrors?.status} />
          </fieldset>

          {attending ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Stepper
                  label="מבוגרים"
                  name="adults"
                  value={adults}
                  max={hardCap - kids}
                  onChange={setAdults}
                />
                <Stepper
                  label="ילדים"
                  name="kids"
                  value={kids}
                  max={hardCap - adults}
                  onChange={setKids}
                />
              </div>
              <FieldError errors={state?.fieldErrors?.adults} />

              <div>
                <label htmlFor="meal_pref" className="mb-1 block text-sm font-medium">
                  העדפת תפריט (לא חובה)
                </label>
                <input
                  id="meal_pref"
                  name="meal_pref"
                  type="text"
                  maxLength={120}
                  defaultValue={guest.meal_pref ?? ''}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                />
                <FieldError errors={state?.fieldErrors?.meal_pref} />
              </div>
            </div>
          ) : null}

          {questions.length > 0 ? (
            <div className="space-y-4">
              {questions.map((question) => {
                const options = Array.isArray(question.options)
                  ? question.options.map((opt) => String(opt))
                  : null;
                const prior = guest.answers[question.q_key] ?? '';
                const fieldId = `answer_${question.q_key}`;
                return (
                  <div key={question.q_key}>
                    <label htmlFor={fieldId} className="mb-1 block text-sm font-medium">
                      {question.label}
                      {question.required ? <span className="text-red-600"> *</span> : null}
                    </label>
                    {options && options.length > 0 ? (
                      <select
                        id={fieldId}
                        name={fieldId}
                        defaultValue={prior}
                        required={question.required}
                        className="w-full rounded-md border border-input bg-background px-3 py-2"
                      >
                        <option value="">בחר/י…</option>
                        {options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={fieldId}
                        name={fieldId}
                        type="text"
                        maxLength={500}
                        defaultValue={prior}
                        required={question.required}
                        className="w-full rounded-md border border-input bg-background px-3 py-2"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div>
            <label htmlFor="note" className="mb-1 block text-sm font-medium">
              הערה (לא חובה)
            </label>
            <textarea
              id="note"
              name="note"
              rows={3}
              maxLength={500}
              defaultValue={guest.note ?? ''}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
            <FieldError errors={state?.fieldErrors?.note} />
          </div>

          <FormError message={state?.error} />
          <FormNotice message={state?.notice} />
          <SubmitButton>שליחת אישור</SubmitButton>
        </form>
      )}
    </div>
  );
}
