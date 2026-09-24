import { z } from 'zod';

import { normalizePhone } from '@/lib/phone';
import { e164Schema } from '@/lib/validation/provider-numbers';
import { phoneNumberIdSchema } from '@/lib/validation/whatsapp-numbers';

// Input shapes for /admin/integrations/owner-agent (plan: owner-whatsapp-agent-plan.md
// §3.3). Every bound below mirrors a CHECK in 20260924034054_owner_agent_whatsapp.sql,
// so a value that passes here cannot be refused by the database with a constraint
// error the form has no field to attach to.

/**
 * app_settings_owner_agent_daily_cap_check: 0..10000.
 *
 * ⚠️ NOT z.coerce.number(). Coercion turns an empty field into 0, and 0 is a real
 * value here — "no runs at all". A cleared input would silently switch the agent off
 * for everyone with no error shown, so emptiness is refused before the number is read.
 */
export const dailyCapSchema = z
  .string()
  .trim()
  .min(1, 'יש להזין מספר')
  .regex(/^\d{1,5}$/, 'יש להזין מספר שלם בין 0 ל-10000')
  .transform((raw) => Number(raw))
  .pipe(
    z
      .number()
      .int()
      .min(0, 'יש להזין מספר שלם בין 0 ל-10000')
      .max(10000, 'יש להזין מספר שלם בין 0 ל-10000'),
  );

/**
 * The number the agent answers on: Meta's phone_number_id (provider_numbers.provider_ref),
 * or '' for "none". Only the SHAPE is checked here — that it is one of OUR WABA numbers
 * is a database question and is answered in the DAL, against provider_numbers.
 */
export const agentNumberSchema = z
  .string()
  .trim()
  .transform((raw) => (raw === '' ? null : raw))
  .pipe(phoneNumberIdSchema.nullable());

/**
 * The allow-listed phone, normalised to E.164 and then held to the table's own check
 * (owner_agent_allowlist_e164_chk, the same pattern as provider_numbers_e164_chk).
 *
 * ⚠️ ONLY '+…' OR A LOCAL '0…' NUMBER IS ACCEPTED. normalizePhone() reads a number
 * with no country code as Israeli, so bare foreign digits become a DIFFERENT, valid
 * Israeli number — measured: '15417543010' (US) parses to '+97215417543010'. On this
 * list that would grant agent access to a stranger's phone, so the ambiguous form is
 * refused rather than guessed at: a number with a '+' is read against its own country,
 * and one starting with '0' is Israeli by the way it was written.
 */
export const allowlistPhoneSchema = z
  .string()
  .trim()
  .min(1, 'יש להזין מספר טלפון')
  .refine((raw) => raw.startsWith('+') || raw.startsWith('0'), {
    error: 'יש להזין מספר עם קידומת מדינה (+972…) או מספר ישראלי שמתחיל ב-0',
  })
  .transform((raw, ctx) => {
    const e164 = normalizePhone(raw);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'מספר טלפון לא תקין' });
      return z.NEVER;
    }
    return e164;
  })
  .pipe(e164Schema);

/** owner_agent_allowlist_label_len: at most 120 characters; '' means no label. */
export const allowlistLabelSchema = z
  .string()
  .trim()
  .max(120, 'התווית ארוכה מדי (עד 120 תווים)')
  .transform((raw) => (raw === '' ? null : raw));

export const allowlistEntryIdSchema = z.uuid({ error: 'מזהה רשומה לא תקין' });

export const addAllowlistEntrySchema = z.object({
  e164: allowlistPhoneSchema,
  staffUserId: z.uuid({ error: 'יש לבחור איש צוות' }),
  label: allowlistLabelSchema,
});

export type AddAllowlistEntryInput = z.input<typeof addAllowlistEntrySchema>;

export const setAllowlistEnabledSchema = z.object({
  id: allowlistEntryIdSchema,
  enabled: z.boolean(),
});

export const relabelAllowlistEntrySchema = z.object({
  id: allowlistEntryIdSchema,
  label: allowlistLabelSchema,
});
