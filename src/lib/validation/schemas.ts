import { z } from 'zod';

import { ISRAELI_PHONE_RE, PROFILE_NAME_MAX } from '@/lib/constants';
// Dependency-free leaf (no `server-only`) — safe to import from this
// client-reachable validation module (edit-event-form.tsx is 'use client').
import { isBeforeTomorrowIL, todayIL } from '@/lib/data/event-date';
import type { Enums } from '@/lib/supabase/types';
type EventType = Enums<'event_type'>;

// Auth
// Shared field schemas — a single source reused across login / signup / reset so
// the email + strong-password rules never drift between forms. `email` trims
// first so a stray leading/trailing space is not rejected. Login only needs a
// non-empty password, so it keeps its own min(1) rule below.
const emailField = z.string().trim().pipe(z.email({ error: 'כתובת אימייל לא תקינה' }));
// Mirrors Supabase Auth's live project config (password_min_length +
// password_required_characters, verified via the Management API — the
// project's own auth.signUp() rejects anything weaker regardless of this
// schema). Kept here so a violation surfaces as a field error before the
// request ever reaches Supabase, instead of a generic "signup failed".
// Exported so the signup UI's live requirements checklist (password-strength.ts)
// checks the exact same set instead of drifting from it independently.
export const PASSWORD_SPECIAL_CHARS = new Set(
  '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~'.split(''),
);
const newPasswordField = z
  .string()
  .min(8, { error: 'הסיסמה חייבת לכלול לפחות 8 תווים' })
  .max(72, { error: 'הסיסמה ארוכה מדי' })
  .refine((v) => /[a-z]/.test(v), { error: 'הסיסמה חייבת לכלול אות קטנה (a-z)' })
  .refine((v) => /[A-Z]/.test(v), { error: 'הסיסמה חייבת לכלול אות גדולה (A-Z)' })
  .refine((v) => /[0-9]/.test(v), { error: 'הסיסמה חייבת לכלול ספרה' })
  .refine((v) => [...v].some((c) => PASSWORD_SPECIAL_CHARS.has(c)), {
    error: 'הסיסמה חייבת לכלול תו מיוחד (למשל !@#$%)',
  });

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, { error: 'נא להזין סיסמה' }),
});

export const signupSchema = z.object({
  email: emailField,
  password: newPasswordField,
  // Collected at signup and written to the profile by the handle_new_user()
  // trigger (via auth metadata). full_name is required; phone is optional and,
  // when present, validated against the Israeli numbering plan.
  full_name: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין שם מלא' })
    .max(PROFILE_NAME_MAX, { error: 'השם ארוך מדי' }),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || ISRAELI_PHONE_RE.test(v), {
      error: 'מספר טלפון לא תקין',
    })
    .optional()
    .or(z.literal('')),
  // Sales-closing-agent conversion tracking (?ref= on /auth/signup — a
  // sales_call_attempts.id, not a credential). Optional and never
  // user-facing; a malformed value here just means no attribution, never a
  // signup failure — existence is re-verified server-side (see actions.ts)
  // before it is ever trusted.
  ref: z.uuid().optional().or(z.literal('')),
  // A checkbox is absent from FormData entirely when unchecked (not "off"),
  // so an unset field is what makes this required — the client-side
  // `required` attribute is a UX nicety, this is the real gate.
  terms_accepted: z
    .string()
    .refine((v) => v === 'on', {
      error: 'יש לאשר את תנאי השימוש ומדיניות הפרטיות כדי להמשיך',
    }),
});

