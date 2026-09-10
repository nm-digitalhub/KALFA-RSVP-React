'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { updateEmailTransportConfig } from '@/lib/data/admin/settings';
import { emailTransportSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

const PATH = '/admin/integrations/resend-email';
const INDEX = '/admin/integrations';

// Thin by design: validate, hand off, revalidate. The gate lives in
// updateEmailTransportConfig (requirePlatformPermission('manage_settings')), which is
// the house pattern — see the note in admin-data-layer-coverage.test.ts on why a
// delegating action is correct and a coarsely-gating one is not.
export async function updateEmailTransportAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailTransportSchema.safeParse({
    email_enabled: formData.get('email_enabled') === 'on',
    smtp_host: formData.get('smtp_host') ?? '',
    smtp_port: formData.get('smtp_port') ?? '',
    smtp_secure: formData.get('smtp_secure') === 'on',
    smtp_user: formData.get('smtp_user') ?? '',
    smtp_password: formData.get('smtp_password') ?? '',
    smtp_from: formData.get('smtp_from') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await updateEmailTransportConfig(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון הגדרות הדואר נכשל. נסו שוב.' };
  }
  // The index card prints `configured`/`enabled` for the columns just written.
  revalidatePath(PATH);
  revalidatePath(INDEX);
  return { notice: 'הגדרות הדואר נשמרו' };
}
