'use client';

import { useActionState, useState } from 'react';

import { FieldError, FormError, SubmitButton } from '@/components/forms';
import Image from 'next/image';
import { Gift, Navigation, PartyPopper } from 'lucide-react';
import {
  EVENT_TYPE_ICON,
  eventHeadingFor,
} from '@/lib/data/celebrant-display';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import {
  GIFT_BRAND,
  asEventType,
  formatEventDateLine,
} from '@/lib/data/event-display';
import { RSVP_STATUSES, type RsvpStatus } from '@/lib/constants';
import type { RsvpAttendee, RsvpView } from '@/lib/data/rsvp';

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

// Guest-page form fields. The page's whole audience is on a phone, so every
// field is a 44px target and `text-base` (16px): iOS Safari zooms the page
// into any focused control whose font-size is below 16px, and a zoomed-in
// RSVP form is the #1 mobile form complaint. Focus ring = the same
// border+ring pair ui/input uses, so keyboard focus is visible on every field.
const FIELD_CLASS =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// 44px stepper buttons (design audit: they were h-9 w-9 = 36px on the most
// mobile-heavy page in the product). `touch-manipulation` removes the 300ms
// double-tap-zoom delay on the +/− taps. Motion (press/entrance) is owned by
// the public-pages motion layer, not here.
const STEPPER_BUTTON_CLASS =
  'grid size-11 shrink-0 place-items-center rounded-md text-xl leading-none transition-colors outline-none select-none touch-manipulation hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 disabled:hover:bg-transparent';

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
        className="flex items-center justify-between rounded-md border border-input bg-background p-0.5"
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`הפחתת ${label}`}
          className={STEPPER_BUTTON_CLASS}
          disabled={value <= 0}
        >
          −
        </button>
        <span aria-live="polite" className="min-w-8 text-center text-lg font-semibold tabular-nums">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`הוספת ${label}`}
          className={STEPPER_BUTTON_CLASS}
          disabled={value >= max}
        >
          +
        </button>
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