// Password reset (forgot-password → recovery email → set new password), built
// from the shared emailField + newPasswordField above — no duplicated rules.
export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: newPasswordField,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    error: 'הסיסמאות אינן תואמות',
    path: ['confirm'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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

export const createEventSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: 'נא להזין שם אירוע' })
      .max(200, { error: 'שם האירוע ארוך מדי' }),
    event_type: z.enum(EVENT_TYPES, { error: 'נא לבחור סוג אירוע' }),
    event_date: z.string().trim().optional().or(z.literal('')),
    event_time: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'שעה לא תקינה' })
      .optional()
      .or(z.literal('')),

    venue_name: z
      .string()
      .trim()
      .max(200, { error: 'שם המקום ארוך מדי' })
      .optional()
      .or(z.literal('')),
  })
  // R2: event_date is NULL/'' (legal, a date-less draft) or >= tomorrow
  // (Israel calendar day) — mirrors the DB trigger events_before_insert.
  .refine((v) => !v.event_date || !isBeforeTomorrowIL(v.event_date), {
    error: 'מועד האירוע חייב להיות החל ממחר',
    path: ['event_date'],
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
  event_time: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'שעה לא תקינה' })
    .optional()
    .or(z.literal('')),

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
  // The owner's own PayBox/Bit gift link (per-event business data). https-only
  // — mirrors the DB CHECK events_gift_payment_url_https.
  gift_payment_url: z
    .string()
    .trim()
    .max(500, { error: 'קישור המתנה ארוך מדי' })
    .refine((v) => v === '' || /^https:\/\//i.test(v), {
      error: 'קישור המתנה חייב להתחיל ב־https://',
    })
    .optional()
    .or(z.literal('')),
  // Public-RSVP meal-preference toggle. The action derives the boolean from
  // checkbox PRESENCE (formData.has); default true keeps the field collected
  // when the key is absent (older callers/tests).
  show_meal_pref: z.boolean().default(true),
})
  // A deadline without an event date is meaningless. Mirrors the DB invariant
  // (events_rsvp_deadline_within_event: a deadline requires an event_date).
  .refine((v) => !v.rsvp_deadline || Boolean(v.event_date), {
    error: 'יש להזין תאריך אירוע כדי לקבוע מועד אחרון לאישור הגעה',
    path: ['rsvp_deadline'],
  })
  // The last RSVP date cannot fall after the event itself (boundary inclusive
  // — same-day is legal). Both inputs are <input type="date"> → 'YYYY-MM-DD',
  // so a lexical compare is chronological; slice(0,10) defends against a full
  // ISO event_date. Mirrors the DB CHECK rsvp_deadline <= event_day
  // (Asia/Jerusalem) so the UX message lands first.
  .refine(
    (v) =>
      !v.rsvp_deadline ||
      !v.event_date ||
      v.rsvp_deadline <= v.event_date.slice(0, 10),
    {
      error: 'המועד האחרון לאישור הגעה חייב לחול עד יום האירוע, כולל.',
      path: ['rsvp_deadline'],
    },
  )
  // R2: event_date is NULL/'' (legal while draft) or >= tomorrow (Israel).
  // Locked once non-draft (R5) — enforced at the DB/data layer, not here (this
  // schema has no `status` field to branch on; see events.ts's key-presence
  // guard for the non-draft reject path).
  .refine((v) => !v.event_date || !isBeforeTomorrowIL(v.event_date), {
    error: 'מועד האירוע חייב להיות החל ממחר',
    path: ['event_date'],
  })
  // R2b (NEW — found live on ec7c68d1, 2026-07-01): rsvp_deadline must not
  // already be in the past. Lower bound is >= TODAY (Israel), NOT >= tomorrow
  // — same-day is legal. The CHECK events_rsvp_deadline_within_event (the
  // upper-bound refine above) is untouched; this is purely additive.
  .refine((v) => !v.rsvp_deadline || v.rsvp_deadline >= todayIL(), {
    error: 'המועד האחרון לאישור הגעה לא יכול להיות בעבר.',
    path: ['rsvp_deadline'],
  });

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// --- Celebrants (בעלי שמחה) ---
// Per-event-type celebrant names stored in events.celebrants (schemaless
// jsonb; see the column comment). Storage has NO kind discriminator —
// event_type IS the key: four shape kinds cover the nine event types.
// Form-level, every field is OPTIONAL (an event saves fine without/with
// partial celebrants); completeness is enforced ONLY by the campaign
// enablement gate via celebrantsCompleteFor().

export type CelebrantKind = 'couple' | 'single' | 'parents' | 'free';

