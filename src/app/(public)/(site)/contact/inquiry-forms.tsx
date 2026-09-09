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
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

// Field sizing on this PUBLIC form (live-beta measurement 2026-09-08: inputs
// and select were 32px tall, the submit 40px, at every viewport). Same bar the
// /r RSVP form sets: every control ≥44px (`min-h-11` — min-height beats the
// primitives' `h-8`/`h-11 md:h-9`) and 16px text at every width (`text-base`,
// replacing the primitives' `md:text-sm` via cn()) so iOS never auto-zooms
// into a focused control. ui/input has no size variant (read 2026-09-08), so
// the override is a className, merged by the primitive's own cn().
const FIELD_CLS = 'min-h-11 text-base md:text-base';

// The native <select> mirrors ui/input's field styling (radius, border token,
// focus ring) plus the same FIELD_CLS sizing, so the three field types on these
// forms read as one set. A native select rather than ui/select ON PURPOSE: a
// closed list of six topics needs no portal, and the OS picker is the better
// control on a phone. Textareas use the ui/textarea primitive directly.
const SELECT_CLS =
  'min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

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

// Callback-specific: the call itself may be an automated one, unlike
// ContactForm's email-style reply — disclosed here, not in the shared
// PrivacyNote, so ContactForm submitters (no call involved) don't see it.
function CallbackDisclosureNote() {
  return (
    <p className="text-xs text-muted-foreground">
      החזרה עשויה להתבצע על ידי נציג אנושי או באמצעות סוכן דיגיטלי/קולי אוטומטי מטעם קלפה. בעקבות
      השיחה ייתכן שגם תישלח הודעת WhatsApp מטעם קלפה, בכפוף לאישורך במהלך השיחה עצמה.
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
      <div className="grid gap-1.5">
        <Label htmlFor="contact-name">שם מלא</Label>
        <Input id="contact-name" name="name" required defaultValue={defaultName} autoComplete="name" className={FIELD_CLS} />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>
      <div className="grid gap-4 @md/form:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="contact-email">אימייל</Label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            dir="ltr"
            defaultValue={defaultEmail}
            autoComplete="email"
            className={FIELD_CLS}
          />
          <FieldError errors={state?.fieldErrors?.email} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="contact-phone">טלפון</Label>
          <PhoneInput id="contact-phone" name="phone" className={FIELD_CLS} />
          <FieldError errors={state?.fieldErrors?.phone} />
        </div>
      </div>
      <TopicSelect id="contact-topic" defaultTopic={defaultTopic} />
      <div className="grid gap-1.5">
        <Label htmlFor="contact-message">תוכן הפנייה</Label>
        <Textarea id="contact-message" name="message" required rows={5} maxLength={2000} className={FIELD_CLS} />
        <FieldError errors={state?.fieldErrors?.message} />
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton size="lg" className="min-h-11">שליחת פנייה</SubmitButton>
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
  { value: 'afternoon', label: 'אחר הצהריים' },
  { value: 'evening', label: 'בערב' },
] as const;

function CallbackTimePreference() {
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

export function CallbackForm({ defaultTopic }: { defaultTopic?: string }) {
  const [state, formAction] = useActionState(submitCallbackAction, null);
  useLeadEvent(state);

  return (
    <form action={formAction} className="relative space-y-4">
      <Honeypot />
      <div className="grid gap-1.5">
        <Label htmlFor="cb-name">שם מלא</Label>
        <Input id="cb-name" name="full_name" required autoComplete="name" className={FIELD_CLS} />
        <FieldError errors={state?.fieldErrors?.full_name} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cb-phone">טלפון</Label>
        <PhoneInput id="cb-phone" name="phone" required className={FIELD_CLS} />
        <FieldError errors={state?.fieldErrors?.phone} />
      </div>
      <TopicSelect id="cb-topic" defaultTopic={defaultTopic} />
      <p className="text-xs text-muted-foreground">
        בבחירת נושא &quot;מכירות&quot; אני מבקש/ת שיחזרו אליי בנוגע לרכישת שירותי קלפה, לרבות מידע ופרטים לפני רכישה.
      </p>
      <CallbackTimePreference />
      <div className="grid gap-1.5">
        <Label htmlFor="cb-note">הערה (לא חובה)</Label>
        <Textarea id="cb-note" name="note" rows={2} maxLength={500} className={FIELD_CLS} />
        <FieldError errors={state?.fieldErrors?.note} />
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton size="lg" className="min-h-11">חזרו אליי</SubmitButton>
      <CallbackDisclosureNote />
      <PrivacyNote />
    </form>
  );
}
