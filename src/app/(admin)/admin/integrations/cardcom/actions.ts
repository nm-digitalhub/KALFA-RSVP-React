'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { saveCardcomConfig } from '@/lib/data/admin/integrations/cardcom-config';
import { cardcomConfigSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Thin by design: validate, hand off, revalidate. The gate lives in saveCardcomConfig
// (requirePlatformPermission('integrations.manage')).
//
// A blank password is not an error: it means "keep the stored one", so an operator can switch the pilot on or correct
// the terminal number without typing a secret they may not have kept. Whether the pilot may be switched on is decided
// in saveCardcomConfig, which knows whether a password is stored.
export async function updateCardcomConfigAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = cardcomConfigSchema.safeParse({
    terminal_number: formData.get('terminal_number') ?? '',
    api_name: formData.get('api_name') ?? '',
    api_password: formData.get('api_password') ?? '',
    enabled: formData.get('enabled') === 'on',
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  try {
    const result = await saveCardcomConfig({
      terminalNumber: Number(parsed.data.terminal_number),
      apiName: parsed.data.api_name,
      apiPassword: parsed.data.api_password,
      enabled: parsed.data.enabled,
    });
    if (!result.ok) {
      return { fieldErrors: { api_password: ['כדי להפעיל את CardCom חובה סיסמת API שמורה (היא נדרשת להחזרים)'] } };
    }
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שמירת פרטי CardCom נכשלה. נסו שוב.' };
  }
  revalidatePath('/admin/integrations/cardcom');
  revalidatePath('/admin/integrations');
  return { notice: 'פרטי CardCom נשמרו' };
}
