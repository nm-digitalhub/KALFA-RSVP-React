'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { returnValidationErrors } from 'next-safe-action';
import { zfd } from 'zod-form-data';

import { saveCardcomConfig } from '@/lib/data/admin/integrations/cardcom-config';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { cardcomConfigSchema } from '@/lib/validation/admin';

// Thin by design: validate, hand off, revalidate. The gate lives in saveCardcomConfig
// (requirePlatformPermission('integrations.manage')).
//
// A blank password (or document report secret) is not an error: it means "keep the stored one", so an operator can switch the pilot on or correct
// the terminal number without typing a secret they may not have kept. Whether the pilot may be switched on is decided
// in saveCardcomConfig, which knows whether a password is stored.
//
// The text fields are the shared schema's own, and a blank field reaches it as '' — so does one the form did not send
// (blank password = keep the stored one; blank terminal = its Hebrew message). The two switches are checkboxes ("on" or
// absent).
const { shape } = cardcomConfigSchema;
const cardcomConfigForm = zfd.formData({
  terminal_number: shape.terminal_number.prefault(''),
  api_name: shape.api_name.prefault(''),
  api_password: shape.api_password.prefault(''),
  document_report_secret: shape.document_report_secret.prefault(''),
  enabled: zfd.checkbox(),
  save_card_on_purchase: zfd.checkbox(),
  google_pay_mode: shape.google_pay_mode,
});

export const updateCardcomConfigAction = actionClient
  .inputSchema(cardcomConfigForm)
  .stateAction(async ({ parsedInput }) => {
    let result: Awaited<ReturnType<typeof saveCardcomConfig>>;
    try {
      result = await saveCardcomConfig({
        terminalNumber: Number(parsedInput.terminal_number),
        apiName: parsedInput.api_name,
        apiPassword: parsedInput.api_password,
        documentReportSecret: parsedInput.document_report_secret,
        enabled: parsedInput.enabled,
        saveCardOnPurchase: parsedInput.save_card_on_purchase,
        googlePayMode: parsedInput.google_pay_mode,
      });
    } catch (err) {
      unstable_rethrow(err);
      // The form gets one safe sentence, so the cause has to be findable somewhere else: the database's error code (42501 = a privilege
      // is missing, 22023 = a value was refused, ...). Only the code — never the message, which can carry a value.
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : 'none';
      console.error('[cardcom-config] save failed', { code });
      returnUserError('שמירת פרטי CardCom נכשלה. נסו שוב.');
    }
    if (!result.ok) {
      returnValidationErrors(cardcomConfigForm, {
        api_password: { _errors: ['כדי להפעיל את CardCom חובה סיסמת API שמורה (היא נדרשת להחזרים)'] },
      });
    }
    revalidatePath('/admin/integrations/cardcom');
    revalidatePath('/admin/integrations');
    return { notice: 'פרטי CardCom נשמרו' };
  });
