import { z } from 'zod';

// Input shapes for the proactive-report section of /admin/integrations/owner-agent
// (plans/owner-agent-chat-sdk-capabilities-plan.md §4.8). Owner decision 27.9: the
// schedule is set ONLY here — there is no agent write tool. Every bound mirrors a CHECK
// in 20260927011338_owner_agent_capabilities.sql, so a value that passes cannot be
// refused by the database with an error the form has no field for.

/** Every message the reports DAL throws on purpose — the only ones an action shows. */
export const OWNER_AGENT_REPORT_ERRORS = {
  readFailed: 'טעינת הגדרות הדוחות נכשלה',
  runsReadFailed: 'טעינת יומן הדוחות נכשלה',
  switchFailed: 'עדכון מתג הדוחות נכשל',
  templateSaveFailed: 'שמירת התבנית נכשלה',
  scheduleSaveFailed: 'שמירת לוח הזמנים נכשלה',
  entryNotFound: 'הרשומה לא נמצאה',
} as const;

const KNOWN_ERRORS: ReadonlySet<string> = new Set(Object.values(OWNER_AGENT_REPORT_ERRORS));

/** True only for a message the reports DAL wrote for the owner — an exact match. */
export function isOwnerAgentReportUserError(message: string): boolean {
  return KNOWN_ERRORS.has(message);
}

/**
 * A slot is any whole-minute time, Israel time (owner decision 27.9: no fixed menu).
 * The column is `time` with a seconds = 0 CHECK; this is its HH:MM form.
 */
const SLOT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The owner's request of 25.9: a report at 08:00 and at 00:00. Offered for a row with no schedule yet. */
export const DEFAULT_REPORT_SLOTS = ['08:00', '00:00'] as const;

/** A sanity limit on times per row (Zod only — the database has none). */
export const MAX_REPORT_SLOTS = 24;

/** The zone every schedule written here is in. */
export const REPORT_TIMEZONE = 'Asia/Jerusalem';

export const reportSlotSchema = z.string().trim().regex(SLOT_PATTERN, 'שעה לא תקינה (HH:MM)');

/**
 * owner_agent_report_subscription_instructions_len: 1..2000 after trimming; '' = none
 * (the deterministic report). With instructions the report is written by the model.
 */
export const MAX_REPORT_INSTRUCTIONS = 2000;
export const reportInstructionsSchema = z
  .string()
  .trim()
  .max(MAX_REPORT_INSTRUCTIONS, `ההנחיות ארוכות מדי (עד ${MAX_REPORT_INSTRUCTIONS} תווים)`)
  .transform((raw) => (raw === '' ? null : raw));

/** One subscription: a time and its optional instructions. */
export const reportSlotEntrySchema = z.object({
  time: reportSlotSchema,
  instructions: reportInstructionsSchema,
});

export const reportScheduleSchema = z
  .object({
    entryId: z.uuid({ error: 'מזהה רשומה לא תקין' }),
    optIn: z.boolean(),
    slots: z
      .array(reportSlotEntrySchema)
      .max(MAX_REPORT_SLOTS, `אפשר להגדיר עד ${MAX_REPORT_SLOTS} שעות`)
      .refine((slots) => new Set(slots.map((s) => s.time)).size === slots.length, { error: 'שעה הוגדרה פעמיים' }),
  })
  .refine((v) => !v.optIn || v.slots.length > 0, {
    error: 'כדי לקבל דוחות יש לבחור לפחות שעה אחת',
    path: ['slots'],
  });

export type ReportScheduleInput = z.input<typeof reportScheduleSchema>;

/** app_settings_owner_agent_report_template_name_check; '' = no template (no out-of-window report). */
export const reportTemplateNameSchema = z
  .string()
  .trim()
  .transform((raw) => (raw === '' ? null : raw))
  .pipe(
    z
      .string()
      .regex(/^[a-z0-9_]{1,512}$/, 'שם תבנית: אותיות לטיניות קטנות, ספרות וקו תחתון בלבד')
      .nullable(),
  );

/** app_settings_owner_agent_report_template_lang_check; '' = Hebrew (the handler's default). */
export const reportTemplateLangSchema = z
  .string()
  .trim()
  .transform((raw) => (raw === '' ? null : raw))
  .pipe(
    z
      .string()
      .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'קוד שפה לא תקין (למשל he או en_US)')
      .nullable(),
  );

export const reportTemplateSchema = z.object({
  templateName: reportTemplateNameSchema,
  templateLang: reportTemplateLangSchema,
});

export type ReportTemplateInput = z.input<typeof reportTemplateSchema>;
