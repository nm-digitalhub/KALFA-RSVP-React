'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { runLogExport } from '@/lib/data/vox-log-export';
import { setElevenLabsApiKey } from '@/lib/data/elevenlabs-status';
import {
  rollbackVoximplantAccountCallback,
  wireVoximplantAccountCallback,
} from '@/lib/data/admin/voximplant-channel';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Refresh the platform view: revalidate its pages so the provider reads re-run
// (the balance tile still honors its short in-process cache). Read-only.
export const refreshVoicePlatformAction = actionClient.stateAction(async () => {
  await requirePlatformPermission('manage_voice');
  revalidatePath('/admin/voice/platform');
  revalidatePath('/admin/voice');
  return { notice: 'רועננו הנתונים' };
});

// Manually trigger one log-export run (the same fn the daily cron runs). It is
// dark-safe + never throws; we surface the run counts.
export const runLogExportAction = actionClient.stateAction(async () => {
  await requirePlatformPermission('manage_voice');
  try {
    const summary = await runLogExport();
    await logActivity({ action: 'admin.voice.log_export_run', meta: { ...summary } });
    revalidatePath('/admin/voice/platform');
    return {
      notice: `ייצוא לוגים: ${summary.stored} נשמרו, ${summary.noLog} ללא לוג, ${summary.failed} נכשלו${
        summary.purged ? `, ${summary.purged} נוקו` : ''
      }`,
    };
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('הרצת ייצוא הלוגים נכשלה. נסו שוב.');
  }
});

// Wire the account-callback (the one-time SetAccountInfo mutation). Guarded
// by an AlertDialog in the UI. On success we surface the registered URL so the
// admin can confirm it; the raw token is embedded in that URL and shown ONCE.
// A refusal (`!res.ok`) is answered with the data layer's own message, outside
// the try: returnUserError throws, and the catch would replace it.
export const wireAccountCallbackAction = actionClient.action(async () => {
  await requirePlatformPermission('manage_voice');
  let res: Awaited<ReturnType<typeof wireVoximplantAccountCallback>>;
  try {
    res = await wireVoximplantAccountCallback();
    if (res.ok) {
      await logActivity({
        action: 'admin.voice.account_callback_wired',
        meta: { echoConfirmed: res.echoConfirmed },
      });
      void sendSlackAlert({
        level: 'info',
        category: 'security',
        source: 'admin-voice',
        title: 'חווט Voximplant account-callback',
        detail: res.echoConfirmed ? 'echo confirmed' : 'echo unconfirmed (fallback: first callback)',
      });
      revalidatePath('/admin/voice/platform');
    }
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('החיווט נכשל. נסו שוב.');
  }
  if (!res.ok) returnUserError(res.message);
  return {
    notice: res.echoConfirmed
      ? 'החיווט הושלם ואומת מול Voximplant.'
      : 'החיווט נרשם. האימות מול echo לא הושלם — יאושר עם ה־callback הראשון.',
    callbackUrl: res.callbackUrl,
  };
});

export const rollbackAccountCallbackAction = actionClient.action(async () => {
  await requirePlatformPermission('manage_voice');
  let res: Awaited<ReturnType<typeof rollbackVoximplantAccountCallback>>;
  try {
    res = await rollbackVoximplantAccountCallback();
    if (res.ok) {
      await logActivity({ action: 'admin.voice.account_callback_rolled_back', meta: {} });
      void sendSlackAlert({
        level: 'warn',
        category: 'security',
        source: 'admin-voice',
        title: 'בוטל חיווט Voximplant account-callback',
      });
      revalidatePath('/admin/voice/platform');
    }
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('ביטול החיווט נכשל. נסו שוב.');
  }
  if (!res.ok) returnUserError(res.message);
  return { notice: res.message };
});

// Save the ElevenLabs API key (write-only secret; blank clears it). Read-only
// integration otherwise — no agent edits ever happen from here. The gate runs
// before the form is read, as it always did: a pre-validation middleware, ahead
// of the input schema ('' when the field is blank or missing).
export const saveElevenLabsKeyAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_voice');
    return next();
  })
  .inputSchema(zfd.formData({ elevenlabs_api_key: z.string().default('') }))
  .stateAction(async ({ parsedInput: { elevenlabs_api_key: key } }) => {
    try {
      await setElevenLabsApiKey(key);
      await logActivity({ action: 'admin.voice.elevenlabs_key_set', meta: { cleared: key.trim() === '' } });
      revalidatePath('/admin/voice/platform');
      return { notice: key.trim() === '' ? 'המפתח נוקה.' : 'מפתח ElevenLabs נשמר.' };
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת המפתח נכשלה. נסו שוב.');
    }
  });
