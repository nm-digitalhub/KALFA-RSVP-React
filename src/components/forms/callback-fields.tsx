'use client';

import Link from 'next/link';

import { Label } from '@/components/ui/label';
import { INQUIRY_TOPICS } from '@/lib/validation/inquiries';

// The field groups shared by the two callback forms: the public /contact one
// (which CREATES a request) and the missed-call intake at /cb/[token] (which
// FILLS IN the one we already made from a phone number).
//
// Extracted rather than copied because they are the same question asked twice.
// The topic in particular is not cosmetic — callback-scheduling.ts routes on
// it, sending 'מכירות' to the sales agent and everything else to the
// meeting-confirm agent — so two drifting copies would mean two different sets
// of choices deciding which agent calls a person back.
//
// ⚠️ What is NOT here, and must never be: the phone field. /contact asks for
// it because it is creating a request from nothing. The intake form must not,
// because its row already has the number the SMS link was sent to, and a
// phone input there would let whoever holds the link redirect someone else's
// callback to their own number.

// Field sizing on these PUBLIC forms (live-beta measurement 2026-09-08: inputs
// and select were 32px tall, the submit 40px, at every viewport). Same bar the
// /r RSVP form sets: every control ≥44px (`min-h-11` — min-height beats the
// primitives' `h-8`/`h-11 md:h-9`) and 16px text at every width (`text-base`,
// replacing the primitives' `md:text-sm` via cn()) so iOS never auto-zooms
// into a focused control.
export const FIELD_CLS = 'min-h-11 text-base md:text-base';

// The native <select> mirrors ui/input's field styling (radius, border token,
// focus ring) plus the same FIELD_CLS sizing, so the field types read as one
// set. A native select rather than ui/select ON PURPOSE: a closed list of
// topics needs no portal, and the OS picker is the better control on a phone.
export const SELECT_CLS =
  'min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

/** Visually hidden, ignored by real users, checked server-side. */
export function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -m-px size-px overflow-hidden p-0 [clip:rect(0,0,0,0)]">
      <label>
        חברה
        <input type="text" name="company" tabIndex={-1} autoComplete="off" />
      </label>
    </div>
  );
}

export function TopicSelect({ id, defaultTopic }: { id: string; defaultTopic?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>נושא הפנייה</Label>
      <select id={id} name="topic" defaultValue={defaultTopic ?? INQUIRY_TOPICS[0]} className={SELECT_CLS}>
        {INQUIRY_TOPICS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

const TIME_PREFERENCES = [
  { value: 'asap', label: 'בהקדם האפשרי' },
  { value: 'morning', label: 'בבוקר' },
  { value: 'afternoon', label: 'אחר הצהריים' },
  { value: 'evening', label: 'בערב' },
] as const;

/**
 * Plain radios, no client state: the form posts as FormData, an unchecked
 * group simply posts nothing, and the server defaults that to "as soon as
 * possible".
 */
export function CallbackTimePreference() {
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium">מתי נוח שנחזור אליך?</legend>
      <div className="flex flex-wrap gap-2">
        {TIME_PREFERENCES.map((option, index) => (
          <label
            key={option.value}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring hover:bg-muted"
          >
            <input
              type="radio"
              name="preference"
              value={option.value}
              defaultChecked={index === 0}
              // The chip (the label) draws the focus outline via
              // `has-focus-visible:`; `outline-hidden` (not v4's `outline-none`)
              // keeps a forced-colors fallback on the radio itself.
              className="size-4 accent-primary outline-hidden"
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        נשתדל לחזור בטווח שבחרת, בשעות הפעילות.
      </p>
    </fieldset>
  );
}

export function PrivacyNote() {
  return (
    <p className="text-xs text-muted-foreground">
      הפרטים ישמשו למענה לפנייה בלבד.{' '}
      <Link href="/privacy" className="underline hover:text-foreground">
        מדיניות פרטיות
      </Link>
    </p>
  );
}