export function RsvpForm({
  token,
  view,
  inviteImageUrl,
  attendees,
  calendar,
}: {
  token: string;
  view: RsvpView;
  // Short-lived signed URL of the uploaded invitation image (private bucket),
  // created by the page AFTER the token resolved; null → no hero block.
  inviteImageUrl?: string | null;
  // "Who's coming" opt-in list — first names only, fetched server-side by
  // get_event_attendees_public. Empty when nobody has opted in (or on error).
  attendees?: RsvpAttendee[];
  // The shared <AddToCalendar> element, rendered by the PAGE (a Server
  // Component) and shown here only after the guest confirms attendance. It is
  // a prop, not an import, because that component uses the library's
  // server-only SSR helper, which must never enter this client bundle.
  calendar?: React.ReactNode;
}) {
  const { guest, event, questions, can_respond: canRespond } = view;
  const eventType = asEventType(event.event_type);
  const heading = eventHeadingFor(eventType, event.celebrants, event.name);
  const AccentIcon = EVENT_TYPE_ICON[eventType];

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

  const eventDate = formatEventDateLine(event.event_date);
  const attending = status === 'attending';
  // Combined ceiling: adults + kids must not exceed expected_count (or the
  // sanity cap when uninvited-count). Per-field caps leave the remainder.
  const hardCap = guest.expected_count ?? COUNT_FALLBACK_CAP;

  return (
    <div className="space-y-6">
      {inviteImageUrl ? (
        <a
          href={inviteImageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="פתיחת ההזמנה בגודל מלא"
          className="block overflow-hidden rounded-2xl border border-border shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3"
        >
          <Image
            src={inviteImageUrl}
            alt="הזמנת האירוע"
            width={448}
            height={560}
            priority
            className="h-auto w-full object-contain"
          />
        </a>
      ) : null}

      <header className="space-y-1 text-center transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-100">
        <p className="text-sm text-muted-foreground">שלום {guest.full_name},</p>
        <h1 className="flex items-center justify-center gap-2 text-balance text-2xl font-bold">
          <AccentIcon aria-hidden className="size-6 shrink-0 text-primary" />
          {heading.title}
        </h1>
        {heading.subtitle ? (
          <p className="text-muted-foreground">{heading.subtitle}</p>
        ) : null}
        {eventDate ? <p className="text-muted-foreground">{eventDate}</p> : null}
        {event.venue_name ? (
          <p className="text-sm text-muted-foreground">
            {event.venue_name}
            {event.venue_address ? `, ${event.venue_address}` : ''}
          </p>
        ) : null}
        {event.venue_address ? (
          <p className="text-sm">
            <a
              href={`https://waze.com/ul?q=${encodeURIComponent(event.venue_address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Navigation aria-hidden className="size-4" />
              ניווט עם Waze
            </a>
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
        // `@container`: the form lives in the md GuestShell (max 28rem), but on
        // a 320px phone its box is ~18rem. The three status buttons sit in one
        // row only from 20rem of FORM width and stack below it, so "לא מגיע/ה"
        // never wraps mid-word inside a 90px button.
        <form action={formAction} className="@container space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">האם תגיעו?</legend>
            <div className="grid gap-2 @[20rem]:grid-cols-3">
              {RSVP_STATUSES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setStatus(option)}
                  aria-pressed={status === option}
                  className={`min-h-11 rounded-md border px-3 py-2 text-base font-medium transition duration-200 ease-k-out outline-none select-none touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:active:scale-95 ${
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
            <div className="space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 duration-300 ease-k-out">
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

              {/* Owner toggle (events.show_meal_pref). `!== false` so a stale
                  payload missing the key (old DB, new code) fails OPEN — the
                  field keeps showing rather than silently vanishing. */}
              {event.show_meal_pref !== false ? (
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
                    className={FIELD_CLASS}
                  />
                  <FieldError errors={state?.fieldErrors?.meal_pref} />
                </div>
              ) : null}

              <label className="flex min-h-11 items-start gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="show_in_guest_list"
                  defaultChecked={guest.show_in_guest_list}
                  className="mt-px size-5 shrink-0 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                להופיע ברשימת &quot;מי מגיע&quot; — שם פרטי בלבד
              </label>

              <label className="flex min-h-11 items-start gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="call_consent"
                  defaultChecked={guest.call_consent ?? false}
                  className="mt-px size-5 shrink-0 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                אני מאשר/ת לקבל תזכורת בשיחה טלפונית אוטומטית (מערכת ממוחשבת)
                למספר זה
              </label>
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
                        className={FIELD_CLASS}
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
                        className={FIELD_CLASS}
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
              defaultValue={guest.rsvp_note ?? ''}
              className={FIELD_CLASS}
            />
            <FieldError errors={state?.fieldErrors?.note} />
          </div>

          <FormError message={state?.error} />
          {state?.notice ? (
            <div
              role="status"
              className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-500 ease-k-out"
            >
              <p className="flex items-center justify-center gap-2 font-semibold">
                <PartyPopper aria-hidden className="size-5 text-primary motion-safe:animate-k-pop k-delay-150" />
                {state.notice}
              </p>
              {attending ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  נתראה ב{EVENT_TYPE_LABELS[eventType]} — נרשמו {adults + kids}{' '}
                  {adults + kids === 1 ? 'משתתף/ת' : 'משתתפים'}.
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                אפשר לעדכן את התשובה בכל רגע מאותו קישור.
              </p>
              {attending && calendar ? <div className="mt-4">{calendar}</div> : null}
            </div>
          ) : null}
          <SubmitButton size="lg">שליחת אישור</SubmitButton>
        </form>
      )}

      {attendees && attendees.length > 0 ? (
        <div className="rounded-lg border border-border bg-card px-4 py-4">
          <p className="mb-2 text-sm font-medium">מי עוד מגיע</p>
          <p className="flex flex-wrap gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            {attendees.map((a, i) => (
              <span key={`${a.first_name}-${i}`}>
                {a.first_name}
                {i < attendees.length - 1 ? ',' : ''}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {event.gift_link_token ? (
        <div className="rounded-lg border border-border bg-card px-4 py-4 text-center">
          <p className="mb-2 text-sm text-muted-foreground">
            רוצים לשמח את בעלי השמחה?
          </p>
          <a
            href={`/g/${event.gift_link_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition duration-300 ease-k-out hover:opacity-90 hover:shadow-md hover:shadow-primary/25 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {GIFT_BRAND[event.gift_provider ?? ''] ? (
              <Image
                src={GIFT_BRAND[event.gift_provider ?? ''].icon}
                alt=""
                aria-hidden
                width={20}
                height={20}
                className="size-5 rounded-[5px]"
              />
            ) : (
              <Gift aria-hidden className="size-5" />
            )}
            {GIFT_BRAND[event.gift_provider ?? '']?.label ?? 'שליחת מתנה'}
          </a>
        </div>
      ) : null}
    </div>
  );
}
