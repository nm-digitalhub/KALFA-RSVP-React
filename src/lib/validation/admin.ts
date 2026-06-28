import { z } from 'zod';

// Validation schemas and label vocabularies for the admin panel.
//
// Enum-backed columns derive their allowed values from the generated
// `Constants` (single source of truth in supabase/types). `callback_requests.
// status` is a FREE-TEXT column in the database (not a PG enum), so we define a
// closed working vocabulary here and render unknown values with a
// `LABELS[s] ?? s` fallback so legacy/foreign values never break the UI.

import { Constants } from '@/lib/supabase/types';
import type { Database } from '@/lib/supabase/types';

// --- callback_requests.status (free text in DB → app-level vocabulary) ---
// New rows default to 'new' (the DB default is the literal string 'new' per the
// column default; we keep the same token here). These are the statuses an admin
// can SET via the UI. Unknown stored values still render via the label fallback.
export const CALLBACK_STATUSES = [
  'new',
  'in_progress',
  'done',
  'cancelled',
] as const;

export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

// Enum schema for the status update action. Rejects anything outside the
// closed vocabulary with a safe Hebrew message.
export const callbackStatusEnum = z.enum(CALLBACK_STATUSES, {
  error: 'סטטוס לא תקין',
});

// Form payload for updating a single callback request's status.
export const updateCallbackStatusSchema = z.object({
  id: z.string().uuid({ error: 'מזהה לא תקין' }),
  status: callbackStatusEnum,
});

// --- packages CRUD ---
// `category` and `tier` are free-text columns in the DB. We keep them as
// trimmed non-empty strings (server-validated) rather than inventing an enum.
// `includes` is a JSON array of strings, entered as one item per line in a
// textarea and normalised server-side.

const PACKAGE_NAME_MAX = 200;
const PACKAGE_TIER_MAX = 50;
const PACKAGE_CATEGORY_MAX = 50;
const PACKAGE_DESC_MAX = 2000;
const PACKAGE_INCLUDE_ITEM_MAX = 200;
const PACKAGE_INCLUDES_MAX_ITEMS = 50;

// A textarea string → string[] of trimmed, non-empty lines (the `includes`
// JSON column). Order is preserved; blank lines are dropped.
const includesFromTextarea = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  )
  .pipe(
    z
      .array(z.string().max(PACKAGE_INCLUDE_ITEM_MAX, { error: 'פריט ארוך מדי' }))
      .max(PACKAGE_INCLUDES_MAX_ITEMS, { error: 'יותר מדי פריטים' }),
  );

// Price is submitted as a string from the form; coerce to a non-negative
// number. `vat`-inclusive amount maps to `price_with_vat`.
const priceWithVat = z.coerce
  .number({ error: 'נא להזין מחיר תקין' })
  .nonnegative({ error: 'המחיר לא יכול להיות שלילי' });

// `active` checkbox: present ("on"/"true") → true, absent → false.
const activeCheckbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('false'), z.undefined(), z.null()])
  .transform((v) => v === 'on' || v === 'true');

export const packageBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין שם חבילה' })
    .max(PACKAGE_NAME_MAX, { error: 'שם החבילה ארוך מדי' }),
  tier: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין דרגה' })
    .max(PACKAGE_TIER_MAX, { error: 'הדרגה ארוכה מדי' }),
  category: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין קטגוריה' })
    .max(PACKAGE_CATEGORY_MAX, { error: 'הקטגוריה ארוכה מדי' }),
  description: z
    .string()
    .trim()
    .max(PACKAGE_DESC_MAX, { error: 'התיאור ארוך מדי' })
    .optional()
    .or(z.literal('')),
  price_with_vat: priceWithVat,
  includes: includesFromTextarea,
  active: activeCheckbox,
  // Display order in the customer catalogue (lower = shown first). Submitted as a
  // string; absent/blank → 0 so the field is optional in the form.
  sort_order: z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? 0 : value),
    z.coerce
      .number({ error: 'נא להזין מספר סדר תקין' })
      .int({ error: 'מספר הסדר חייב להיות מספר שלם' })
      .nonnegative({ error: 'מספר הסדר לא יכול להיות שלילי' }),
  ),
});

export type PackageInput = z.infer<typeof packageBaseSchema>;

// --- app_role (for reference / future role management) ---
export const appRoleEnum = z.enum(Constants.public.Enums.app_role, {
  error: 'תפקיד לא תקין',
});
export type AppRole = Database['public']['Enums']['app_role'];

// --- app_settings (admin: clearing toggle + SUMIT provider config) ---
// company id is numeric (digits only) but optional/empty when unset; the keys
// are free strings. sumit_api_key is write-only: blank means "keep existing".
export const appSettingsSchema = z.object({
  payments_enabled: z.boolean(),
  sumit_company_id: z
    .string()
    .trim()
    .regex(/^\d*$/, { error: 'מזהה חברה חייב להכיל ספרות בלבד' }),
  sumit_api_public_key: z.string().trim(),
  sumit_api_key: z.string().trim(),
  // SMS (ExtrA) for OTP at agreement signing. Sender + token are free strings.
  sms_enabled: z.boolean(),
  extra_sms_sender: z.string().trim(),
  extra_sms_token: z.string().trim(),
  // Email (SMTP) for business emails (signed agreement, etc.).
  email_enabled: z.boolean(),
  smtp_host: z.string().trim(),
  smtp_port: z
    .string()
    .trim()
    .regex(/^\d*$/, { error: 'פורט חייב להכיל ספרות בלבד' }),
  smtp_secure: z.boolean(),
  smtp_user: z.string().trim(),
  smtp_password: z.string().trim(),
  smtp_from: z.string().trim(),
});
export type AppSettingsInput = z.infer<typeof appSettingsSchema>;

// --- company / legal details (for the signed agreement) ---
// All free strings; the agreement reads them. A lawyer confirms the wording.
export const companySettingsSchema = z.object({
  company_legal_name: z.string().trim(),
  company_legal_id: z.string().trim(),
  company_legal_address: z.string().trim(),
  company_contact_phone: z.string().trim(),
  company_contact_email: z.string().trim(),
  privacy_url: z.string().trim(),
  terms_url: z.string().trim(),
  warranty_text: z.string().trim(),
});
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

// --- admin user management (platform staff) ---
export const adminUserIdSchema = z.object({
  user_id: z.string().uuid({ error: 'מזהה משתמש לא תקין' }),
});
export type AdminUserIdInput = z.infer<typeof adminUserIdSchema>;

// Grant a benefit (billing credit) on one of the user's events.
export const grantCreditSchema = z.object({
  event_id: z.string().uuid({ error: 'מזהה אירוע לא תקין' }),
  amount: z.coerce.number().positive({ error: 'הסכום חייב להיות חיובי' }),
  reason: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין סיבה' })
    .max(300, { error: 'הסיבה ארוכה מדי' }),
});
export type GrantCreditInput = z.infer<typeof grantCreditSchema>;

// Update the plan: switch the package on a not-yet-paid order.
export const updatePlanSchema = z.object({
  order_id: z.string().uuid({ error: 'מזהה הזמנה לא תקין' }),
  package_id: z.string().uuid({ error: 'מזהה חבילה לא תקין' }),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
