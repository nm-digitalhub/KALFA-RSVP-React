import type { TFunction } from 'i18next';
import { z } from 'zod';

import { isValidPhone } from '@/lib/phone';

// Public inquiry forms (contact + call-me-back). The topic vocabulary is
// closed at the form boundary but stored as-is in free-text columns and
// rendered raw by the admin pages — exactly how callback_requests.topic is
// displayed today, so no label map is needed.
export const INQUIRY_TOPICS = ['מכירות', 'תמיכה', 'חיוב ותשלום', 'אחר'] as const;

// Each schema is built with the caller's `t`, so its messages follow the language of the request. A Server Action passes
// the `t` of getT('public') from @/i18n.server: `public` is the only namespace next-i18next serves (src/i18n.config.ts).
// Code with no request passes the fixed getT('public') from @/lib/i18n, which stays Hebrew. The messages are
// `{ error: () => ... }`, resolved when a value fails: a bare function in that position is ignored by Zod 4.
function nameSchema(t: TFunction<'public'>) {
  return z
    .string()
    .trim()
    .min(2, { error: () => t('validation.name.required', 'נא למלא שם') })
    .max(120, { error: () => t('validation.name.tooLong', 'השם ארוך מדי') });
}

function phoneSchema(t: TFunction<'public'>) {
  return z
    .string()
    .trim()
    .refine((v) => isValidPhone(v), { error: () => t('validation.phone.invalidShort', 'מספר הטלפון אינו תקין') });
}

export function contactMessageSchema(t: TFunction<'public'>) {
  return z
    .object({
      name: nameSchema(t),
      email: z.email({ error: () => t('validation.email.invalidShort', 'כתובת האימייל אינה תקינה') }).max(254).optional(),
      phone: phoneSchema(t).optional(),
      topic: z.enum(INQUIRY_TOPICS, { error: () => t('validation.inquiry.topic.required', 'נא לבחור נושא') }),
      message: z
        .string()
        .trim()
        .min(5, { error: () => t('validation.inquiry.message.required', 'נא לכתוב את תוכן הפנייה') })
        .max(2000, { error: () => t('validation.inquiry.message.tooLong', 'ההודעה ארוכה מדי') }),
    })
    .refine((v) => Boolean(v.email) || Boolean(v.phone), {
      error: () => t('validation.inquiry.contact.required', 'נא למלא טלפון או אימייל ליצירת קשר'),
      path: ['phone'],
    });
}

/**
 * When the caller would like to be called back.
 *
 * A CLOSED vocabulary, not free text, because this is the one field on the form
 * that a machine acts on: the scheduler turns the choice into the instant its
 * slot search starts from. Measured 28.07 — a caller wrote "זמין 8 עד 13, חוץ
 * מהיום" in the note and was scheduled for that same afternoon, because prose
 * in `note` is read by people and by nothing else.
 *
 * 'exact' is deliberately absent from the public form: it needs a date-and-time
 * picker, and a caller who picks a moment we then move for business hours,
 * Shabbat or a conflict is worse served than one who picked a part of the day.
 */
export const CALLBACK_TIME_PREFERENCES = ['asap', 'morning', 'afternoon', 'evening'] as const;

export function callbackRequestSchema(t: TFunction<'public'>) {
  return z.object({
    full_name: nameSchema(t),
    phone: phoneSchema(t),
    topic: z.enum(INQUIRY_TOPICS, { error: () => t('validation.inquiry.topic.required', 'נא לבחור נושא') }),
    note: z.string().trim().max(500, { error: () => t('validation.note.tooLong', 'ההערה ארוכה מדי') }).optional(),
    // Absent on an older client, or when nothing was picked — "as soon as
    // possible" is what the form did implicitly before this field existed, so
    // defaulting to it keeps every existing path behaving exactly as it did.
    preference: z.enum(CALLBACK_TIME_PREFERENCES).default('asap'),
  });
}

// The same answers as callbackRequestSchema MINUS the phone.
//
// ⚠️ The omission is the security property, not an oversight. This form is
// reached from a one-time link sent by SMS to the number that rang us, and
// that number is what the token is bound to. A phone field — even a disabled
// one — would let whoever holds the link redirect someone else's callback to
// a number of their choosing. The action re-reads the phone from the row; the
// submitter never supplies it.
export function callbackIntakeSchema(t: TFunction<'public'>) {
  return z.object({
    full_name: nameSchema(t),
    topic: z.enum(INQUIRY_TOPICS, { error: () => t('validation.inquiry.topic.required', 'נא לבחור נושא') }),
    note: z.string().trim().max(500, { error: () => t('validation.note.tooLong', 'ההערה ארוכה מדי') }).optional(),
    preference: z.enum(CALLBACK_TIME_PREFERENCES).default('asap'),
  });
}

export type CallbackIntakeInput = z.infer<ReturnType<typeof callbackIntakeSchema>>;

export type ContactMessageInput = z.infer<ReturnType<typeof contactMessageSchema>>;
export type CallbackRequestInput = z.infer<ReturnType<typeof callbackRequestSchema>>;
