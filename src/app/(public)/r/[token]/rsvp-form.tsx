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
import { formatHebrewDateIL } from '@/lib/whatsapp/template-spec';
import { formatIsraelDate, formatIsraelTime } from '@/lib/date';
import { ilTimeInputValue } from '@/lib/data/event-date';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import type { Database } from '@/lib/supabase/types';
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

// Official payment-brand marks for the gift CTA (public/brands — bit's is the
// favicon from bitpay.co.il, PayBox's is its official App Store icon). An
// unrecognized provider falls back to a neutral gift icon.
const GIFT_BRAND: Record<string, { icon: string; label: string }> = {
  bit: { icon: '/brands/bit.png', label: 'שליחת מתנה ב־bit' },
  paybox: { icon: '/brands/paybox.png', label: 'שליחת מתנה ב־PayBox' },
};

type EventType = Database['public']['Enums']['event_type'];

// The RPC types event_type as string|null; narrow to the enum (defensive —
// the DB column IS the enum, so this only guards impossible data).
function asEventType(value: string | null): EventType {
  return (EVENT_TYPES as readonly string[]).includes(value ?? '')
    ? (value as EventType)
    : 'other';
}

// All parts pinned to Israel time: this is a PUBLIC page — a guest opening
// the link abroad (or a server/browser TZ mismatch during hydration) must
// still see the event's Israel date, never their device's local calendar day.
const weekdayFmt = new Intl.DateTimeFormat(ISRAEL_LOCALE, {
  timeZone: ISRAEL_TIME_ZONE,
  weekday: 'long',
});

// "יום ראשון, כ״ז בתמוז תשפ״ו · 12.07.2026 · 17:30" — the same language the
// guest already saw in the WhatsApp invitation (Hebrew date included for every
// event type, exactly like template slot {{5}}). Time appears only when one
// was actually set. Hebrew-calendar ICU is wrapped defensively — an exotic
// browser without it still gets the Gregorian line.
function formatEventDateLine(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const parts: string[] = [];
  let hebrew = '';
  try {
    hebrew = formatHebrewDateIL(ms);
  } catch {
    hebrew = '';
  }
  parts.push(hebrew ? `${weekdayFmt.format(ms)}, ${hebrew}` : weekdayFmt.format(ms));
  parts.push(formatIsraelDate(ms));
  if (ilTimeInputValue(value) !== '') parts.push(formatIsraelTime(ms));
  return parts.join(' · ');
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

export function RsvpForm({
  token,
  view,
  inviteImageUrl,
}: {
  token: string;
  view: RsvpView;
  // Short-lived signed URL of the uploaded invitation image (private bucket),
  // created by the page AFTER the token resolved; null → no hero block.
  inviteImageUrl?: string | null;
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
          className="block overflow-hidden rounded-2xl border border-border shadow-sm"
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

      <header className="space-y-1 text-center">
        <p className="text-sm text-muted-foreground">שלום {guest.full_name},</p>
        <h1 className="flex items-center justify-center gap-2 text-2xl font-bold">
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
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
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
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                  <FieldError errors={state?.fieldErrors?.meal_pref} />
                </div>
              ) : null}
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
              defaultValue={guest.rsvp_note ?? ''}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
            <FieldError errors={state?.fieldErrors?.note} />
          </div>

          <FormError message={state?.error} />
          {state?.notice ? (
            <div
              role="status"
              className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center"
            >
              <p className="flex items-center justify-center gap-2 font-semibold">
                <PartyPopper aria-hidden className="size-5 text-primary" />
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
            </div>
          ) : null}
          <SubmitButton>שליחת אישור</SubmitButton>
        </form>
      )}

      {event.gift_link_token ? (
        <div className="rounded-lg border border-border bg-card px-4 py-4 text-center">
          <p className="mb-2 text-sm text-muted-foreground">
            רוצים לשמח את בעלי השמחה?
          </p>
          <a
            href={`/g/${event.gift_link_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
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