// The Hebrew invitation for a brit/britah (kind 'parents') is written in the
// FIRST PERSON from the host(s), so the verb + possessive conjugate by WHO is
// inviting — data a free-text `parents` string cannot carry. This discriminator
// drives the WhatsApp composer: single_mother → מתכבדת·בני·עמי, single_father →
// מתכבד·בני·עמי, couple → מתכבדים·בננו·עמנו.
export const HOST_COMPOSITIONS = ['single_mother', 'single_father', 'couple'] as const;
export type HostComposition = (typeof HOST_COMPOSITIONS)[number];

// EXHAUSTIVE over the event_type enum — adding/removing an enum value is a
// compile error here (same guarantee as EVENT_TYPE_LABELS). `as const
// satisfies` keeps each per-type literal kind so CelebrantFieldLabels below
// can map every event type to exactly its kind's field set.
export const CELEBRANT_KIND_BY_EVENT_TYPE = {
  wedding: 'couple',
  bar_mitzvah: 'single',
  bat_mitzvah: 'single',
  brit: 'parents',
  britah: 'parents',
  henna: 'couple',
  engagement: 'couple',
  birthday: 'single',
  other: 'free',
} as const satisfies Record<EventType, CelebrantKind>;

// One celebrant name input: trimmed, bounded, and optional at create/edit —
// '' (an input left empty) is legal; parseCelebrantsForm maps it away.
const celebrantNameField = z
  .string()
  .trim()
  .max(120, { error: 'השם ארוך מדי' })
  .optional()
  .or(z.literal(''));

// host_composition (parents kind only) — an enum select, optional at save like
// the name fields ('' = not chosen yet); REQUIRED only at the campaign gate.
const hostCompositionField = z.enum(HOST_COMPOSITIONS).optional().or(z.literal(''));

// Per-kind FORM schemas — what the event forms submit as plain named inputs
// (celebrants.groom, celebrants.bride, ...). Unknown keys are stripped by
// z.object, so a caller may pass all six possible field names and only the
// kind's own fields survive.
const CELEBRANT_FORM_SCHEMA_BY_KIND = {
  couple: z.object({ groom: celebrantNameField, bride: celebrantNameField }),
  single: z.object({ name: celebrantNameField }),
  parents: z.object({
    parents: celebrantNameField,
    child: celebrantNameField,
    host_composition: hostCompositionField,
  }),
  free: z.object({ names: celebrantNameField }),
} as const;

// The celebrant form schema for an event type (the name is promised by the
// events.celebrants column comment). Generic so a LITERAL event type resolves
// to its kind's exact schema (precise .shape/.safeParse typing); a plain
// EventType still yields the union of the four.
export function celebrantsSchemaFor<T extends EventType>(eventType: T) {
  return CELEBRANT_FORM_SCHEMA_BY_KIND[CELEBRANT_KIND_BY_EVENT_TYPE[eventType]];
}

// Every field name across the four kinds.
export type CelebrantFieldKey =
  | 'groom'
  | 'bride'
  | 'name'
  | 'parents'
  | 'child'
  | 'names'
  | 'host_composition';

export const CELEBRANT_FIELD_KEYS_BY_KIND: Record<
  CelebrantKind,
  readonly CelebrantFieldKey[]
> = {
  couple: ['groom', 'bride'],
  single: ['name'],
  parents: ['parents', 'child', 'host_composition'],
  free: ['names'],
};

// Every celebrant field name, DERIVED from the per-kind map above rather than
// listed again — the two cannot drift apart.
export const ALL_CELEBRANT_FIELD_KEYS: readonly CelebrantFieldKey[] = [
  ...new Set(Object.values(CELEBRANT_FIELD_KEYS_BY_KIND).flat()),
];

