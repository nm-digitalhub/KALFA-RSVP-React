'use client';

import { useActionState, useEffect, useRef } from 'react';
import Link from 'next/link';

import { sendBusinessEvent } from '@/components/consent/send-ga-event';
import { INQUIRY_TOPICS } from '@/lib/validation/inquiries';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { Input } from '@/components/ui/input';
import {
  submitCallbackAction,
  submitContactAction,
  type InquiryFormState,
} from './actions';

// generate_lead — fired exactly once per successful REAL submission (the
// server sets `leadSource` only when a lead was actually persisted; the
// honeypot's fake success carries no flag, so bots never become conversions).
function useLeadEvent(state: InquiryFormState) {
  const fired = useRef<InquiryFormState>(null);
  useEffect(() => {
    if (!state?.leadSource || fired.current === state) return;
    fired.current = state;
    sendBusinessEvent({ name: 'generate_lead', params: { lead_source: state.leadSource } });
  }, [state]);
}

// Both public inquiry forms. Server-validated (Zod in the actions); the
// required/type attributes here are UX hints only. The "company" field is a
// honeypot — visually hidden, ignored by real users, checked server-side.

const FIELD_CLS =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -m-px size-px overflow-hidden p-0 [clip:rect(0,0,0,0)]">
      <label>
        חברה
        <input type="text" name="company" tabIndex={-1} autoComplete="off" />
      </label>
    </div>
  );
}

function TopicSelect({
  id,
  defaultTopic,
}: {
  id: string;
  defaultTopic?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        נושא הפנייה
      </label>
      <select id={id} name="topic" defaultValue={defaultTopic ?? INQUIRY_TOPICS[0]} className={FIELD_CLS}>
        {INQUIRY_TOPICS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function PrivacyNote() {
  return (
    <p className="text-xs text-muted-foreground">
      הפרטים ישמשו למענה לפנייה בלבד.{' '}
      <Link href="/privacy" className="underline hover:text-foreground">
        מדיניות פרטיות
      </Link>
    </p>
  );
}

export function ContactForm({
  defaultTopic,
  defaultEmail,
  defaultName,
}: {
  defaultTopic?: string;
  defaultEmail?: string;
  defaultName?: string;
}) {
  const [state, formAction] = useActionState(submitContactAction, null);
  useLeadEvent(state);

  return (
    <form action={formAction} className="relative space-y-4">
      <Honeypot />
      <div>
        <label htmlFor="contact-name" className="mb-1 block text-sm font-medium">
          שם מלא
        </label>
        <Input id="contact-name" name="name" required defaultValue={defaultName} autoComplete="name" />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-email" className="mb-1 block text-sm font-medium">
            אימייל
          </label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            dir="ltr"
            defaultValue={defaultEmail}
            autoComplete="email"
          />
          <FieldError errors={state?.fieldErrors?.email} />
        </div>
        <div>
          <label htmlFor="contact-phone" className="mb-1 block text-sm font-medium">
            טלפון
          </label>
          <Input id="contact-phone" name="phone" type="tel" dir="ltr" autoComplete="tel" />
          <FieldError errors={state?.fieldErrors?.phone} />
        </div>
      </div>
      <TopicSelect id="contact-topic" defaultTopic={defaultTopic} />
      <div>
        <label htmlFor="contact-message" className="mb-1 block text-sm font-medium">
          תוכן הפנייה
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={5}
          maxLength={2000}
          className={FIELD_CLS}
        />
        <FieldError errors={state?.fieldErrors?.message} />
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton>שליחת פנייה</SubmitButton>
      <PrivacyNote />
    </form>
  );
}

/**
 * When to call back.
 *
 * The ONE field on this form a machine acts on. Everything else is read by a
 * person; this becomes the instant the scheduler starts searching from, which
 * is why it is a closed set of choices rather than another line of prose.
 *
 * It exists because prose does not reach the scheduler: measured 28.07, a
 * caller wrote that they were reachable 08:00–13:00 and not today, and the
 * system booked them for that same afternoon — the note said so, and nothing
 * that picks a time ever reads the note.
 *
 * Plain radios, no client state: the form posts as FormData, an unchecked group
 * simply posts nothing, and the server defaults that to "as soon as possible" —
 * the behaviour this form already had.
 */
const TIME_PREFERENCES = [
  { value: 'asap', label: 'בהקדם האפשרי' },
  { value: 'morning', label: 'בבוקר' },
  { value: 'afternoon', label: 'בצהריים' },
  { value: 'evening', label: 'אחר הצהריים' },
] as const;

function CallbackTimePreference() {
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium">מתי נוח שנחזור אליך?</legend>
      <div className="flex flex-wrap gap-2">
        {TIME_PREFERENCES.map((option, index) => (
          <label
            key={option.value}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium hover:bg-muted"
          >
            <input
              type="radio"
              name="preference"
              value={option.value}
              defaultChecked={index === 0}
              className="size-4 accent-primary"
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

export function CallbackForm({ defaultTopic }: { defaultTopic?: string }) {
  const [state, formAction] = useActionState(submitCallbackAction, null);
  useLeadEvent(state);

  return (
    <form action={formAction} className="relative space-y-4">
      <Honeypot />
      <div>
        <label htmlFor="cb-name" className="mb-1 block text-sm font-medium">
          שם מלא
        </label>
        <Input id="cb-name" name="full_name" required autoComplete="name" />
        <FieldError errors={state?.fieldErrors?.full_name} />
      </div>
      <div>
        <label htmlFor="cb-phone" className="mb-1 block text-sm font-medium">
          טלפון
        </label>
        <Input id="cb-phone" name="phone" type="tel" required dir="ltr" autoComplete="tel" />
        <FieldError errors={state?.fieldErrors?.phone} />
      </div>
      <TopicSelect id="cb-topic" defaultTopic={defaultTopic} />
      <CallbackTimePreference />
      <div>
        <label htmlFor="cb-note" className="mb-1 block text-sm font-medium">
          הערה (לא חובה)
        </label>
        <textarea id="cb-note" name="note" rows={2} maxLength={500} className={FIELD_CLS} />
        <FieldError errors={state?.fieldErrors?.note} />
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton>חזרו אליי</SubmitButton>
      <PrivacyNote />
    </form>
  );
}
