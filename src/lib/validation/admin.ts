import { z } from 'zod';

// Validation schemas and label vocabularies for the admin panel.
//
// Enum-backed columns derive their allowed values from the generated
// `Constants` (single source of truth in supabase/types). `callback_requests.
// status` is a FREE-TEXT column in the database (not a PG enum), so we define a
// closed working vocabulary here and render unknown values with a
// `LABELS[s] ?? s` fallback so legacy/foreign values never break the UI.

import { Constants, type Enums } from '@/lib/supabase/types';

// --- callback_requests.status: SCHEDULING status (free text in DB, CHECK-
// constrained as `callback_requests_status_valid` — mirrors the existing
// triage_status pattern on the same table) ---
//
// Redesigned 2026-08-19/20: the old 4-value vocabulary (new/in_progress/done/
// cancelled) conflated two unrelated things — whether the SCHEDULER booked a
// calendar slot, and whether the OWNER finished handling the customer after
// the call. A request the scheduler successfully booked still showed 'new'
// in the admin list, indistinguishable from one nobody had touched yet, even
// a month later. `status` now describes ONLY the scheduler's side; the
// owner's side is CALL_OUTCOMES below, a fully separate column.
//
// System-driven, not admin-set, except 'cancelled':
//   new             → created, nothing has touched it yet.
//   pending_schedule → claim_callback_triage() or the scheduling sweep has
//                      picked it up; no calendar slot exists yet.
//   scheduled       → calendar_item_id/scheduled_at are set.
//   needs_reschedule → an admin asked to reschedule it (rescheduleCallback);
//                      the old slot is closed, a fresh one is pending.
//   unschedulable   → the scheduler hit a hard failure it cannot resolve on
//                      retry (paired with scheduling_failure_reason).
//   cancelled       → the ONLY value an admin sets directly — the request is
//                      no longer being pursued at all.
//   closed          → system-set (2026-08-20): the request reached a
//                      terminal call_outcome (completed/closed/no_contact —
//                      see applyCallOutcome in callback-scheduling.ts).
//                      Distinct from 'cancelled': nobody proactively stopped
//                      pursuing this — the work is simply done.
export const CALLBACK_STATUSES = [
  'new',
  'pending_schedule',
  'scheduled',
  'needs_reschedule',
  'unschedulable',
  'cancelled',
  'closed',
] as const;

export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

// Is this request still going somewhere, or is it over?
//
// 'terminal' means nothing further will happen to it. The two terminal values
// are terminal in opposite ways — 'cancelled' is someone stopping the pursuit,
// 'closed' is the work being finished — and neither can be cancelled. For
// 'cancelled' there is simply nothing left to cancel; for 'closed' it would be
// actively destructive: cancelCallback flips the badge to 'בוטלה', archives
// the calendar appointment with reason 'cancelled' and writes a
// callback.cancelled activity row, so a call that DID happen would be
// rewritten as one that was called off, with no undo. The legitimate ways back
// out of 'closed' are recording a different call_outcome or rescheduling —
// both re-enter scheduling without falsifying the record.
//
// A full MAP rather than a list of the terminal ones: `Record<CallbackStatus,
// …>` makes an unclassified status a COMPILE ERROR, so a new value cannot be
// added to CALLBACK_STATUSES without someone answering "is it over?". The
// alternative — a list of terminal values plus a comment asking you to
// remember — is exactly the kind of rule that gets skipped. Same idiom as
// CALLBACK_STATUS_LABELS and CALLBACK_STATUS_VARIANTS in data/admin/labels.ts,
// which already force a Hebrew label and a badge tone on every new status;
// this is a third forced answer on the same form.
export const CALLBACK_STATUS_KIND: Record<CallbackStatus, 'live' | 'terminal'> = {
  new: 'live',
  pending_schedule: 'live',
  scheduled: 'live',
  needs_reschedule: 'live',
  unschedulable: 'live',
  cancelled: 'terminal',
  closed: 'terminal',
};

/** Derived, never hand-maintained — one source of truth with the map above. */
export const CALLBACK_TERMINAL_STATUSES = CALLBACK_STATUSES.filter(
  (s) => CALLBACK_STATUS_KIND[s] === 'terminal',
);

/**
 * Is this request over? Takes `string`, not CallbackStatus, and treats an
 * unclassified value as NOT terminal: the column is text (CHECK-constrained,
 * not a PG enum), so a status added by a migration BEFORE this vocabulary is
 * redeployed must stay workable rather than leave a row with no way out — the
 * same graceful fallback the labels use.
 */
export function isTerminalCallbackStatus(status: string): boolean {
  return (CALLBACK_STATUS_KIND as Record<string, string | undefined>)[status] === 'terminal';
}

/**
 * Named for the decision it drives (cancelCallback and the button that shows
 * it) while the underlying question stays "is it over?" — so a caller asking
 * something else, like whether a diary slot is still upcoming, reads
 * isTerminalCallbackStatus directly instead of borrowing this name.
 */
export function isCancellableCallbackStatus(status: string): boolean {
  return !isTerminalCallbackStatus(status);
}

