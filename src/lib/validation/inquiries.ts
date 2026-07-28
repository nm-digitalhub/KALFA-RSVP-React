import { z } from 'zod';

import { isValidPhone } from '@/lib/phone';

// Public inquiry forms (contact + call-me-back). The topic vocabulary is
// closed at the form boundary but stored as-is in free-text columns and
// rendered raw by the admin pages — exactly how callback_requests.topic is
// displayed today, so no label map is needed.
export const INQUIRY_TOPICS = ['מכירות', 'תמיכה', 'חיוב ותשלום', 'אחר'] as const;

const nameSchema = z.string().trim().min(2, 'נא למלא שם').max(120, 'השם ארוך מדי');

const phoneSchema = z
  .string()
  .trim()
  .refine((v) => isValidPhone(v), 'מספר הטלפון אינו תקין');

export const contactMessageSchema = z
  .object({
    name: nameSchema,
    email: z.email('כתובת האימייל אינה תקינה').max(254).optional(),
    phone: phoneSchema.optional(),
    topic: z.enum(INQUIRY_TOPICS, { error: 'נא לבחור נושא' }),
    message: z
      .string()
      .trim()
      .min(5, 'נא לכתוב את תוכן הפנייה')
      .max(2000, 'ההודעה ארוכה מדי'),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'נא למלא טלפון או אימייל ליצירת קשר',
    path: ['phone'],
  });

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

export const callbackRequestSchema = z.object({
  full_name: nameSchema,
  phone: phoneSchema,
  topic: z.enum(INQUIRY_TOPICS, { error: 'נא לבחור נושא' }),
  note: z.string().trim().max(500, 'ההערה ארוכה מדי').optional(),
  // Absent on an older client, or when nothing was picked — "as soon as
  // possible" is what the form did implicitly before this field existed, so
  // defaulting to it keeps every existing path behaving exactly as it did.
  preference: z.enum(CALLBACK_TIME_PREFERENCES).default('asap'),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
export type CallbackRequestInput = z.infer<typeof callbackRequestSchema>;
