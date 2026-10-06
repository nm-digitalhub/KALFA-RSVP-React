import 'server-only';

import type { Tables } from '@/lib/supabase/types';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  accountReviewUpdateSchema,
  accountUpdateSchema,
  phoneNumberQualityUpdateSchema,
} from '@/lib/validation/whatsapp-account-webhooks';

type WebhookInboxRow = Tables<'webhook_inbox'>;

// The WhatsApp Business Account webhooks about the ACCOUNT itself — its review,
// its standing with Meta, and its number's daily messaging limit. Each one is
// reported to Slack (ids only, never a guest's data); the webhook_inbox row
// stays the durable record and is visible in /admin/webhooks. Nothing here
// changes sending: whether the account can send is Meta's to enforce, and a
// send that Meta refuses is already classified on the send path.

// Meta's dashboard "Test" button sends a fixed sample whose entry id is "0".
const SANDBOX_WABA_ID = '0';

type AccountScope = { skip: true } | { skip: false; account: string };

// Which account the change is about, in words, or skip for Meta's test sample.
// A row stored before the route carried the WABA id has none — it is reported
// as ours, since only our account's changes reached this endpoint before then.
async function accountScope(wabaId: string | undefined): Promise<AccountScope> {
  if (wabaId === SANDBOX_WABA_ID) return { skip: true };
  const config = await getWhatsAppConfig();
  if (!wabaId || !config?.wabaId || wabaId === config.wabaId) {
    return { skip: false, account: 'חשבון WhatsApp הפעיל' };
  }
  return { skip: false, account: `חשבון WhatsApp אחר (${wabaId})` };
}

// account_review_update — Meta's policy review of the account. Anything but
// APPROVED means the account "cannot be used with our APIs" (Meta's wording for
// REJECTED, PENDING and DEFERRED alike), so it is an error, not a warning.
const REVIEW_LABELS: Record<string, string> = {
  APPROVED: 'אושר',
  REJECTED: 'נדחה',
  PENDING: 'ממתין להחלטה',
  DEFERRED: 'ההחלטה נדחתה',
};

export async function processAccountReviewRow(row: WebhookInboxRow): Promise<void> {
  const parsed = accountReviewUpdateSchema.safeParse(row.payload);
  if (!parsed.success) return;
  const v = parsed.data;
  const scope = await accountScope(v.entry_waba_id);
  if (scope.skip) return;
  const approved = v.decision === 'APPROVED';
  await sendSlackAlert({
    level: approved ? 'info' : 'error',
    category: 'send_health',
    source: 'whatsapp-account-review',
    title: `סקירת ${scope.account} ב-Meta: ${REVIEW_LABELS[v.decision] ?? v.decision}`,
    detail: approved ? undefined : 'עד שהחשבון יאושר, Meta לא מאפשרת לשלוח ממנו הודעות.',
    fields: { decision: v.decision },
  });
}

// account_update — the account's standing and connections. Events that stop or
// threaten sending are errors; the rest (pricing tier, location, partner and
// terms notices, reinstatement) are information. An event Meta adds later is
// reported under its own name at information level.
const ACCOUNT_EVENTS: Record<string, { label: string; level: 'error' | 'info' }> = {
  ACCOUNT_DELETED: { label: 'החשבון נמחק', level: 'error' },
  ACCOUNT_RESTRICTION: { label: 'החשבון הוגבל', level: 'error' },
  ACCOUNT_VIOLATION: { label: 'החשבון הפר את מדיניות Meta', level: 'error' },
  ACCOUNT_OFFBOARDED: { label: 'החשבון נותק (החלפת מכשיר או רישום מחדש של המספר)', level: 'error' },
  ACCOUNT_RECONNECTED: { label: 'החשבון חובר מחדש', level: 'info' },
  PARTNER_APP_UNINSTALLED: { label: 'ההרשאות של האפליקציה לחשבון בוטלו', level: 'error' },
  PARTNER_APP_INSTALLED: { label: 'ניתנו לאפליקציה הרשאות לחשבון', level: 'info' },
  MM_LITE_TERMS_SIGNED: { label: 'תנאי השימוש של הודעות השיווק אושרו', level: 'info' },
  VOLUME_BASED_PRICING_TIER_UPDATE: { label: 'מדרגת התמחור לפי נפח עודכנה', level: 'info' },
};

