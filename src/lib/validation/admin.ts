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

// --- packages: operational (campaign) fields ---
// `price_per_reached IS NOT NULL` defines a package as "campaign-enabled"
// (plans/admin-packages-operational-fields-plan.md §2). A package with
// price_per_reached=null is a valid, non-campaign package — never forced
// through the campaign-only requirements below.

const MESSAGE_KEY_MAX = 100;
const OUTREACH_SCHEDULE_MAX_ITEMS = 50;

const pricePerReachedField = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? null : v),
  z.union([
    z.null(),
    z.coerce.number({ error: 'נא להזין מחיר לאיש קשר תקין' }),
  ]),
);

const channelsField = z.array(z.enum(Constants.public.Enums.campaign_channel));

export const outreachTouchpointSchema = z.object({
  days_before: z.coerce
    .number({ error: 'נא להזין מספר ימים תקין' })
    .int({ error: 'מספר הימים חייב להיות מספר שלם' })
    .nonnegative({ error: 'מספר הימים לא יכול להיות שלילי' }),
  channel: z.enum(Constants.public.Enums.campaign_channel, { error: 'ערוץ לא תקין' }),
  message_key: z
    .string()
    .trim()
    .min(1, { error: 'נא לבחור תבנית הודעה' })
    .max(MESSAGE_KEY_MAX, { error: 'מזהה התבנית ארוך מדי' }),
});
export type OutreachTouchpointInput = z.infer<typeof outreachTouchpointSchema>;

const outreachScheduleField = z
  .array(outreachTouchpointSchema)
  .max(OUTREACH_SCHEDULE_MAX_ITEMS, { error: 'יותר מדי שלבים בלוח הפניות' });

// Form input is a percent ("10" = +10%); stored value is the fraction (0.1)
// that computeHoldAmount (campaigns.ts) multiplies by directly. The
// conversion happens here, once, so nothing downstream needs to know about
// the percent representation.
const holdBufferPctPercent = z.coerce
  .number({ error: 'נא להזין אחוז buffer תקין (לדוגמה: 10 = תוספת 10%)' })
  .nonnegative({ error: 'האחוז לא יכול להיות שלילי' });
const holdBufferPctField = holdBufferPctPercent.transform((percent) => percent / 100);

// Inverse of holdBufferPctField, for the edit form: stored fraction → percent
// for display. Naive `fraction * 100` leaks IEEE-754 noise for common values
// (0.07 * 100 === 7.000000000000001), so round to 6 decimals — far finer than
// the form's step (0.1) while restoring exactly the percent the admin entered.
export function holdBufferFractionToPercent(fraction: number): number {
  return Math.round(fraction * 100 * 1e6) / 1e6;
}

const minHoldFloorField = z.coerce
  .number({ error: 'נא להזין רצפת hold תקינה' })
  .nonnegative({ error: 'רצפת ה-hold לא יכולה להיות שלילית' });

export const operationalFieldsSchema = z
  .object({
    price_per_reached: pricePerReachedField,
    channels: channelsField,
    outreach_schedule: outreachScheduleField,
    min_hold_floor: minHoldFloorField,
    hold_buffer_pct: holdBufferPctField,
  })
  .superRefine((val, ctx) => {
    const campaignEnabled = val.price_per_reached !== null;
    if (!campaignEnabled) return;
    if (val.price_per_reached !== null && val.price_per_reached <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['price_per_reached'],
        message: 'המחיר לאיש קשר חייב להיות חיובי',
      });
    }
    if (val.channels.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['channels'],
        message: 'יש לבחור לפחות ערוץ אחד למסלול קמפיין',
      });
    }
    if (val.outreach_schedule.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['outreach_schedule'],
        message: 'יש להוסיף לפחות שלב אחד ללוח הפניות',
      });
    }
    val.outreach_schedule.forEach((tp, i) => {
      if (!val.channels.includes(tp.channel)) {
        ctx.addIssue({
          code: 'custom',
          path: ['outreach_schedule', i, 'channel'],
          message: 'הערוץ אינו נכלל בערוצי החבילה',
        });
      }
    });
  });
