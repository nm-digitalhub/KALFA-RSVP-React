import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: read/write the Slack ops-alerting config (app_settings singleton) and
// read the append-only ops_alerts audit trail. Authorized by requireAdmin() plus
// the request-scoped session client under RLS (app_settings_admin_all /
// ops_alerts_admin_select).
//
// SECURITY: the Slack BOT TOKEN is a secret. It is NEVER returned from this
// module — reads derive only a boolean (`hasToken`) and discard the value. The
// channel id (`C…`) is a non-secret identifier and is surfaced for display.

const SETTINGS_ID = true;

export interface SlackAlertsView {
  enabled: boolean;
  hasToken: boolean;
  channelId: string; // '' when unset — a non-secret Slack channel id
  connected: boolean; // token AND channel both present
  categories: {
    errors: boolean;
    campaignBilling: boolean;
    sendHealth: boolean;
    security: boolean;
  };
}

// Read the alerting config for the admin screen. Returns a boolean for the token
// (never the value). Fail-loud (throws) so the page shows an error boundary.
export async function getSlackAlertsView(): Promise<SlackAlertsView> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'slack_alerts_enabled, slack_bot_token, slack_alert_channel_id, slack_alert_errors, slack_alert_campaign_billing, slack_alert_send_health, slack_alert_security',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();

  if (error) throw new Error('טעינת הגדרות ההתראות נכשלה');

  const hasToken = typeof data?.slack_bot_token === 'string' && data.slack_bot_token.trim() !== '';
  const channelId = data?.slack_alert_channel_id ?? '';

  return {
    enabled: data?.slack_alerts_enabled ?? false,
    hasToken,
    channelId,
    connected: hasToken && channelId.trim() !== '',
    categories: {
      errors: data?.slack_alert_errors ?? false,
      campaignBilling: data?.slack_alert_campaign_billing ?? false,
      sendHealth: data?.slack_alert_send_health ?? false,
      security: data?.slack_alert_security ?? false,
    },
  };
}

// Save the connection: always sets the channel id; sets the token ONLY when a
// non-empty value is supplied (a blank token leaves the existing one intact, so
// the admin can edit the channel without re-entering the secret).
export async function updateSlackConnection(input: {
  botToken: string; // '' → leave unchanged
  channelId: string;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const patch: Database['public']['Tables']['app_settings']['Update'] = {
    slack_alert_channel_id: input.channelId || null,
  };
  if (input.botToken) patch.slack_bot_token = input.botToken;

  const { error } = await supabase.from('app_settings').update(patch).eq('id', SETTINGS_ID);
  if (error) throw new Error('שמירת חיבור ה-Slack נכשלה');
}

// Disconnect: clear both credentials AND turn alerting off (fail-closed — no
// silent sends against a half-cleared config).
export async function clearSlackConnection(): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      slack_bot_token: null,
      slack_alert_channel_id: null,
      slack_alerts_enabled: false,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('ניתוק ה-Slack נכשל');
}

export async function setSlackAlertsEnabled(enabled: boolean): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ slack_alerts_enabled: enabled })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון מתג ההתראות נכשל');
}

// The four category toggles, keyed by the app_settings column they drive.
export const ALERT_CATEGORY_COLUMNS = {
  errors: 'slack_alert_errors',
  campaign_billing: 'slack_alert_campaign_billing',
  send_health: 'slack_alert_send_health',
  security: 'slack_alert_security',
} as const;

export type AlertCategoryKey = keyof typeof ALERT_CATEGORY_COLUMNS;

export async function setSlackAlertCategory(
  category: AlertCategoryKey,
  enabled: boolean,
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  // Literal-keyed patch (no computed key) so it typechecks against the generated
  // Update type; exhaustive over AlertCategoryKey.
  const patch: Database['public']['Tables']['app_settings']['Update'] =
    category === 'errors'
      ? { slack_alert_errors: enabled }
      : category === 'campaign_billing'
        ? { slack_alert_campaign_billing: enabled }
        : category === 'send_health'
          ? { slack_alert_send_health: enabled }
          : { slack_alert_security: enabled };
  const { error } = await supabase
    .from('app_settings')
    .update(patch)
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון קטגוריית ההתראות נכשל');
}

// --- ops_alerts history (append-only audit) --------------------------------

type OpsAlertRow = Database['public']['Tables']['ops_alerts']['Row'];

export type OpsAlertEntry = Pick<
  OpsAlertRow,
  'id' | 'level' | 'title' | 'source' | 'category' | 'delivered' | 'suppressed_count' | 'created_at'
>;

const OPS_ALERT_COLUMNS =
  'id, level, title, source, category, delivered, suppressed_count, created_at';

// Server-paginated, newest first.
export async function listOpsAlerts(
  params: PageParams = {},
): Promise<PageResult<OpsAlertEntry>> {
  await requireAdmin();
  const supabase = await createClient();
  const { page, pageSize, from, to } = resolvePage(params.page);

  const { data, error, count } = await supabase
    .from('ops_alerts')
    .select(OPS_ALERT_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw new Error('טעינת יומן ההתראות נכשלה');

  return {
    items: (data ?? []) as OpsAlertEntry[],
    total: count ?? 0,
    page,
    pageSize,
  };
}
