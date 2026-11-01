'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  setOwnerAgentCustomReportTemplate,
  setOwnerAgentReportSchedule,
  setOwnerAgentReportTemplate,
  setOwnerAgentReportsEnabled,
} from '@/lib/data/admin/owner-agent-reports';
import {
  isOwnerAgentReportUserError,
  reportScheduleSchema,
  reportTemplateSchema,
} from '@/lib/validation/owner-agent-reports';
import { actionClient, returnUserError } from '@/lib/safe-action';

// The proactive-report actions of /admin/integrations/owner-agent, in their own file so
// the allow-list actions (actions.ts) stay as they are. Same shape as those: validate →
// owner gate (outside the try, so its redirect is never turned into a form error) → DAL
// → a safe Hebrew result. Activity rows are written by the DAL.

const OWNER_AGENT = '/admin/integrations/owner-agent';

/** Only a message the reports DAL wrote for the owner reaches the screen (exact match). */
function safeMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  return isOwnerAgentReportUserError(message) ? message : fallback;
}

// A name + language pair, each read as `formData.get(name) ?? ''` (an absent field is '':
// "no template" / Hebrew).
const templateInput = zfd.formData({
  templateName: reportTemplateSchema.shape.templateName.prefault(''),
  templateLang: reportTemplateSchema.shape.templateLang.prefault(''),
});

// Each time row posts `slots` and `instructions` side by side, in order. A row whose time
// was emptied is dropped rather than refused.
function readScheduleForm(formData: FormData) {
  const times = formData.getAll('slots').map((v) => String(v).trim());
  const texts = formData.getAll('instructions').map(String);
  return {
    entryId: formData.get('entryId'),
    optIn: formData.get('optIn') === 'on',
    slots: times
      .map((time, i) => ({ time, instructions: texts[i] ?? '' }))
      .filter((s) => s.time !== ''),
  };
}

const scheduleInput = z.instanceof(FormData).pipe(z.preprocess(readScheduleForm, reportScheduleSchema));

export const setOwnerAgentReportsEnabledAction = actionClient
  // A checkbox posts 'on' when ticked and nothing when not.
  .inputSchema(zfd.formData({ owner_agent_reports_enabled: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { owner_agent_reports_enabled: enabled } }) => {
    await requirePlatformOwner();
    try {
      await setOwnerAgentReportsEnabled(enabled);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'עדכון מתג הדוחות נכשל'));
    }

    revalidatePath(OWNER_AGENT);
    return { notice: enabled ? 'הדוחות הופעלו' : 'הדוחות כובו' };
  });

export const setOwnerAgentReportTemplateAction = actionClient
  .inputSchema(templateInput)
  .stateAction(async ({ parsedInput: { templateName, templateLang } }) => {
    await requirePlatformOwner();
    try {
      // The DAL re-parses, so it gets the input shape ('' for none).
      await setOwnerAgentReportTemplate({ templateName: templateName ?? '', templateLang: templateLang ?? '' });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'שמירת התבנית נכשלה'));
    }

    revalidatePath(OWNER_AGENT);
    return { notice: templateName ? 'התבנית נשמרה' : 'התבנית נוקתה — מחוץ לחלון 24 השעות לא יישלח דוח' };
  });

/** The instructions report's template: the same form and rules, its own columns. */
export const setOwnerAgentCustomReportTemplateAction = actionClient
  .inputSchema(templateInput)
  .stateAction(async ({ parsedInput: { templateName, templateLang } }) => {
    await requirePlatformOwner();
    try {
      await setOwnerAgentCustomReportTemplate({ templateName: templateName ?? '', templateLang: templateLang ?? '' });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'שמירת התבנית נכשלה'));
    }

    revalidatePath(OWNER_AGENT);
    return {
      notice: templateName
        ? 'התבנית נשמרה'
        : 'התבנית נוקתה — מחוץ לחלון 24 השעות יישלח הדוח הרגיל במקום הדוח לפי ההנחיות',
    };
  });

export const setOwnerAgentReportScheduleAction = actionClient
  .inputSchema(scheduleInput)
  .stateAction(async ({ parsedInput }) => {
    await requirePlatformOwner();
    try {
      // The DAL re-parses, so it gets the input shape ('' for no instructions).
      await setOwnerAgentReportSchedule({
        ...parsedInput,
        slots: parsedInput.slots.map((s) => ({ time: s.time, instructions: s.instructions ?? '' })),
      });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'שמירת לוח הזמנים נכשלה'));
    }

    revalidatePath(OWNER_AGENT);
    return { notice: parsedInput.optIn ? 'לוח הזמנים נשמר' : 'הדוחות לרשומה הזו כובו' };
  });