// Pull every celebrant input out of a submitted form. The event forms post them
// as plain named inputs (`celebrants.groom`, `celebrants.host_composition`, …);
// the submitted event_type's schema then keeps only its own kind's fields, since
// z.object strips unknown keys. A field the current kind does not render is
// simply absent → undefined, which the optional fields accept.
//
// This lives here, beside the key map it iterates, because it used to be
// hand-written TWICE — once in the create action and once in the edit action —
// and both copies listed the field names literally. When host_composition was
// added for the brit flow, the schema, the form and the storage shape all
// learned about it and neither reader did, so "הרכב המזמינים" was silently
// dropped on BOTH create and edit: the select posted a value, Zod never saw the
// key, parseCelebrantsForm found nothing to store, and the event came back
// showing "בחרו…" with no error anywhere. Deriving the list from
// CELEBRANT_FIELD_KEYS_BY_KIND means a future field is picked up by definition.
export function readCelebrantsForm(
  formData: FormData,
): Partial<Record<CelebrantFieldKey, FormDataEntryValue>> {
  return Object.fromEntries(
    ALL_CELEBRANT_FIELD_KEYS.map((key) => [
      key,
      formData.get(`celebrants.${key}`) ?? undefined,
    ]),
  );
}

// The celebrant fields REQUIRED for completeness per kind — mirrors
// CELEBRANT_COMPLETE_SCHEMA_BY_KIND (the campaign-enablement gate). The edit
// form marks exactly these `required` while an operational campaign exists, so the
// browser blocks a save that would drop a value every pending send binds (host
// signature/composition, both partners, …). `child` stays optional (not here).
export const CELEBRANT_REQUIRED_FIELD_KEYS_BY_KIND: Record<
  CelebrantKind,
  readonly CelebrantFieldKey[]
> = {
  couple: ['groom', 'bride'],
  single: ['name'],
  parents: ['parents', 'host_composition'],
  free: ['names'],
};

// What createEvent/updateEvent accept and what is stored in the jsonb column.
// Partial is legal at save (e.g. only groom) — completeness is the campaign
// gate's concern, not the form's.
export type CelebrantsInput =
  | { groom?: string; bride?: string }
  | { name?: string }
  | { parents?: string; child?: string; host_composition?: HostComposition }
  | { names?: string };

// The validated output of celebrantsSchemaFor(...).safeParse — fields
// trimmed, possibly '' (input left empty) or undefined (not posted).
export type CelebrantsFormValues = z.infer<
  (typeof CELEBRANT_FORM_SCHEMA_BY_KIND)[CelebrantKind]
>;

// Normalise VALIDATED form values into the stored shape: reads ONLY the
// submitted event type's fields (a stale other-kind value can never leak into
// storage on an event_type change), maps '' → key omitted, and returns null
// when every field is empty — the column stores NULL, never {}.
export function parseCelebrantsForm(
  eventType: EventType,
  values: CelebrantsFormValues,
): CelebrantsInput | null {
  const source = values as Partial<Record<CelebrantFieldKey, string>>;
  const out: Partial<Record<CelebrantFieldKey, string>> = {};
  for (const key of CELEBRANT_FIELD_KEYS_BY_KIND[CELEBRANT_KIND_BY_EVENT_TYPE[eventType]]) {
    // Defensive re-trim (values normally arrive trimmed from the schema) so a
    // whitespace-only value can never count as "filled".
    const value = source[key]?.trim();
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as CelebrantsInput) : null;
}

// Campaign-gate completeness per kind: couple → groom+bride, single → name,
// parents → parents (child stays optional), free → names. These schemas
// validate the RAW stored jsonb defensively — null, a string, a different
// kind's shape left over from an event_type change: all simply "incomplete".
const completeCelebrantName = z.string().trim().min(1);

const CELEBRANT_COMPLETE_SCHEMA_BY_KIND: Record<CelebrantKind, z.ZodType> = {
  couple: z.object({ groom: completeCelebrantName, bride: completeCelebrantName }),
  single: z.object({ name: completeCelebrantName }),
  parents: z.object({
    parents: completeCelebrantName,
    host_composition: z.enum(HOST_COMPOSITIONS),
  }),
  free: z.object({ names: completeCelebrantName }),
};

// True when the stored celebrants value satisfies the event type's kind —
// the ONLY place celebrants become required (campaign enablement).
export function celebrantsCompleteFor(eventType: EventType, value: unknown): boolean {
  return CELEBRANT_COMPLETE_SCHEMA_BY_KIND[CELEBRANT_KIND_BY_EVENT_TYPE[eventType]].safeParse(
    value,
  ).success;
}

