import { z } from 'zod';

import { Constants, type Enums, type Json } from '@/lib/supabase/types';

// Validation for the provider-numbers module (plan §4.2, Phase 1).
//
// ⚠️ THE TWO VOCABULARIES COME FROM THE DATABASE, NOT FROM A LIST TYPED HERE.
// `provider_key` and `provider_number_role` are real Postgres enums, so `Constants`
// is generated from the live schema and `scripts/check-supabase-types.mjs` — the
// first step of `npm run deploy` — blocks a deploy when the two drift. That is the
// whole reason Task 1.1 Step 4 chose enums over `text + CHECK`: an earlier draft of
// this plan added `business_line_inbound` to the SQL, the backfill wrote the row,
// and the hand-maintained TS union stayed at nine values with `tsc` still green.
// A list retyped in this file would reintroduce exactly that gap.

export type ProviderKey = Enums<'provider_key'>;
export type NumberRole = Enums<'provider_number_role'>;

export const PROVIDER_KEYS = Constants.public.Enums.provider_key;
export const NUMBER_ROLES = Constants.public.Enums.provider_number_role;

// Mirrors provider_numbers_e164_chk EXACTLY:
//   CHECK (e164 IS NULL OR e164 ~ '^\+[1-9][0-9]{6,14}$')
// Same shape on both sides so a value that passes here cannot be refused by the
// database with a constraint error the form has no field to attach to.
export const E164_RE = /^\+[1-9]\d{6,14}$/;

export const e164Schema = z
  .string()
  .trim()
  .regex(E164_RE, { error: 'נא להזין מספר בפורמט E.164 (למשל +97233301505)' });

export const providerKeySchema = z.enum(PROVIDER_KEYS, {
  error: 'ספק לא מוכר',
});

export const numberRoleSchema = z.enum(NUMBER_ROLES, {
  error: 'תפקיד לא מוכר',
});

// The provider snapshot is stored in a `jsonb` column and handed to an RPC whose
// generated parameter type is `Json`. Validating it AS Json — rather than as
// `Record<string, unknown>` plus a cast at the call site — means a value that cannot
// survive the round trip (a Date, a function, undefined nested in an array) is
// refused at this boundary with a field error, instead of becoming a cast that
// compiles and a 22P02 at 3am. It also removes the only `as` in the DAL.
const jsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const snapshotSchema = z.record(z.string(), jsonValueSchema);

// provider_numbers_ref_or_e164: CHECK (provider_ref IS NOT NULL OR e164 IS NOT NULL).
// A row identified by neither is unreachable — it can never be matched by a sync
// (which keys on provider_ref) nor by a human reading the list (who reads e164).
export const upsertProviderNumberSchema = z
  .object({
    provider: providerKeySchema,
    providerRef: z.string().trim().max(200).nullable().default(null),
    e164: e164Schema.nullable().default(null),
    displayLabel: z.string().trim().max(120).nullable().default(null),
    isActive: z.boolean().default(true),
    snapshot: snapshotSchema.nullable().default(null),
    source: z.enum(['admin', 'backfill', 'sync']).default('admin'),
  })
  .refine((v) => v.providerRef !== null || v.e164 !== null, {
    error: 'צריך לפחות מזהה אצל הספק או מספר בפורמט E.164',
    path: ['e164'],
  });

export type UpsertProviderNumberInput = z.input<typeof upsertProviderNumberSchema>;
export type UpsertProviderNumber = z.output<typeof upsertProviderNumberSchema>;

export const assignRoleSchema = z.object({
  role: numberRoleSchema,
  numberId: z.uuid({ error: 'מזהה מספר לא תקין' }),
});

// Hebrew labels for the panel. Keyed by the generated enum type, so adding a value
// to the database and regenerating types turns a missing label into a `tsc` error
// rather than a silently blank chip.
export const ROLE_LABELS: Record<NumberRole, string> = {
  whatsapp_rsvp_sender: 'שולח אישורי הגעה (WhatsApp)',
  whatsapp_import_sender: 'קליטת קובץ אורחים (WhatsApp)',
  voice_caller_id_rsvp: 'זיהוי מתקשר — אישורי הגעה',
  voice_caller_id_meeting_confirm: 'זיהוי מתקשר — אישור פגישה',
  voice_caller_id_sales: 'זיהוי מתקשר — מכירות',
  voice_caller_id_call_me_now: 'זיהוי מתקשר — חזרה טלפונית',
  voice_inbound_did: 'מספר נכנס (DID)',
  sms_sender: 'שולח SMS',
  company_contact: 'טלפון החברה (הסכם)',
  business_line_inbound: 'קו העסק — שיחות נכנסות',
};

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  meta_whatsapp: 'WhatsApp (Meta)',
  voximplant: 'Voximplant',
  extra_sms: 'ExtrA SMS',
  company: 'החברה',
};
