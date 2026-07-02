'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import {
  createPackage,
  updatePackage,
  deletePackage,
  validateOutreachScheduleForPackage,
} from '@/lib/data/admin/packages';
import { packageBaseSchema, operationalFieldsSchema } from '@/lib/validation/admin';
import { issuesToFieldErrors, mergeFieldErrors } from '@/lib/validation/result';
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

  // Template validation runs only for a campaign-enabled package
  // (price_per_reached !== null) — campaign-field requirements are never
  // enforced on a non-campaign package (plan §5.3/§2), e.g. a future package
  // drafted with touchpoints whose templates don't exist yet.
  const templateErrors =
    operationalParsed.data.price_per_reached !== null
      ? await validateOutreachScheduleForPackage(operationalParsed.data.outreach_schedule)
      : [];
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

  // Same campaign-enabled gate as createPackageAction (plan §5.3/§2).
  const templateErrors =
    operationalParsed.data.price_per_reached !== null
      ? await validateOutreachScheduleForPackage(operationalParsed.data.outreach_schedule)
      : [];
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
