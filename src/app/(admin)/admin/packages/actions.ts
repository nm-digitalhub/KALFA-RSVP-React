'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import {
  createPackage,
  updatePackage,
  deletePackage,
} from '@/lib/data/admin/packages';
import { packageBaseSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Re-throw Next.js control-flow signals (redirect/notFound) so they are not
// swallowed by the catch.
function isNextControlFlow(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
      (err as { digest: string }).digest === 'NEXT_NOT_FOUND')
  );
}

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

export async function createPackageAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = packageBaseSchema.safeParse(readPackageForm(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createPackage(parsed.data);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
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
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updatePackage(id, parsed.data);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
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
    if (isNextControlFlow(err)) throw err;
    return { error: 'מחיקת החבילה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/packages');
  redirect('/admin/packages');
}
