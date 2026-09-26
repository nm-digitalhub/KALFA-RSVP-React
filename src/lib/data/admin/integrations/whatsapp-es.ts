import 'server-only';

import { requirePlatformOwner, requirePlatformPermission } from '@/lib/auth/dal';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { logActivity } from '@/lib/data/activity';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';
import { getAppUrl } from '@/lib/url';
import { debugToken } from '@/lib/whatsapp/debug-token';
import {
  exchangeCodeForBusinessToken,
  getCoexistenceStatus,
  requestSmbSync,
  subscribeAppToWaba,
} from '@/lib/whatsapp/embedded-signup/graph';
import { ES_KIND, ES_PROVIDER } from '@/lib/whatsapp/embedded-signup/connected-numbers';
import type { FinishEvent } from '@/lib/whatsapp/embedded-signup/session-event';
import { resolveMetaAppId } from '@/lib/whatsapp/meta-app-id';
import { listWabaPhoneNumbers } from '@/lib/whatsapp/phone-numbers';
import {
  getAppSubscriptions,
  readWhatsAppSubscription,
  subscribeWhatsAppWebhook,
} from '@/lib/whatsapp/subscriptions';

// Connect a WhatsApp Business app number to Cloud API ("Coexistence") through
// Meta's Embedded Signup, WITHOUT touching anything live.
//
// ⚠️ NOTHING HERE WRITES app_settings.whatsapp_*, provider_numbers OR
// provider_number_roles. The connected number sends nothing and receives no
// role; the owner rejected the assumption that connecting replaces the current
// sender. The only durable output is one integration_connections row (token in
// Vault) — every other reader of that table filters on its own provider, so the
// row appears nowhere else.
//
// ⚠️ THE POPUP'S IDS ARE NOT TRUSTED. The WABA comes from the exchanged token
// itself (debug_token granular_scopes), and the number from that WABA's listing.
// A browser-submitted identifier is never authorization (CLAUDE.md).
//
// ORDER MATTERS, and each step says why it sits where it does.

export { ES_KIND, ES_PROVIDER };

const SUPPORTED_FINISH: FinishEvent = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
const CONFIG_ID = /^\d{5,32}$/;

type EsConnectionMeta = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  finishEvent: FinishEvent;
  isOnBizApp: boolean | null;
  platformType: string | null;
  connectedAt: string;
  sync?: {
    requestedAt: string;
    contacts: { status: SyncStatus; requestId: string | null };
    history: { status: SyncStatus; requestId: string | null };
  };
};

/** 'skipped' = never sent to Meta (the subscription gate refused). */
export type SyncStatus = 'requested' | 'failed' | 'skipped';
type SyncOutcome = { status: SyncStatus; requestId: string | null };

export type EsReadiness =
  | { ready: true; appId: string; configId: string }
  | { ready: false; reason: string };

export type EsConnectResult =
  | {
      ok: true;
      display: string;
      isOnBizApp: boolean | null;
      platformType: string | null;
      sync: { contacts: 'requested' | 'failed'; history: 'requested' | 'failed' };
    }
  | { ok: false; message: string };

export type EsConnectionRow = {
  label: string;
  status: string;
  createdAt: string;
  platformType: string | null;
  sync: { requestedAt: string; contacts: SyncStatus; history: SyncStatus } | null;
};

type EsSecrets = {
  appId: string;
  configId: string;
  appSecret: string;
  verifyToken: string | null;
};

async function loadEsSecrets(): Promise<EsSecrets | { reason: string }> {
  const appId = await resolveMetaAppId();
  if (!appId) return { reason: 'חסר מזהה אפליקציית Meta (META_APP_ID_WA).' };

  const configId = process.env.META_ES_CONFIG_ID?.trim() ?? '';
  if (!CONFIG_ID.test(configId)) {
    return {
      reason:
        'חסר מזהה התצורה של Embedded Signup (META_ES_CONFIG_ID). יוצרים אותו ב-Meta: Facebook Login for Business › Configurations.',
    };
  }

  const config = await getWhatsAppConfig();
  if (!config?.appSecret) {
    return { reason: 'חסר ה-App Secret של אפליקציית Meta בהגדרות WhatsApp.' };
  }
  return { appId, configId, appSecret: config.appSecret, verifyToken: config.verifyToken };
}

