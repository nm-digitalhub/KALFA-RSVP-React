'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { runLogExport } from '@/lib/data/vox-log-export';
import { setElevenLabsApiKey } from '@/lib/data/elevenlabs-status';
import {
  rollbackVoximplantAccountCallback,
  wireVoximplantAccountCallback,
} from '@/lib/data/admin/voximplant-channel';
import type { FormState } from '@/lib/validation/result';

// FormState variant that also carries the one-time raw callback URL to display.
export type WireFormState = FormState & { callbackUrl?: string };

// Refresh the platform view: bust the page's cached provider reads. Read-only.
export async function refreshVoicePlatformAction(): Promise<FormState> {
  await requireAdmin();
  revalidatePath('/admin/voice/platform');
  revalidatePath('/admin/voice');
  return { notice: 'רועננו הנתונים' };
}

// Manually trigger one log-export run (the same fn the daily cron runs). It is
// dark-safe + never throws; we surface the run counts.
export async function runLogExportAction(): Promise<FormState> {
  await requireAdmin();
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
    return { error: 'הרצת ייצוא הלוגים נכשלה. נסו שוב.' };
  }
}

// B5 — wire the account-callback (the one-time SetAccountInfo mutation). Guarded
// by an AlertDialog in the UI. On success we surface the registered URL so the
// admin can confirm it; the raw token is embedded in that URL and shown ONCE.
export async function wireAccountCallbackAction(): Promise<WireFormState> {
  await requireAdmin();
  try {
    const res = await wireVoximplantAccountCallback();
    if (!res.ok) return { error: res.message };
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
    return {
      notice: res.echoConfirmed
        ? 'החיווט הושלם ואומת מול Voximplant.'
        : 'החיווט נרשם. האימות מול echo לא הושלם — יאושר עם ה־callback הראשון.',
      callbackUrl: res.callbackUrl,
    };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'החיווט נכשל. נסו שוב.' };
  }
}

export async function rollbackAccountCallbackAction(): Promise<FormState> {
  await requireAdmin();
  try {
    const res = await rollbackVoximplantAccountCallback();
    if (!res.ok) return { error: res.message };
    await logActivity({ action: 'admin.voice.account_callback_rolled_back', meta: {} });
    void sendSlackAlert({
      level: 'warn',
      category: 'security',
      source: 'admin-voice',
      title: 'בוטל חיווט Voximplant account-callback',
    });
    revalidatePath('/admin/voice/platform');
    return { notice: res.message };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'ביטול החיווט נכשל. נסו שוב.' };
  }
}

// Save the ElevenLabs API key (write-only secret; blank clears it). Read-only
// integration otherwise — no agent edits ever happen from here.
export async function saveElevenLabsKeyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  const key = String(formData.get('elevenlabs_api_key') ?? '');
  try {
    await setElevenLabsApiKey(key);
    await logActivity({ action: 'admin.voice.elevenlabs_key_set', meta: { cleared: key.trim() === '' } });
    revalidatePath('/admin/voice/platform');
    return { notice: key.trim() === '' ? 'המפתח נוקה.' : 'מפתח ElevenLabs נשמר.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שמירת המפתח נכשלה. נסו שוב.' };
  }
}