// Field-label SHAPE per event type (the Hebrew labels themselves live in
// src/lib/data/event-labels.ts — CELEBRANT_FIELD_LABELS). Mapped through the
// literal kinds above so a wrong, missing, or extra field label is a compile
// error, not a silently-broken form.
type CelebrantLabelFieldsByKind = {
  couple: { groom: string; bride: string };
  single: { name: string };
  parents: { parents: string; child: string; host_composition: string };
  free: { names: string };
};

export type CelebrantFieldLabels = {
  [T in EventType]: CelebrantLabelFieldsByKind[(typeof CELEBRANT_KIND_BY_EVENT_TYPE)[T]];
};

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

// Exchange (IONOS Hosted EWS) calendar connection — /app/settings, Stage 1 of
// plans/exchange-ews-stage1.md. `password` has a generous max only (not a
// strength rule) — it is the owner's EXISTING mailbox password, not a new
// KALFA credential, so it must not be silently rejected for being long.
// `password` is OPTIONAL because only the EWS path has any use for it. Graph
// authenticates as the application with a certificate and never reads a mailbox
// secret, so requiring one here forced an admin to hand over a live password to
// create a connection that would not use it. The DAL rejects an empty password
// when EWS is genuinely the active provider — the requirement moved to where the
// answer is actually known, rather than being asserted at the form boundary.
export const createExchangeConnectionSchema = z.object({
  mailboxEmail: z.string().trim().pipe(z.email({ error: 'כתובת אימייל לא תקינה' })),
  password: z.string().max(256, { error: 'הסיסמה ארוכה מדי' }).optional(),
});
export type CreateExchangeConnectionInput = z.infer<typeof createExchangeConnectionSchema>;

export const exchangeConnectionIdSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
});

export const exchangeTestAppointmentIdSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
  appointmentId: z.string().trim().min(1, { error: 'מזהה פגישה חסר' }),
});

// Shared pieces for the calendar dialogs (create + edit share the same
// field set, so the rules live in one place).
const showAsEnum = z.enum(['free', 'tentative', 'busy', 'oof', 'working_elsewhere'], {
  error: 'ערך "הצג כ" לא תקין',
});
const sensitivityEnum = z.enum(['normal', 'personal', 'private', 'confidential'], {
  error: 'רמת פרטיות לא תקינה',
});
// Attendees receive REAL invitations, so the address is validated strictly.
const attendeeSchema = z.object({
  email: z.string().trim().pipe(z.email({ error: 'כתובת אימייל לא תקינה' })),
  name: z.string().trim().max(120).optional(),
  optional: z.boolean().optional(),
});
const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly'], { error: 'תדירות לא תקינה' }),
  interval: z.number().int().min(1).max(99, { error: 'מרווח החזרה גדול מדי' }),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  month: z.number().int().min(1).max(12).optional(),
  occurrences: z.number().int().min(1).max(999).optional(),
  endDateIso: z.iso.datetime({ offset: true }).optional(),
});

// /admin/calendar. ISO datetimes travel as strings between the client
// calendar and the Server Actions; EWS ItemIds are long opaque base64-ish
// strings (measured well under 1kB) — bounded, never interpolated anywhere.
const isoInstant = z.iso.datetime({ offset: true, error: 'תאריך לא תקין' });

export const calendarRangeSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
  startIso: isoInstant,
  endIso: isoInstant,
});

export const calendarCreateEventSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
  subject: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין כותרת לאירוע' })
    .max(255, { error: 'הכותרת ארוכה מדי' }),
  startIso: isoInstant,
  endIso: isoInstant,
  allDay: z.boolean(),
  // Same optional-rich fields as the edit form, so an event can be created
  // complete instead of created-then-edited.
  location: z.string().trim().max(255, { error: 'המיקום ארוך מדי' }).optional(),
  body: z.string().max(5000, { error: 'התיאור ארוך מדי' }).optional(),
  reminderMinutes: z
    .number()
    .int()
    .min(0)
    .max(10080, { error: 'זמן התזכורת ארוך מדי' })
    .optional(),
  showAs: showAsEnum.optional(),
  sensitivity: sensitivityEnum.optional(),
  category: z.string().trim().max(64, { error: 'שם הקטגוריה ארוך מדי' }).optional(),
  // Non-empty ⇒ Exchange dispatches real invitations by email.
  attendees: z.array(attendeeSchema).max(50, { error: 'יותר מדי משתתפים' }).optional(),
  // Recurrence is settable at creation only (editing a series is out of
  // scope — series items are read-only, matching the calendar UI).
  recurrence: recurrenceSchema.optional(),
});

