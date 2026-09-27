'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  setOwnerAgentReportSchedule,
  setOwnerAgentReportTemplate,
  setOwnerAgentReportsEnabled,
} from '@/lib/data/admin/owner-agent-reports';
import {
  isOwnerAgentReportUserError,
  reportScheduleSchema,
  reportTemplateSchema,
} from '@/lib/validation/owner-agent-reports';
import { issuesToFieldErrors, type FormState } from '@/lib/validation/result';

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

export async function setOwnerAgentReportsEnabledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // A checkbox posts 'on' when ticked and nothing when not.
  const enabled = formData.get('owner_agent_reports_enabled') === 'on';

  await requirePlatformOwner();
  try {
    await setOwnerAgentReportsEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'עדכון מתג הדוחות נכשל') };
  }

  revalidatePath(OWNER_AGENT);
  return { notice: enabled ? 'הדוחות הופעלו' : 'הדוחות כובו' };
}

export async function setOwnerAgentReportTemplateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = {
    templateName: String(formData.get('templateName') ?? ''),
    templateLang: String(formData.get('templateLang') ?? ''),
  };
  const parsed = reportTemplateSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };

  await requirePlatformOwner();
  try {
    // The DAL re-parses (it has callers other than this form), so it gets the raw strings.
    await setOwnerAgentReportTemplate(raw);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'שמירת התבנית נכשלה') };
  }

  revalidatePath(OWNER_AGENT);
  return { notice: parsed.data.templateName ? 'התבנית נשמרה' : 'התבנית נוקתה — מחוץ לחלון 24 השעות לא יישלח דוח' };
}

export async function setOwnerAgentReportScheduleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Each time row posts `slots` and `instructions` side by side, in order. A row
  // whose time was emptied is dropped rather than refused.
  const times = formData.getAll('slots').map((v) => String(v).trim());
  const texts = formData.getAll('instructions').map(String);
  const parsed = reportScheduleSchema.safeParse({
    entryId: formData.get('entryId'),
    optIn: formData.get('optIn') === 'on',
    slots: times
      .map((time, i) => ({ time, instructions: texts[i] ?? '' }))
      .filter((s) => s.time !== ''),
  });
  if (!parsed.success) return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };

  await requirePlatformOwner();
  try {
    // The DAL re-parses, so it gets the input shape ('' for no instructions).
    await setOwnerAgentReportSchedule({
      ...parsed.data,
      slots: parsed.data.slots.map((s) => ({ time: s.time, instructions: s.instructions ?? '' })),
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'שמירת לוח הזמנים נכשלה') };
  }

  revalidatePath(OWNER_AGENT);
  return { notice: parsed.data.optIn ? 'לוח הזמנים נשמר' : 'הדוחות לרשומה הזו כובו' };
}
