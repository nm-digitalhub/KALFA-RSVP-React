'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodIssue } from 'zod';

import {
  createPackage,
  updatePackage,
  deletePackage,
  validateOutreachScheduleForPackage,
} from '@/lib/data/admin/packages';
import { packageBaseSchema, operationalFieldsSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Read the package fields from the form into the shape packageBaseSchema parses.
// Prices/flags are validated and coerced server-side; nothing is trusted from
// the browser.
function readPackageForm(formData: FormData) {
  return {
    name: formData.get('name'),
    tier: formData.get('tier'),
    category: formData.get('category'),
    description: formData.get('description'),
    price_with_vat: formData.get('price_with_vat'),
    includes: formData.get('includes'),
    active: formData.get('active'),
    sort_order: formData.get('sort_order'),
  };
}

// The operational (campaign) fields. `channels` is a multi-select checkbox
// group — MUST use getAll(), not get() (get() returns only the first value
// and can't distinguish "nothing checked" from "field not sent").
// `outreach_schedule` is edited as a structured row-editor in the browser
// and synced into one hidden JSON field; parsed here as controlled JSON
// (never Zod'd directly as a raw string) before being handed to Zod as an
// array. A malformed/missing value becomes `[]`, which Zod then validates
// normally (empty schedule is rejected for a campaign-enabled package).
function readOperationalForm(formData: FormData) {
  const channels = formData.getAll('channels');
  const scheduleRaw = formData.get('outreach_schedule_json');
  let outreach_schedule: unknown = [];
  if (typeof scheduleRaw === 'string' && scheduleRaw.trim() !== '') {
    try {
      outreach_schedule = JSON.parse(scheduleRaw);
    } catch {
      outreach_schedule = [];
    }
  }
  return {
    price_per_reached: formData.get('price_per_reached'),
    channels,
    outreach_schedule,
    min_hold_floor: formData.get('min_hold_floor'),
    hold_buffer_pct: formData.get('hold_buffer_pct'),
  };
}

// Build FormState.fieldErrors from raw Zod issues, keyed by the dotted path
// (e.g. "outreach_schedule.0.message_key") so the form can attach an error to
// the exact row. .flatten() only produces top-level keys — it cannot express
// this, so it is deliberately not used for the operational schema.
function issuesToFieldErrors(issues: ZodIssue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function mergeFieldErrors(
  ...groups: (Record<string, string[]> | undefined)[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const group of groups) {
    if (!group) continue;
    for (const [key, messages] of Object.entries(group)) {
      (out[key] ??= []).push(...messages);
    }
  }
  return out;
}

export async function createPackageAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = packageBaseSchema.safeParse(readPackageForm(formData));
  const operationalParsed = operationalFieldsSchema.safeParse(readOperationalForm(formData));
  if (!parsed.success || !operationalParsed.success) {
    return {
      fieldErrors: mergeFieldErrors(
        parsed.success ? undefined : issuesToFieldErrors(parsed.error.issues),
        operationalParsed.success ? undefined : issuesToFieldErrors(operationalParsed.error.issues),
      ),
    };
  }

  const templateErrors = await validateOutreachScheduleForPackage(
    operationalParsed.data.outreach_schedule,
  );
  if (templateErrors.length > 0) {
    const fieldErrors: Record<string, string[]> = {};
    for (const { index, message } of templateErrors) {
      (fieldErrors[`outreach_schedule.${index}.message_key`] ??= []).push(message);
    }
    return { fieldErrors };
  }

  try {
    await createPackage(parsed.data, operationalParsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'יצירת החבילה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/packages');
  redirect('/admin/packages');
}

export async function updatePackageAction(
  id: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = packageBaseSchema.safeParse(readPackageForm(formData));
  const operationalParsed = operationalFieldsSchema.safeParse(readOperationalForm(formData));
  if (!parsed.success || !operationalParsed.success) {
    return {
      fieldErrors: mergeFieldErrors(
        parsed.success ? undefined : issuesToFieldErrors(parsed.error.issues),
        operationalParsed.success ? undefined : issuesToFieldErrors(operationalParsed.error.issues),
      ),
    };
  }

  const templateErrors = await validateOutreachScheduleForPackage(
    operationalParsed.data.outreach_schedule,
  );
  if (templateErrors.length > 0) {
    const fieldErrors: Record<string, string[]> = {};
    for (const { index, message } of templateErrors) {
      (fieldErrors[`outreach_schedule.${index}.message_key`] ??= []).push(message);
    }
    return { fieldErrors };
  }

  try {
    await updatePackage(id, parsed.data, operationalParsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון החבילה נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/packages');
  revalidatePath(`/admin/packages/${id}`);
  return { notice: 'החבילה נשמרה' };
}

export async function deletePackageAction(
  id: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  // Bound with the id; useActionState always supplies (state, formData), neither
  // of which this destructive action reads. Marked intentionally unused.
  void _prevState;
  void _formData;
  try {
    await deletePackage(id);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'מחיקת החבילה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/packages');
  redirect('/admin/packages');
}