// Availability status (avatar menu). The owner picks a preset + a window;
// no free text ever reaches Exchange — the label/subject come from a fixed
// server-side vocabulary (src/lib/data/exchange-availability.ts).
export const availabilityBlockSchema = z.object({
  showAs: z.enum(['busy', 'oof', 'working_elsewhere', 'tentative'], {
    error: 'סטטוס לא תקין',
  }),
  startsAtIso: isoInstant,
  endsAtIso: isoInstant,
});

export const availabilityBlockIdSchema = z.object({
  blockId: z.uuid({ error: 'מזהה סטטוס לא תקין' }),
});

export const calendarUpdateEventSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
  appointmentId: z.string().trim().min(1).max(1024, { error: 'מזהה פגישה לא תקין' }),
  startIso: isoInstant,
  endIso: isoInstant,
  // Every field below is sent ONLY by the edit dialog; a drag/resize omits
  // them, and omission means "leave as is in Exchange" (never "clear").
  subject: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין כותרת לאירוע' })
    .max(255, { error: 'הכותרת ארוכה מדי' })
    .optional(),
  location: z.string().trim().max(255, { error: 'המיקום ארוך מדי' }).optional(),
  body: z.string().max(5000, { error: 'התיאור ארוך מדי' }).optional(),
  allDay: z.boolean().optional(),
  // 0 = no reminder; capped at a week so a typo cannot create an absurd alarm.
  reminderMinutes: z
    .number()
    .int()
    .min(0)
    .max(10080, { error: 'זמן התזכורת ארוך מדי' })
    .optional(),
  showAs: showAsEnum.optional(),
  sensitivity: sensitivityEnum.optional(),
  category: z.string().trim().max(64, { error: 'שם הקטגוריה ארוך מדי' }).optional(),
  attendees: z.array(attendeeSchema).max(50, { error: 'יותר מדי משתתפים' }).optional(),
});

/** The connection alone — for reads that are about the mailbox, not an item. */
export const calendarConnectionSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
});

export const calendarEventIdSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
  appointmentId: z.string().trim().min(1).max(1024, { error: 'מזהה פגישה לא תקין' }),
});

export const calendarDeleteEventSchema = z.object({
  connectionId: z.uuid({ error: 'מזהה חיבור לא תקין' }),
  appointmentId: z.string().trim().min(1).max(1024, { error: 'מזהה פגישה לא תקין' }),
});

// Organizations & members (multi-tenant layer). role_id is a uuid into
// public.org_roles — the actual role/permission set is validated server-side
// against the DB (never trusted from the browser), so these schemas only check
// shape. Hebrew messages match the project's form conventions.
export const orgNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'נא להזין שם ארגון' })
    .max(120, { error: 'שם הארגון ארוך מדי' }),
});
export type OrgNameInput = z.infer<typeof orgNameSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().pipe(z.email({ error: 'כתובת אימייל לא תקינה' })),
  role_id: z.string().uuid({ error: 'תפקיד לא תקין' }),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const changeMemberRoleSchema = z.object({
  member_id: z.string().uuid({ error: 'מזהה חבר לא תקין' }),
  role_id: z.string().uuid({ error: 'תפקיד לא תקין' }),
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const memberIdSchema = z.object({
  member_id: z.string().uuid({ error: 'מזהה חבר לא תקין' }),
});
export type MemberIdInput = z.infer<typeof memberIdSchema>;

export const invitationIdSchema = z.object({
  invitation_id: z.string().uuid({ error: 'מזהה הזמנה לא תקין' }),
});
export type InvitationIdInput = z.infer<typeof invitationIdSchema>;

export const activeOrgSchema = z.object({
  org_id: z.string().uuid({ error: 'מזהה ארגון לא תקין' }),
});
export type ActiveOrgInput = z.infer<typeof activeOrgSchema>;