/** What the page needs to draw the button — never the app secret. */
export async function getEsReadiness(): Promise<EsReadiness> {
  await requirePlatformOwner();
  const s = await loadEsSecrets();
  if ('reason' in s) return { ready: false, reason: s.reason };
  return { ready: true, appId: s.appId, configId: s.configId };
}

/** The WABA ids the business token was granted, from Meta, not the browser. */
function wabaIdsFromScopes(scopes: Array<{ scope: string; targetIds: string[] }>): string[] {
  const ids = scopes
    .filter((g) => g.scope === 'whatsapp_business_management')
    .flatMap((g) => g.targetIds);
  return [...new Set(ids)];
}

/**
 * The app-level subscription must carry the Coexistence fields BEFORE the
 * one-shot sync runs, or the history it triggers is lost for good. Re-asserts
 * the subscription once (idempotent, the same call the hourly health check
 * makes) and reads it back.
 */
async function ensureAppSubscription(s: EsSecrets): Promise<boolean> {
  const read = async () =>
    readWhatsAppSubscription(
      await getAppSubscriptions({ appId: s.appId, appSecret: s.appSecret }),
    ).kind === 'ok';
  try {
    if (await read()) return true;
    if (!s.verifyToken) return false;
    await subscribeWhatsAppWebhook({
      appId: s.appId,
      appSecret: s.appSecret,
      callbackUrl: await getAppUrl('/api/webhooks/whatsapp'),
      verifyToken: s.verifyToken,
    });
    return await read();
  } catch {
    return false;
  }
}

async function runSync(
  phoneNumberId: string,
  token: string,
  appSecret: string,
  syncType: 'smb_app_state_sync' | 'history',
): Promise<{ status: 'requested' | 'failed'; requestId: string | null }> {
  try {
    const { requestId } = await requestSmbSync({ phoneNumberId, token, appSecret, syncType });
    return { status: 'requested', requestId };
  } catch {
    return { status: 'failed', requestId: null };
  }
}

