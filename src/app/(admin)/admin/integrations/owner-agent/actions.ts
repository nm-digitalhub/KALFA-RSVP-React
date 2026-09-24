'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  addOwnerAgentAllowlistEntry,
  relabelOwnerAgentAllowlistEntry,
  removeOwnerAgentAllowlistEntry,
  setOwnerAgentAllowlistEnabled,
  setOwnerAgentDailyCap,
  setOwnerAgentEnabled,
  setOwnerAgentPhoneNumber,
} from '@/lib/data/admin/owner-agent';
import {
  addAllowlistEntrySchema,
  agentNumberSchema,
  allowlistEntryIdSchema,
  dailyCapSchema,
  isOwnerAgentUserError,
  relabelAllowlistEntrySchema,
} from '@/lib/validation/owner-agent';
import { issuesToFieldErrors, type FormState } from '@/lib/validation/result';

// Thin by design: validate → owner gate → DAL → a safe Hebrew result.
//
// The owner gate is checked HERE as well as in the DAL. A Server Action is its own
// endpoint — reachable by a POST that never rendered the page — so "the page checked"
// is never the answer, and for this screen the answer is not a permission key at all:
// owner decision 9.4 (2026-09-24). It runs outside the try so its redirect is never
// caught and turned into a form error; everything after it goes through
// unstable_rethrow for the same reason.
//
// Activity rows are written by the DAL, once, for every caller.

const OWNER_AGENT = '/admin/integrations/owner-agent';
const INDEX = '/admin/integrations';

function revalidate(): void {
  revalidatePath(OWNER_AGENT);
  // The index card prints this screen's switch and "number selected" state.
  revalidatePath(INDEX);
}

/**
 * Only a message the DAL wrote for the owner (OWNER_AGENT_ERRORS) reaches the screen.
 * An exact match, not "contains Hebrew": a ZodError's message is the JSON of its
 * issues, which carries these very Hebrew strings alongside paths and codes.
 */
function safeMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  return isOwnerAgentUserError(message) ? message : fallback;
}

export async function setOwnerAgentEnabledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // A checkbox posts 'on' when ticked and nothing when not.
  const enabled = formData.get('owner_agent_enabled') === 'on';

  await requirePlatformOwner();
  try {
    await setOwnerAgentEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'עדכון מתג הסוכן נכשל') };
  }

  revalidate();
  return { notice: enabled ? 'הסוכן הופעל' : 'הסוכן כובה' };
}

export async function setOwnerAgentNumberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = agentNumberSchema.safeParse(formData.get('phoneNumberId') ?? '');
  if (!parsed.success) {
    return { fieldErrors: { phoneNumberId: [parsed.error.issues[0]?.message ?? 'מזהה מספר לא תקין'] } };
  }

  await requirePlatformOwner();
  try {
    await setOwnerAgentPhoneNumber(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'שמירת המספר נכשלה') };
  }

  revalidate();
  return {
    notice: parsed.data === null ? 'לא נבחר מספר — אין הסטה לסוכן' : 'המספר נשמר',
  };
}

export async function setOwnerAgentDailyCapAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = dailyCapSchema.safeParse(formData.get('dailyCap') ?? '');
  if (!parsed.success) {
    return { fieldErrors: { dailyCap: [parsed.error.issues[0]?.message ?? 'ערך לא תקין'] } };
  }

  await requirePlatformOwner();
  try {
    await setOwnerAgentDailyCap(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'שמירת התקרה היומית נכשלה') };
  }

  revalidate();
  return { notice: 'התקרה היומית נשמרה' };
}

export async function addAllowlistEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // issuesToFieldErrors carries MESSAGES, never the submitted value — a refused phone
  // number is not echoed back into the response.
  const parsed = addAllowlistEntrySchema.safeParse({
    e164: formData.get('e164') ?? '',
    staffUserId: formData.get('staffUserId') ?? '',
    label: formData.get('label') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  await requirePlatformOwner();
  try {
    // The DAL re-validates (it has callers other than this form), so it receives the
    // input shape: the normalised E.164, and '' rather than null for "no label".
    await addOwnerAgentAllowlistEntry({ ...parsed.data, label: parsed.data.label ?? '' });
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'הוספת המספר נכשלה') };
  }

  revalidate();
  return { notice: 'המספר נוסף לרשימת ההיתר' };
}

const toggleSchema = z.object({
  id: allowlistEntryIdSchema,
  enabled: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export async function setAllowlistEntryEnabledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = toggleSchema.safeParse({
    id: formData.get('id'),
    enabled: formData.get('enabled'),
  });
  if (!parsed.success) return { error: 'בקשה לא תקינה' };

  await requirePlatformOwner();
  try {
    await setOwnerAgentAllowlistEnabled(parsed.data.id, parsed.data.enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'עדכון הרשומה נכשל') };
  }

  revalidate();
  return { notice: parsed.data.enabled ? 'הרשומה הופעלה' : 'הרשומה הושבתה' };
}

export async function relabelAllowlistEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = relabelAllowlistEntrySchema.safeParse({
    id: formData.get('id'),
    label: formData.get('label') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  await requirePlatformOwner();
  try {
    // The DAL re-parses the raw label, so the trimmed value is passed through as-is.
    await relabelOwnerAgentAllowlistEntry(parsed.data.id, parsed.data.label ?? '');
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'עדכון התווית נכשל') };
  }

  revalidate();
  return { notice: 'התווית נשמרה' };
}

export async function removeAllowlistEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = allowlistEntryIdSchema.safeParse(formData.get('id'));
  if (!parsed.success) return { error: 'בקשה לא תקינה' };

  await requirePlatformOwner();
  try {
    await removeOwnerAgentAllowlistEntry(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'הסרת המספר נכשלה') };
  }

  revalidate();
  return { notice: 'המספר הוסר מרשימת ההיתר' };
}