export type OperationalFieldsInput = z.infer<typeof operationalFieldsSchema>;

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
  close_charge_enabled: z.boolean(),
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

// Viewing ANOTHER user's full detail is a break-glass customer-data read — it
// requires a reason (getUserDetail records the audit row before returning). The
// self-view path never reaches this schema (the page renders the detail
// directly). Same shape/length as the support-view reason.
export const adminUserViewSchema = z.object({
  user_id: z.string().uuid({ error: 'מזהה משתמש לא תקין' }),
  reason: z
    .string()
    .trim()
    .min(10, { error: 'יש לציין סיבה לצפייה (לפחות 10 תווים)' })
    .max(500, { error: 'הסיבה ארוכה מדי' }),
});
export type AdminUserViewInput = z.infer<typeof adminUserViewSchema>;

// Grant a benefit (billing credit) on one of the user's events. campaign_id is
// optional: empty = event-level credit (consumed by the event's campaign at
// close-charge); set = scoped to that specific campaign only.
export const grantCreditSchema = z.object({
  event_id: z.string().uuid({ error: 'מזהה אירוע לא תקין' }),
  campaign_id: z
    .string()
    .uuid({ error: 'מזהה קמפיין לא תקין' })
    .optional()
    .or(z.literal('')),
  amount: z.coerce.number().positive({ error: 'הסכום חייב להיות חיובי' }),
  reason: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין סיבה' })
    .max(300, { error: 'הסיבה ארוכה מדי' }),
});
export type GrantCreditInput = z.infer<typeof grantCreditSchema>;

// --- agreement (contract) document management ---
// --- support access (P3 staff support-access) ---
// Lookup is by EVENT ID (+ optionally the account owner's phone/email) — NOT a
// free guest search. Two separate schemas: finding candidate events (no reason
// needed — it's not a data view yet) vs. actually viewing one (requires the
// break-glass reason). The data layer re-validates the reason length too.
// The lookup surfaces customer PII (event name/date + owner name) and can be
// used to enumerate real customers, so it is treated as a customer-data read:
// it requires the SAME break-glass reason as an event view (data layer audits
// every surfaced event). The reason is required up front, alongside at least
// one lookup key.
export const supportFindSchema = z
  .object({
    event_id: z.string().uuid({ error: 'מזהה אירוע לא תקין' }).optional().or(z.literal('')),
    owner_phone: z.string().trim().max(30).optional().or(z.literal('')),
    owner_email: z.string().trim().email({ error: 'אימייל לא תקין' }).optional().or(z.literal('')),
    reason: z
      .string()
      .trim()
      .min(10, { error: 'יש לציין סיבה לחיפוש (לפחות 10 תווים)' })
      .max(500, { error: 'הסיבה ארוכה מדי' }),
  })
  .refine((v) => v.event_id || v.owner_phone || v.owner_email, {
    error: 'יש להזין מזהה אירוע או טלפון/אימייל של בעל האירוע',
  });
export type SupportFindInput = z.infer<typeof supportFindSchema>;

export const supportViewSchema = z.object({
  event_id: z.string().uuid({ error: 'מזהה אירוע לא תקין' }),
  reason: z
    .string()
    .trim()
    .min(10, { error: 'יש לציין סיבה לצפייה (לפחות 10 תווים)' })
    .max(500, { error: 'הסיבה ארוכה מדי' }),
});
export type SupportViewInput = z.infer<typeof supportViewSchema>;

export const agreementEditSchema = z.object({
  version: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין גרסה' })
    .max(80, { error: 'הגרסה ארוכה מדי' }),
  // The full custom body (HTML with {{tokens}}); empty → use the in-code default.
  body_html: z.string().optional(),
});
export type AgreementEditInput = z.infer<typeof agreementEditSchema>;

export const agreementApproveSchema = z.object({
  version: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין גרסה' })
    .max(80, { error: 'הגרסה ארוכה מדי' }),
});
export type AgreementApproveInput = z.infer<typeof agreementApproveSchema>;