export async function connectViaEmbeddedSignup(input: {
  code: string;
  finishEvent: FinishEvent;
}): Promise<EsConnectResult> {
  const user = await requirePlatformOwner();

  // 1. Only the flow the button launches. A plain FINISH needs a PIN and a
  // registration this version does not do — refuse before spending the code.
  if (input.finishEvent !== SUPPORTED_FINISH) {
    return { ok: false, message: 'סוג חיבור זה אינו נתמך בגרסה זו — רק חיבור מספר קיים מאפליקציית WhatsApp Business.' };
  }

  const secrets = await loadEsSecrets();
  if ('reason' in secrets) return { ok: false, message: secrets.reason };

  // 2. The code lives 30 seconds, so this is the first network call.
  let token: string;
  try {
    token = await exchangeCodeForBusinessToken({
      appId: secrets.appId,
      appSecret: secrets.appSecret,
      code: input.code,
    });
  } catch {
    return { ok: false, message: 'תוקף הקוד פג או שהחיבור נדחה. נסו שוב.' };
  }

  // 3. Which WABA — from Meta.
  let wabaIds: string[];
  let expiresAt: number | null;
  try {
    const info = await debugToken({ appId: secrets.appId, appSecret: secrets.appSecret, token });
    if (!info.isValid) return { ok: false, message: 'Meta החזירה טוקן לא תקף. נסו שוב.' };
    wabaIds = wabaIdsFromScopes(info.granularScopes);
    expiresAt = info.expiresAt;
  } catch {
    return { ok: false, message: 'לא ניתן היה לאמת את הטוקן מול Meta. נסו שוב.' };
  }
  if (wabaIds.length !== 1) {
    return {
      ok: false,
      message:
        wabaIds.length === 0
          ? 'החיבור לא העניק גישה לחשבון WhatsApp Business. נסו שוב ושתפו את החשבון בחלון של Meta.'
          : 'החיבור העניק גישה ליותר מחשבון WhatsApp Business אחד. חברו חשבון אחד בכל פעם.',
    };
  }
  const wabaId = wabaIds[0];

  // 4. The number the user picked inside Meta's flow — BEFORE subscribing to the
  // WABA: a subscription left behind for a WABA we then refuse, with no stored
  // token to undo it, would alert on every message sent there.
  let phoneNumberId: string;
  let display: string;
  try {
    const { numbers } = await listWabaPhoneNumbers({
      wabaId,
      accessToken: token,
      appSecret: secrets.appSecret,
    });
    if (numbers.length !== 1) {
      return {
        ok: false,
        message:
          numbers.length === 0
            ? 'לא נמצא מספר בחשבון שחובר.'
            : 'נמצאו כמה מספרים בחשבון שחובר — לא ניתן לקבוע איזה מהם חובר.',
      };
    }
    phoneNumberId = numbers[0].id;
    display = numbers[0].display_phone_number;
  } catch {
    return { ok: false, message: 'קריאת המספר מהחשבון שחובר נכשלה. נסו שוב.' };
  }

  // 5. Webhooks for this WABA.
  try {
    await subscribeAppToWaba({ wabaId, token, appSecret: secrets.appSecret });
  } catch {
    return { ok: false, message: 'רישום ה-webhooks לחשבון נכשל. נסו שוב.' };
  }

  // 6. Did Coexistence actually take.
  let status: { isOnBizApp: boolean | null; platformType: string | null };
  try {
    status = await getCoexistenceStatus({ phoneNumberId, token, appSecret: secrets.appSecret });
  } catch {
    status = { isOnBizApp: null, platformType: null };
  }

  // 7. Store the token BEFORE the one-shot sync: without a stored token there
  // is no way back to this connection once the sync has been spent.
  const meta: EsConnectionMeta = {
    wabaId,
    phoneNumberId,
    displayPhoneNumber: display,
    finishEvent: input.finishEvent,
    isOnBizApp: status.isOnBizApp,
    platformType: status.platformType,
    connectedAt: new Date().toISOString(),
  };
  const admin = createAdminClient();
  const { data: connectionId, error: writeError } = await admin.rpc(
    'integrations_write_credential',
    {
      p_provider: ES_PROVIDER,
      p_credential_kind: ES_KIND,
      p_label: `WhatsApp ${display}`,
      p_scopes: [],
      p_metadata: meta as unknown as Json,
      p_secret: token,
      // 0 is Meta's "never expires" (debug-token.ts); only a real deadline is stored.
      p_expires_at: expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null,
      // auth.uid() is NULL under the service role (measured in oauth-flow.ts).
      p_created_by: user.id,
    },
  );
  if (writeError || typeof connectionId !== 'string') {
    return { ok: false, message: 'שמירת החיבור נכשלה. לא הופעל סנכרון — נסו שוב.' };
  }

  // 8. The subscription gate. Refusing here leaves the syncs unspent; the
  // stored token cannot run them later (no code path does), so the honest
  // advice is to reconnect — not a fix window this app cannot honour.
  if (!(await ensureAppSubscription(secrets))) {
    const skipped: SyncOutcome = { status: 'skipped', requestId: null };
    await recordOutcome({ connectionId, meta, status, finishEvent: input.finishEvent, contacts: skipped, history: skipped });
    return {
      ok: false,
      message:
        'החיבור נשמר, אבל רישום ה-webhooks של האפליקציה לא הושלם, ולכן סנכרון אנשי הקשר וההיסטוריה לא הופעל. כדי לסנכרן צריך לנתק את המספר מהטלפון (הגדרות › חשבון › Business Platform) ולחבר מחדש.',
    };
  }

  // 9. The one-shot syncs. One failing does not cancel the other.
  const contacts = await runSync(phoneNumberId, token, secrets.appSecret, 'smb_app_state_sync');
  const history = await runSync(phoneNumberId, token, secrets.appSecret, 'history');

  // 10. Record + audit. From here on NOTHING may throw back to the action: the
  // syncs are spent, and a "failed, try again" would send the owner into a
  // second connection whose syncs Meta refuses.
  await recordOutcome({ connectionId, meta, status, finishEvent: input.finishEvent, contacts, history });

  return {
    ok: true,
    display,
    isOnBizApp: status.isOnBizApp,
    platformType: status.platformType,
    sync: { contacts: contacts.status, history: history.status },
  };
}

