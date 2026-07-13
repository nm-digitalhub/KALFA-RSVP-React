'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/dal';
import {
  clearSlackConnection,
  setSlackAlertCategory,
  setSlackAlertsEnabled,
  updateSlackConnection,
  type AlertCategoryKey,
} from '@/lib/data/admin/alerts';
import { sendSlackTestAlert } from '@/lib/alerts/slack';
import type { FormState } from '@/lib/validation/result';

const PATH = '/admin/alerts';

// Bot token: optional (blank = keep existing); when present must be a Slack bot
// token (`xoxb-…`). Channel id: required, Slack channel-id shape (`C…`).
const connectionSchema = z.object({
  slack_bot_token: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || /^xoxb-[A-Za-z0-9-]+$/.test(v), {
      message: 'טוקן לא תקין — צריך להתחיל ב-xoxb-',
    }),
  slack_alert_channel_id: z
    .string()
    .trim()
    .regex(/^C[A-Z0-9]{6,}$/, { message: 'מזהה ערוץ לא תקין — צריך להתחיל ב-C' }),
});

export async function saveSlackConnectionAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();

  const parsed = connectionSchema.safeParse({
    slack_bot_token: formData.get('slack_bot_token') ?? '',
    slack_alert_channel_id: formData.get('slack_alert_channel_id') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateSlackConnection({
      botToken: parsed.data.slack_bot_token,
      channelId: parsed.data.slack_alert_channel_id,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שמירת החיבור נכשלה. נסו שוב.' };
  }

  revalidatePath(PATH);
  // NEVER echo the token back — return only a neutral notice.
  return { notice: 'החיבור נשמר' };
}

export async function clearSlackConnectionAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  try {
    await clearSlackConnection();
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'ניתוק החיבור נכשל. נסו שוב.' };
  }
  revalidatePath(PATH);
  return { notice: 'החיבור נותק וההתראות כובו' };
}

export async function sendTestAlertAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  let result: Awaited<ReturnType<typeof sendSlackTestAlert>>;
  try {
    result = await sendSlackTestAlert();
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שליחת התראת הבדיקה נכשלה' };
  }
  if (result.ok) return { notice: 'התראת בדיקה נשלחה — בדקו את ערוץ ה-Slack' };
  return {
    error:
      result.reason === 'not_configured'
        ? 'לא הוגדר טוקן/ערוץ. שמרו חיבור תחילה.'
        : 'שליחת התראת הבדיקה נכשלה. בדקו את הטוקן והרשאות ה-bot בערוץ.',
  };
}

const CATEGORY_KEYS: readonly AlertCategoryKey[] = [
  'errors',
  'campaign_billing',
  'send_health',
  'security',
];

const toggleSchema = z.object({
  enabled: z.boolean(),
  category: z.enum(CATEGORY_KEYS).optional(),
});

// Single toggle setter used by both the master switch and the category switches
// (the client calls it directly). `category` omitted → the master switch.
export async function setAlertToggleAction(input: {
  enabled: boolean;
  category?: AlertCategoryKey;
}): Promise<FormState> {
  await requireAdmin();
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'ערך לא תקין' };
  }
  try {
    if (parsed.data.category) {
      await setSlackAlertCategory(parsed.data.category, parsed.data.enabled);
    } else {
      await setSlackAlertsEnabled(parsed.data.enabled);
    }
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון המתג נכשל. נסו שוב.' };
  }
  revalidatePath(PATH);
  return { notice: 'נשמר' };
}
