'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { updateAppSettings, setExchangeConnectionMode } from '@/lib/data/admin/settings';
import { CALL_ME_NOW_WIDGET_TAG } from '@/lib/data/call-me-now-public-config';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { appSettingsSchema } from '@/lib/validation/admin';

function readSettingsForm(formData: FormData) {
  return {
    // A checkbox is present ('on') only when checked; absent means off.
    payments_enabled: formData.get('payments_enabled') === 'on',
    inquiry_followup_enabled: formData.get('inquiry_followup_enabled') === 'on',
    agreement_archive_enabled: formData.get('agreement_archive_enabled') === 'on',
    signup_reminder_enabled: formData.get('signup_reminder_enabled') === 'on',
    unconfirmed_cleanup_enabled: formData.get('unconfirmed_cleanup_enabled') === 'on',
    billing_exposure_gate: formData.get('billing_exposure_gate') === 'on',
    monitor_enabled: formData.get('monitor_enabled') === 'on',
    inbound_calls_enabled: formData.get('inbound_calls_enabled') === 'on',
    handoff_enabled: formData.get('handoff_enabled') === 'on',
    console_softphone_enabled: formData.get('console_softphone_enabled') === 'on',
    console_widget_enabled: formData.get('console_widget_enabled') === 'on',
    console_manual_dial_enabled: formData.get('console_manual_dial_enabled') === 'on',
    console_wake_enabled: formData.get('console_wake_enabled') === 'on',
    console_call_me_now_enabled: formData.get('console_call_me_now_enabled') === 'on',
    console_consult_conference_enabled: formData.get('console_consult_conference_enabled') === 'on',
    console_dtmf_handoff_enabled: formData.get('console_dtmf_handoff_enabled') === 'on',
  };
}

const settingsInput = z.instanceof(FormData).pipe(z.preprocess(readSettingsForm, appSettingsSchema));

export const updateSettingsAction = actionClient
  .inputSchema(settingsInput)
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateAppSettings(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון ההגדרות נכשל. נסו שוב.');
    }

    // The call-me-now switch is one of these settings, and the marketing layout reads it through a cached function.
    updateTag(CALL_ME_NOW_WIDGET_TAG);
    revalidatePath('/admin/settings');
    return { notice: 'ההגדרות נשמרו' };
  });

// Ownership-model switch for Exchange connections (plan §3.1). Does NOT
// touch existing exchange_connections rows — only which mode new connections
// are created under and which UI path /app/settings shows. Anything but
// 'per_org' is the default, 'per_user'.
export const updateExchangeConnectionModeAction = actionClient
  .inputSchema(
    zfd.formData({ exchange_connection_mode: z.enum(['per_user', 'per_org']).catch('per_user') }),
  )
  .stateAction(async ({ parsedInput: { exchange_connection_mode: mode } }) => {
    try {
      await setExchangeConnectionMode(mode);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון מצב הבעלות של Exchange נכשל. נסו שוב.');
    }
    revalidatePath('/admin/settings');
    revalidatePath('/app/settings');
    return {
      notice:
        mode === 'per_org'
          ? 'מצב הבעלות עודכן: חיבורי Exchange חדשים ישויכו לארגון.'
          : 'מצב הבעלות עודכן: חיבורי Exchange חדשים ישויכו למשתמש המחבר.',
    };
  });
