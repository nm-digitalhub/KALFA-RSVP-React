import { z } from 'zod';

import { ISRAELI_PHONE_RE, PROFILE_NAME_MAX } from '@/lib/constants';
// Dependency-free leaf (no `server-only`) — safe to import from this
// client-reachable validation module (edit-event-form.tsx is 'use client').
import { isBeforeTomorrowIL, todayIL } from '@/lib/data/event-date';
import type { Database } from '@/lib/supabase/types';

type EventType = Database['public']['Enums']['event_type'];

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

export const createEventSchema = z
  .object({
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

// Per-kind FORM schemas — what the event forms submit as plain named inputs
// (celebrants.groom, celebrants.bride, ...). Unknown keys are stripped by
// z.object, so a caller may pass all six possible field names and only the
// kind's own fields survive.
const CELEBRANT_FORM_SCHEMA_BY_KIND = {
  couple: z.object({ groom: celebrantNameField, bride: celebrantNameField }),
  single: z.object({ name: celebrantNameField }),
  parents: z.object({ parents: celebrantNameField, child: celebrantNameField }),
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
export type CelebrantFieldKey = 'groom' | 'bride' | 'name' | 'parents' | 'child' | 'names';

const CELEBRANT_FIELD_KEYS_BY_KIND: Record<CelebrantKind, readonly CelebrantFieldKey[]> = {
  couple: ['groom', 'bride'],
  single: ['name'],
  parents: ['parents', 'child'],
  free: ['names'],
};

// What createEvent/updateEvent accept and what is stored in the jsonb column.
// Partial is legal at save (e.g. only groom) — completeness is the campaign
// gate's concern, not the form's.
export type CelebrantsInput =
  | { groom?: string; bride?: string }
  | { name?: string }
  | { parents?: string; child?: string }
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
  parents: z.object({ parents: completeCelebrantName }),
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
  parents: { parents: string; child: string };
  free: { names: string };
};

export type CelebrantFieldLabels = {
  [T in EventType]: CelebrantLabelFieldsByKind[(typeof CELEBRANT_KIND_BY_EVENT_TYPE)[T]];
};

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