// --- callback_requests.call_outcome: what happened when the owner actually
// made the call — independent of scheduling status. Defaults to 'pending' on
// every row; the admin sets it after (or instead of) making the call. ---
export const CALL_OUTCOMES = [
  'pending',
  'completed',
  'no_answer',
  'needs_followup',
  'closed',
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const callOutcomeEnum = z.enum(CALL_OUTCOMES, {
  error: 'תוצאה לא תקינה',
});

// Form payload for recording the outcome of a call.
export const updateCallOutcomeSchema = z.object({
  id: z.string().uuid({ error: 'מזהה לא תקין' }),
  callOutcome: callOutcomeEnum,
});

// Form payload for cancelling a request outright — the only scheduling-status
// transition an admin makes directly.
export const cancelCallbackSchema = z.object({
  id: z.string().uuid({ error: 'מזהה לא תקין' }),
});

// Form payload for rescheduling a callback to a new admin-chosen instant —
// the caller answered but asked for a different time, or asked to be called
// again later. `exactAt` is an ISO instant built client-side from a
// datetime-local input (same pattern as event-form-fields.tsx: `new
// Date(value).toISOString()`, trusting the admin's own browser is on Israel
// time — the only browser this panel is used from). Must be in the future:
// a past instant would search for a slot that can never be found.
export const rescheduleCallbackSchema = z.object({
  id: z.string().uuid({ error: 'מזהה לא תקין' }),
  exactAt: z
    .string()
    .refine((v) => {
      const ms = Date.parse(v);
      return !Number.isNaN(ms) && ms > Date.now();
    }, 'נא לבחור מועד עתידי תקין'),
});

// --- contact_messages.status: its own independent vocabulary ---
//
// Used to reuse CALLBACK_STATUSES directly ("one inquiry status system, not
// two"). That stopped being true 2026-08-19/20 when callback_requests.status
// was redesigned into a scheduling-specific state machine (pending_schedule/
// scheduled/unschedulable make no sense for a contact-form message, which has
// no scheduler at all) — so contact messages now get their own vocabulary,
// unchanged from what callbacks used to share: the general "has anyone
// handled this" states. `reopened` is a fifth value contact_messages can
// carry (a customer wrote back on an already-answered thread) but is
// system-set only — never offered as a pickable option — see
// CONTACT_ONLY_STATUS_LABELS in labels.ts.
export const CONTACT_STATUSES = ['new', 'in_progress', 'done', 'cancelled'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const contactStatusEnum = z.enum(CONTACT_STATUSES, {
  error: 'סטטוס לא תקין',
});

// Form payload for updating a single contact message's status.
export const updateContactStatusSchema = z.object({
  id: z.string().uuid({ error: 'מזהה לא תקין' }),
  status: contactStatusEnum,
});

// Form payload for sending an email reply to a contact message. The reply body
// is staff-authored free text; capped at 4000 chars (matches the drafter's
// draft_reply cap) so a single email stays reasonable.
export const sendInquiryReplySchema = z.object({
  id: z.string().uuid({ error: 'מזהה לא תקין' }),
  reply: z
    .string()
    .trim()
    .min(1, { error: 'נא לכתוב את תוכן המענה' })
    .max(4000, { error: 'המענה ארוך מדי' }),
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

// Base+overage (plan S4). Nullable like price_per_reached; non-negative, and
// included_reached is a whole count. 0 is valid (base-fee-only tier).
const basePriceField = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? null : v),
  z.union([
    z.null(),
    z.coerce
      .number({ error: 'נא להזין מחיר בסיס תקין' })
      .nonnegative({ error: 'מחיר הבסיס לא יכול להיות שלילי' }),
  ]),
);

const includedReachedField = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? null : v),
  z.union([
    z.null(),
    z.coerce
      .number({ error: 'נא להזין כמות כלולה תקינה' })
      .int({ error: 'הכמות הכלולה חייבת להיות מספר שלם' })
      .nonnegative({ error: 'הכמות הכלולה לא יכולה להיות שלילית' }),
  ]),
);

export const operationalFieldsSchema = z
  .object({
    price_per_reached: pricePerReachedField,
    base_price: basePriceField,
    included_reached: includedReachedField,
    channels: channelsField,
    outreach_schedule: outreachScheduleField,
    min_hold_floor: minHoldFloorField,
    hold_buffer_pct: holdBufferPctField,
  })
  .superRefine((val, ctx) => {
    // base+overage is all-or-nothing: a base with no included tier (or vice
    // versa) is a misconfiguration. Both empty = pure per-reached (fine).
    if ((val.base_price !== null) !== (val.included_reached !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: [val.base_price !== null ? 'included_reached' : 'base_price'],
        message: 'מחיר בסיס וכמות כלולה חייבים להיות מוגדרים יחד (או שניהם ריקים)',
      });
    }
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
export type AppRole = Enums<'app_role'>;

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
  // Inquiry silence follow-up sweep (reminder → warning → auto-close on an
  // inquiry the admin replied to and the customer went quiet on) — its OWN
  // switch, deliberately not sharing outreach_enabled (campaign/WhatsApp
  // master switch — an unrelated system) or email_enabled (would also kill
  // agreement mail and inquiry replies). `.default(false)` on top of the
  // column's own DB default: a fail-closed value even if the field is ever
  // omitted from the submitted form (e.g. mid-rollout of the UI toggle).
  inquiry_followup_enabled: z.boolean().default(false),
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
  // The user the credit is granted to — the server re-checks the chosen event is
  // actually owned by them (never trust the submitted event id on its own).
  user_id: z.string().uuid({ error: 'מזהה משתמש לא תקין' }),
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

// Void (soft-reverse) a granted credit. The data layer re-checks the credit is
// owned by user_id and blocks voiding a credit already consumed by a settled
// charge. There is no in-place edit — a wrong credit is voided + re-granted.
export const voidCreditSchema = z.object({
  credit_id: z.string().uuid({ error: 'מזהה זיכוי לא תקין' }),
  user_id: z.string().uuid({ error: 'מזהה משתמש לא תקין' }),
  reason: z
    .string()
    .trim()
    .min(3, { error: 'נא להזין סיבה לביטול' })
    .max(300, { error: 'הסיבה ארוכה מדי' }),
});
export type VoidCreditInput = z.infer<typeof voidCreditSchema>;

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
