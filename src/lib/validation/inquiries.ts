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

export const callbackRequestSchema = z.object({
  full_name: nameSchema,
  phone: phoneSchema,
  topic: z.enum(INQUIRY_TOPICS, { error: 'נא לבחור נושא' }),
  note: z.string().trim().max(500, 'ההערה ארוכה מדי').optional(),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
export type CallbackRequestInput = z.infer<typeof callbackRequestSchema>;