// DISABLED_UPDATE carries its meaning in ban_info.waba_ban_state.
const BAN_STATES: Record<string, { label: string; level: 'error' | 'info' }> = {
  DISABLE: { label: 'החשבון הושבת', level: 'error' },
  SCHEDULE_FOR_DISABLE: { label: 'החשבון מתוזמן להשבתה', level: 'error' },
  REINSTATE: { label: 'החשבון הוחזר לפעילות', level: 'info' },
};

export async function processAccountUpdateRow(row: WebhookInboxRow): Promise<void> {
  const parsed = accountUpdateSchema.safeParse(row.payload);
  if (!parsed.success) return;
  const v = parsed.data;
  const scope = await accountScope(v.entry_waba_id);
  if (scope.skip) return;

  const banState = v.ban_info?.waba_ban_state;
  const known =
    v.event === 'DISABLED_UPDATE'
      ? (banState ? BAN_STATES[banState] : undefined) ?? { label: 'מצב החסימה של החשבון השתנה', level: 'error' as const }
      : ACCOUNT_EVENTS[v.event] ?? { label: `עדכון חשבון: ${v.event}`, level: 'info' as const };

  const restrictions = (v.restriction_info ?? [])
    .map((r) => r.restriction_type)
    .filter((t): t is string => !!t);
  const remediation = (v.restriction_info ?? [])
    .map((r) => r.remediation)
    .filter((t): t is string => !!t);

  await sendSlackAlert({
    level: known.level,
    category: 'send_health',
    source: 'whatsapp-account-update',
    title: `${scope.account}: ${known.label}`,
    detail: remediation.length > 0 ? remediation.join(' · ') : undefined,
    fields: {
      event: v.event,
      ...(banState ? { ban_state: banState } : {}),
      ...(v.ban_info?.waba_ban_date ? { ban_date: v.ban_info.waba_ban_date } : {}),
      ...(v.violation_info?.violation_type ? { violation: v.violation_info.violation_type } : {}),
      ...(restrictions.length > 0 ? { restrictions: restrictions.join(', ') } : {}),
    },
  });
}

// phone_number_quality_update — the number's daily limit on business-initiated
// conversations changed (or it finished onboarding). The limit caps how many
// guests a campaign can reach in a day, so every change is reported.
const LIMIT_LABELS: Record<string, string> = {
  TIER_50: '50 ביום',
  TIER_250: '250 ביום',
  TIER_2K: '2,000 ביום',
  TIER_10K: '10,000 ביום',
  TIER_100K: '100,000 ביום',
  TIER_UNLIMITED: 'ללא הגבלה',
  TIER_NOT_SET: 'עדיין לא נקבעה',
};

export async function processPhoneNumberQualityRow(row: WebhookInboxRow): Promise<void> {
  const parsed = phoneNumberQualityUpdateSchema.safeParse(row.payload);
  if (!parsed.success) return;
  const v = parsed.data;
  const scope = await accountScope(v.entry_waba_id);
  if (scope.skip) return;
  const limit = v.max_daily_conversations_per_business ?? v.current_limit;
  await sendSlackAlert({
    level: 'info',
    category: 'send_health',
    source: 'whatsapp-phone-quality',
    title: `מכסת השליחה היומית של מספר WhatsApp השתנתה: ${limit ? LIMIT_LABELS[limit] ?? limit : 'לא צוינה'}`,
    fields: {
      event: v.event,
      ...(limit ? { limit } : {}),
      ...(v.old_limit ? { previous: v.old_limit } : {}),
      ...(v.display_phone_number ? { number: v.display_phone_number } : {}),
      account: scope.account,
    },
  });
}
