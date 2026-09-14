'use client';

import { useActionState, useEffect, useRef } from 'react';

import { sendBusinessEvent } from '@/components/consent/send-ga-event';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  CallbackTimePreference,
  FIELD_CLS,
  Honeypot,
  PrivacyNote,
  TopicSelect,
} from '@/components/forms/callback-fields';
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
 */
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
