'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  updateWhatsAppChannelConfig,
  testWhatsAppConnection,
} from '@/lib/data/admin/channels';
import type { FormState } from '@/lib/validation/result';

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

// Form-friendly: every field is an optional string; the master toggle is a
// checkbox. Trimmed; '' is an intentional unset (mapped to null in the DAL).
const whatsappChannelSchema = z.object({
  whatsapp_phone_number_id: z.string().trim().max(64).default(''),
  whatsapp_waba_id: z.string().trim().max(64).default(''),
  whatsapp_access_token: z.string().trim().max(512).default(''),
  whatsapp_app_secret: z.string().trim().max(256).default(''),
  whatsapp_verify_token: z.string().trim().max(256).default(''),
});

export async function updateWhatsAppChannelAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = whatsappChannelSchema.safeParse({
    whatsapp_phone_number_id: formData.get('whatsapp_phone_number_id') ?? '',
    whatsapp_waba_id: formData.get('whatsapp_waba_id') ?? '',
    whatsapp_access_token: formData.get('whatsapp_access_token') ?? '',
    whatsapp_app_secret: formData.get('whatsapp_app_secret') ?? '',
    whatsapp_verify_token: formData.get('whatsapp_verify_token') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const enabled = formData.get('outreach_enabled') === 'on';
  // Fail-closed: outreach can only be enabled once the minimum send credentials
  // (phone number id + access token) are present.
  if (
    enabled &&
    (!parsed.data.whatsapp_phone_number_id || !parsed.data.whatsapp_access_token)
  ) {
    return {
      error:
        'לא ניתן להפעיל ערוץ ללא מזהה מספר וטוקן גישה. מלאו אותם תחילה ושמרו.',
    };
  }

  try {
    await updateWhatsAppChannelConfig({
      outreach_enabled: enabled,
      ...parsed.data,
    });
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'עדכון הגדרות הערוץ נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/channels');
  return { notice: enabled ? 'נשמר — הערוץ מופעל' : 'הגדרות הערוץ נשמרו' };
}

export async function testWhatsAppConnectionAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const r = await testWhatsAppConnection();
    return r.ok ? { notice: r.message } : { error: r.message };
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'בדיקת החיבור נכשלה' };
  }
}
