'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  clearSlackConnection,
  setSlackAlertCategory,
  setSlackAlertsEnabled,
  setSlackMention,
  updateSlackConnection,
  type AlertCategoryKey,
} from '@/lib/data/admin/alerts';
import { sendSlackTestAlert } from '@/lib/alerts/slack';
import { actionClient, returnUserError } from '@/lib/safe-action';

// ─── WHERE A SAVE HAS TO BE REFLECTED ────────────────────────────────────────
// Two surfaces: this provider page, and the integrations index whose Slack card
// prints the very `configured`/`enabled` columns written here. `revalidatePath`
// invalidates exactly the path it is handed — revalidating only one of them leaves
// the other stale. Revalidating a path nobody is rendering costs nothing, so there
// is no condition.
const SLACK = '/admin/integrations/slack';
const INDEX = '/admin/integrations';

function revalidateAll(): void {
  for (const path of [SLACK, INDEX]) revalidatePath(path);
}

// ─── THE GATE COMES FIRST ────────────────────────────────────────────────────
// Every action here demands manage_settings before it reads its input. An action with
// input checks it in a `use()` middleware, which runs before `.inputSchema()` validates
// (next-safe-action docs: define-actions/middleware, "Execution order"); an action with
// no input checks it first thing in its body.

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

export const saveSlackConnectionAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(
    zfd.formData({
      slack_bot_token: connectionSchema.shape.slack_bot_token.prefault(''),
      slack_alert_channel_id: connectionSchema.shape.slack_alert_channel_id.prefault(''),
    }),
  )
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateSlackConnection({
        botToken: parsedInput.slack_bot_token,
        channelId: parsedInput.slack_alert_channel_id,
      });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת החיבור נכשלה. נסו שוב.');
    }

    revalidateAll();
    // NEVER echo the token back — return only a neutral notice.
    return { notice: 'החיבור נשמר' };
  });

// Personal @mention: member id optional (blank = no mention target); when present
// must be a Slack member id (`U…`/`W…`). Threshold is one of off/error/warn/info.
const mentionSchema = z.object({
  slack_mention_user_id: z
    .string()
    .trim()
    .max(50)
    .refine((v) => v === '' || /^[UW][A-Z0-9]{6,}$/.test(v), {
      message: 'מזהה חבר לא תקין — צריך להתחיל ב-U או W',
    }),
  slack_mention_min_level: z.enum(['off', 'error', 'warn', 'info']),
});

export const saveSlackMentionAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(
    zfd.formData({
      slack_mention_user_id: mentionSchema.shape.slack_mention_user_id.prefault(''),
      slack_mention_min_level: mentionSchema.shape.slack_mention_min_level.prefault('off'),
    }),
  )
  .stateAction(async ({ parsedInput }) => {
    try {
      await setSlackMention({
        userId: parsedInput.slack_mention_user_id,
        minLevel: parsedInput.slack_mention_min_level,
      });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת הגדרות האזכור נכשלה. נסו שוב.');
    }

    revalidateAll();
    return { notice: 'הגדרות האזכור נשמרו' };
  });

export const clearSlackConnectionAction = actionClient.stateAction(async () => {
  await requirePlatformPermission('manage_settings');
  try {
    await clearSlackConnection();
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('ניתוק החיבור נכשל. נסו שוב.');
  }
  revalidateAll();
  return { notice: 'החיבור נותק וההתראות כובו' };
});

export const sendTestAlertAction = actionClient.stateAction(async () => {
  await requirePlatformPermission('manage_settings');
  let result: Awaited<ReturnType<typeof sendSlackTestAlert>>;
  try {
    result = await sendSlackTestAlert();
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('שליחת התראת הבדיקה נכשלה');
  }
  if (result.ok) return { notice: 'התראת בדיקה נשלחה — בדקו את ערוץ ה-Slack' };
  returnUserError(
    result.reason === 'not_configured'
      ? 'לא הוגדר טוקן/ערוץ. שמרו חיבור תחילה.'
      : 'שליחת התראת הבדיקה נכשלה. בדקו את הטוקן והרשאות ה-bot בערוץ.',
  );
});

const CATEGORY_KEYS: readonly AlertCategoryKey[] = [
  'errors',
  'campaign_billing',
  'send_health',
  'security',
  'customer_inquiry',
];

// A refused toggle is one sentence, whichever value was wrong.
const BAD_VALUE = 'ערך לא תקין';
const toggleSchema = z.object(
  {
    enabled: z.boolean({ error: BAD_VALUE }),
    category: z.enum(CATEGORY_KEYS, { error: BAD_VALUE }).optional(),
  },
  { error: BAD_VALUE },
);

// Single toggle setter used by both the master switch and the category switches
// (the client calls it directly). `category` omitted → the master switch.
export const setAlertToggleAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(toggleSchema)
  .action(async ({ parsedInput: { enabled, category } }) => {
    try {
      if (category) {
        await setSlackAlertCategory(category, enabled);
      } else {
        await setSlackAlertsEnabled(enabled);
      }
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון המתג נכשל. נסו שוב.');
    }
    revalidateAll();
    return { notice: 'נשמר' };
  });
