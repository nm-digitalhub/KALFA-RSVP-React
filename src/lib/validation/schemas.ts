import { z } from 'zod';

import { ISRAELI_PHONE_RE, PROFILE_NAME_MAX } from '@/lib/constants';

// Auth
export const loginSchema = z.object({
  // Trim before validating so a stray leading/trailing space is not rejected.
  email: z.string().trim().pipe(z.email({ error: 'כתובת אימייל לא תקינה' })),
  password: z.string().min(1, { error: 'נא להזין סיסמה' }),
});

export const signupSchema = z.object({
  email: z.string().trim().pipe(z.email({ error: 'כתובת אימייל לא תקינה' })),
  password: z
    .string()
    .min(8, { error: 'הסיסמה חייבת לכלול לפחות 8 תווים' })
    .max(72, { error: 'הסיסמה ארוכה מדי' }),
});

// Events — event_type matches the public.event_type enum in the live schema.
export const EVENT_TYPES = [
  'wedding',
  'bar_mitzvah',
  'bat_mitzvah',
  'brit',
  'britah',
  'henna',
  'engagement',
  'birthday',
  'other',
] as const;

export const createEventSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין שם אירוע' })
    .max(200, { error: 'שם האירוע ארוך מדי' }),
  event_type: z.enum(EVENT_TYPES, { error: 'נא לבחור סוג אירוע' }),
  event_date: z.string().trim().optional().or(z.literal('')),
  venue_name: z
    .string()
    .trim()
    .max(200, { error: 'שם המקום ארוך מדי' })
    .optional()
    .or(z.literal('')),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

// event_status matches the public.event_status enum in the live schema.
export const EVENT_STATUSES = ['draft', 'active', 'closed'] as const;

// Edit form for an existing event. Adds venue_address, rsvp_deadline and status
// on top of the create fields. Optional text/date fields accept an empty string
// (the action maps '' to null); id/owner are derived server-side, never here.
export const updateEventSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין שם אירוע' })
    .max(200, { error: 'שם האירוע ארוך מדי' }),
  event_type: z.enum(EVENT_TYPES, { error: 'נא לבחור סוג אירוע' }),
  event_date: z.string().trim().optional().or(z.literal('')),
  venue_name: z
    .string()
    .trim()
    .max(200, { error: 'שם המקום ארוך מדי' })
    .optional()
    .or(z.literal('')),
  venue_address: z
    .string()
    .trim()
    .max(300, { error: 'הכתובת ארוכה מדי' })
    .optional()
    .or(z.literal('')),
  rsvp_deadline: z.string().trim().optional().or(z.literal('')),
  status: z.enum(EVENT_STATUSES, { error: 'נא לבחור סטטוס' }),
});

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// Orders — order_status matches the public.order_status enum in the live schema.
// This const is the vocabulary; ORDER_STATUS_LABELS (in src/lib/data/orders.ts)
// maps each value to its Hebrew label, keyed on the Database enum so a missing
// label is a compile error.
export const ORDER_STATUSES = ['pending', 'processing', 'paid', 'failed', 'demo', 'payment_review'] as const;

export const payPendingOrderSchema = z.object({
  order_id: z.string().uuid({ error: 'מזהה הזמנה לא תקין' }),
  'og-token': z.string().trim().min(1, { error: 'פרטי תשלום חסרים' }),
});

// Profile (account settings). Both fields are optional: an empty string clears
// the value. `phone` is validated against the Israeli numbering plan
// (ISRAELI_PHONE_RE) only when present. The owner id is derived server-side and
// is intentionally NOT part of this schema.
export const updateProfileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .max(PROFILE_NAME_MAX, { error: 'השם ארוך מדי' })
    .optional()
    .or(z.literal('')),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || ISRAELI_PHONE_RE.test(v), {
      error: 'מספר טלפון לא תקין',
    })
    .optional()
    .or(z.literal('')),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Account settings. These preferences are owned by the current user and stored
// separately from the public-ish profile fields.
export const updateSettingsSchema = z.object({
  event_updates: z.coerce.boolean().default(false),
  reminder_updates: z.coerce.boolean().default(false),
  billing_updates: z.coerce.boolean().default(false),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// Email change is double-opt-in: the address changes only after the user
// confirms via a link sent to the NEW address (Supabase auth.updateUser).
export const emailChangeSchema = z.object({
  email: z.string().trim().pipe(z.email({ error: 'כתובת אימייל לא תקינה' })),
});
export type EmailChangeInput = z.infer<typeof emailChangeSchema>;
