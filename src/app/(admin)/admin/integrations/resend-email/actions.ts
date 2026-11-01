'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import { updateEmailTransportConfig } from '@/lib/data/admin/settings';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { emailTransportSchema } from '@/lib/validation/admin';

const PATH = '/admin/integrations/resend-email';
const INDEX = '/admin/integrations';

// The form as it arrives: a checkbox is on only as 'on', and an empty or missing text field is '' (the SMTP
// half may be left blank while Resend is the live transport).
const field = emailTransportSchema.shape;
const emailTransportFormSchema = zfd.formData({
  email_enabled: zfd.checkbox(),
  smtp_host: field.smtp_host.default(''),
  smtp_port: field.smtp_port.default(''),
  smtp_secure: zfd.checkbox(),
  smtp_user: field.smtp_user.default(''),
  smtp_password: field.smtp_password.default(''),
  smtp_from: field.smtp_from.default(''),
});

// Thin by design: validate, hand off, revalidate. The gate lives in
// updateEmailTransportConfig (requirePlatformPermission('manage_settings')), which is
// the house pattern — see the note in admin-data-layer-coverage.test.ts on why a
// delegating action is correct and a coarsely-gating one is not.
export const updateEmailTransportAction = actionClient
  .inputSchema(emailTransportFormSchema)
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateEmailTransportConfig(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      // A fixed message: a provider's or the database's text never reaches the form or the log.
      returnUserError('עדכון הגדרות הדואר נכשל. נסו שוב.');
    }
    // The index card prints `configured`/`enabled` for the columns just written.
    revalidatePath(PATH);
    revalidatePath(INDEX);
    return { notice: 'הגדרות הדואר נשמרו' };
  });
