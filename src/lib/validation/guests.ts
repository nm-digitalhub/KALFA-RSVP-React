import { z } from 'zod';

import { Constants } from '@/lib/supabase/types';
import { GUEST_NAME_MAX, NOTE_MAX, ISRAELI_PHONE_RE } from '@/lib/constants';

// Enum vocabularies come from the generated `Constants` (single source of
// truth), so adding/removing a DB enum value surfaces here as a type error
// rather than silently drifting.
const GUEST_STATUS_VALUES = Constants.public.Enums.guest_status;
const CONTACT_STATUS_VALUES = Constants.public.Enums.contact_status;

// An optional phone field: empty string passes (phone is optional), otherwise
// it must look like an Israeli number. Normalisation of spaces/hyphens is
// handled by the regex tolerance, not by mutating the value here.
const optionalPhone = z
  .string()
  .trim()
  .max(20, { error: 'מספר הטלפון ארוך מדי' })
  .refine((v) => v === '' || ISRAELI_PHONE_RE.test(v), {
    error: 'מספר טלפון לא תקין',
  });

// A non-negative integer guest count (adults/kids), optional. Coerced from the
// string form fields carry.
const optionalCount = z.coerce
  .number({ error: 'נא להזין מספר' })
  .int({ error: 'נא להזין מספר שלם' })
  .min(0, { error: 'המספר חייב להיות 0 ומעלה' })
  .max(100000, { error: 'המספר גדול מדי' })
  .optional();

export const createGuestSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין שם מוזמן' })
    .max(GUEST_NAME_MAX, { error: 'שם המוזמן ארוך מדי' }),
  phone: optionalPhone.optional().or(z.literal('')),
  status: z.enum(GUEST_STATUS_VALUES, { error: 'סטטוס לא תקין' }).optional(),
  contact_status: z
    .enum(CONTACT_STATUS_VALUES, { error: 'סטטוס יצירת קשר לא תקין' })
    .optional(),
  group_id: z.uuid({ error: 'קבוצה לא תקינה' }).optional().or(z.literal('')),
  expected_count: optionalCount,
  note: z
    .string()
    .trim()
    .max(NOTE_MAX, { error: 'ההערה ארוכה מדי' })
    .optional()
    .or(z.literal('')),
});

// Updates are a partial of the create shape: every field is optional, and the
// schema intentionally has NO `id`, `event_id`, or `rsvp_token` field, so those
// can never be smuggled through an update from the browser.
export const updateGuestSchema = createGuestSchema.partial();

// A single CSV import row. Phone/group are optional; group is resolved by name
// downstream, so it is a free string here. Counts are coerced leniently.
export const importRowSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, { error: 'שם המוזמן חסר' })
    .max(GUEST_NAME_MAX, { error: 'שם המוזמן ארוך מדי' }),
  phone: z
    .string()
    .trim()
    .max(20, { error: 'מספר הטלפון ארוך מדי' })
    .refine((v) => v === '' || ISRAELI_PHONE_RE.test(v), {
      error: 'מספר טלפון לא תקין',
    })
    .optional()
    .or(z.literal('')),
  group: z
    .string()
    .trim()
    .max(200, { error: 'שם הקבוצה ארוך מדי' })
    .optional()
    .or(z.literal('')),
  expected_count: optionalCount,
});

export const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין שם קבוצה' })
    .max(200, { error: 'שם הקבוצה ארוך מדי' }),
  color: z
    .string()
    .trim()
    .max(50, { error: 'הצבע ארוך מדי' })
    .optional()
    .or(z.literal('')),
});

export type CreateGuestInput = z.infer<typeof createGuestSchema>;
export type UpdateGuestInput = z.infer<typeof updateGuestSchema>;
export type ImportRowInput = z.infer<typeof importRowSchema>;
export type GroupInput = z.infer<typeof groupSchema>;
