'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createOffer, updateOffer, deleteOffer, OfferFloorError } from '@/lib/data/admin/offers';
import { offerSchema } from '@/lib/validation/admin';
import { issuesToFieldErrors } from '@/lib/validation/result';
import type { FormState } from '@/lib/validation/result';

// Read the offer fields from the form into the shape offerSchema parses. Checkboxes and numbers
// are validated and coerced server-side; nothing is trusted from the browser. `packages` is edited
// as checkbox rows with an optional per-package override and synced into one hidden JSON field
// (the packages module's outreach_schedule_json precedent); malformed/missing JSON becomes `[]`,
// which the schema then refuses (an offer needs at least one package).
function readOfferForm(formData: FormData) {
  const packagesRaw = formData.get('packages_json');
  let packages: unknown = [];
  if (typeof packagesRaw === 'string' && packagesRaw.trim() !== '') {
    try {
      packages = JSON.parse(packagesRaw);
    } catch {
      packages = [];
    }
  }
  return {
    title: formData.get('title'),
    kind: formData.get('kind'),
    value: formData.get('value'),
    validity_days: formData.get('validity_days'),
    allow_agent: formData.get('allow_agent'),
    allow_staff: formData.get('allow_staff'),
    agent_objections: formData.get('agent_objections'),
    may_replace: formData.get('may_replace'),
    is_active: formData.get('is_active'),
    packages,
  };
}

// D14's refusal surfaces as a field error on the discount value — the field whose change fixes it.
function floorFieldError(err: OfferFloorError): FormState {
  return { fieldErrors: { value: [err.message] } };
}

export async function createOfferAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = offerSchema.safeParse(readOfferForm(formData));
  if (!parsed.success) {
    return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  try {
    await createOffer(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof OfferFloorError) return floorFieldError(err);
    return { error: 'יצירת ההצעה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/offers');
  redirect('/admin/offers');
}

export async function updateOfferAction(
  id: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = offerSchema.safeParse(readOfferForm(formData));
  if (!parsed.success) {
    return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  try {
    await updateOffer(id, parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof OfferFloorError) return floorFieldError(err);
    return { error: 'עדכון ההצעה נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/offers');
  revalidatePath(`/admin/offers/${id}`);
  return { notice: 'ההצעה נשמרה' };
}

export async function deleteOfferAction(
  id: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  // Bound with the id; useActionState always supplies (state, formData), neither of which this
  // destructive action reads. Marked intentionally unused.
  void _prevState;
  void _formData;
  try {
    await deleteOffer(id);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'מחיקת ההצעה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/offers');
  redirect('/admin/offers');
}