/**
 * Write the sync outcome onto the connection row, audit it, alert Slack.
 * Never throws: every step is best-effort and says so once.
 */
async function recordOutcome(input: {
  connectionId: string;
  meta: EsConnectionMeta;
  status: { isOnBizApp: boolean | null; platformType: string | null };
  finishEvent: FinishEvent;
  contacts: SyncOutcome;
  history: SyncOutcome;
}): Promise<void> {
  const { connectionId, meta, status, finishEvent, contacts, history } = input;

  try {
    const withSync: EsConnectionMeta = {
      ...meta,
      sync: { requestedAt: new Date().toISOString(), contacts, history },
    };
    const { error } = await createAdminClient()
      .from('integration_connections')
      .update({ metadata: withSync as unknown as Json, updated_at: new Date().toISOString() })
      .eq('id', connectionId);
    if (error) console.error('whatsapp-es: failed to record the sync outcome');
  } catch {
    console.error('whatsapp-es: failed to record the sync outcome');
  }

  // Audit — no ids, no phone number, no token. A credential was stored either
  // way, so this runs on the refused path too.
  try {
    await logActivity({
      action: 'admin.integrations.whatsapp_es_connected',
      meta: {
        finishEvent,
        platformType: status.platformType,
        isOnBizApp: status.isOnBizApp,
        contactsSync: contacts.status,
        historySync: history.status,
      },
    });
  } catch {
    console.error('whatsapp-es: failed to write the audit row');
  }

  const allRequested = contacts.status === 'requested' && history.status === 'requested';
  void sendSlackAlert({
    level: allRequested ? 'info' : 'warn',
    category: 'send_health',
    source: 'whatsapp-embedded-signup',
    title: 'מספר WhatsApp Business חובר ל-Cloud API (Coexistence)',
    fields: {
      platform_type: status.platformType ?? 'unknown',
      contacts_sync: contacts.status,
      history_sync: history.status,
    },
  });
}

/** Connections for the page — display fields only; no ids, Vault refs or tokens. */
export async function listEsConnections(): Promise<EsConnectionRow[]> {
  await requirePlatformPermission('manage_settings');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('integration_connections')
    .select('label, status, created_at, metadata')
    .eq('provider', ES_PROVIDER)
    .order('created_at', { ascending: false });
  if (error) throw new Error('טעינת חיבורי WhatsApp נכשלה');

  return (data ?? []).map((row) => {
    const meta = (row.metadata ?? {}) as Partial<EsConnectionMeta>;
    return {
      label: row.label,
      status: row.status,
      createdAt: row.created_at,
      platformType: typeof meta.platformType === 'string' ? meta.platformType : null,
      sync:
        meta.sync && typeof meta.sync.requestedAt === 'string'
          ? {
              requestedAt: meta.sync.requestedAt,
              contacts: meta.sync.contacts?.status ?? 'failed',
              history: meta.sync.history?.status ?? 'failed',
            }
          : null,
    };
  });
}
