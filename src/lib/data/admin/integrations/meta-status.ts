import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { debugToken } from '@/lib/whatsapp/debug-token';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

// The Meta connection as Meta describes it, rather than as our own columns
// describe it. Closes gap G7 (nothing ever asked whether the token was still
// valid) and the readable half of G8.
//
// WHY THIS IS NOT "configured: true" AGAIN. The panel already derives
// `configured` from our app_settings row — phone-number-id present, token
// present. That says a value was typed in, not that it still works. A System
// User token whose data-access window lapses keeps its shape, so the panel
// would go on reporting a healthy channel while every send failed. The two
// answers are different questions and they are shown side by side.
//
// SECRETS: this module reads the token and the app secret to ASK about them and
// returns neither. What leaves is booleans, unix timestamps and scope names. It
// is a data-layer module, so the permission gate lives here and not only on the
// page (a Server Action reaching it directly never runs the page's gate).

/** Scopes a WhatsApp System User token must carry for this product to work. */
export const REQUIRED_SCOPES = [
  'whatsapp_business_messaging',
  'whatsapp_business_management',
  'business_management',
] as const;

export type MetaStatus = {
  /** Our own columns: is there something to check at all. */
  configured: boolean;
  /** Which Graph version every WhatsApp call in this system goes out on. */
  graphVersion: string;
  /**
   * null = the check could not run. `reason` says why, and the distinction
   * matters: "we could not ask" must never render as "the token is bad".
   */
  token: {
    isValid: boolean;
    /** Unix seconds; 0 is what Meta returns for a token with no expiry. */
    expiresAt: number | null;
    /** Unix seconds — the System User data-access deadline. */
    dataAccessExpiresAt: number | null;
    grantedScopes: string[];
    missingScopes: string[];
    invalidReason: string | null;
  } | null;
  /** Present only when `token` is null. Safe to render; never a secret. */
  reason: string | null;
};

/**
 * The Meta app id. Not a secret (it is public in every OAuth URL), but it is
 * the one input `debug_token` needs that we do not already hold in
 * app_settings.
 *
 * Read from app_settings FIRST and from the environment only as a fallback.
 * The column does not exist yet — §4.4 of the consolidation plan adds
 * `whatsapp_app_id` in Phase 5 — so today this always resolves from env. The
 * order is written this way now, rather than after the migration, so landing
 * that column is a migration and nothing else: `select('*')` simply omits a
 * column that is not there, which is the same forward-compatible pattern
 * getWhatsAppConfig documents.
 */
async function resolveAppId(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    const fromRow = (data as Record<string, unknown> | null)?.whatsapp_app_id;
    if (typeof fromRow === 'string' && fromRow.trim() !== '') return fromRow.trim();
  } catch {
    // Fall through to env — a settings read failure must not be reported as
    // "no app id configured".
  }
  const fromEnv = process.env.META_APP_ID_WA?.trim();
  return fromEnv ? fromEnv : null;
}

export async function getMetaStatus(): Promise<MetaStatus> {
  await requirePlatformPermission('manage_settings');

  const config = await getWhatsAppConfig();
  const base = { graphVersion: GRAPH_API_VERSION } as const;

  if (!config) {
    return { ...base, configured: false, token: null, reason: null };
  }
  if (!config.appSecret) {
    return {
      ...base,
      configured: true,
      token: null,
      reason:
        'לא נשמר app secret, ולכן אי אפשר לשאול את Meta על הטוקן. השלימו אותו בטופס פרטי ההתחברות.',
    };
  }

  const appId = await resolveAppId();
  if (!appId) {
    return {
      ...base,
      configured: true,
      token: null,
      reason:
        'חסר מזהה אפליקציית Meta (META_APP_ID_WA). בלעדיו אי אפשר לבנות את טוקן האפליקציה ש-debug_token דורש.',
    };
  }

  try {
    const result = await debugToken({
      appId,
      appSecret: config.appSecret,
      token: config.accessToken,
    });
    const granted = new Set(result.scopes);
    return {
      ...base,
      configured: true,
      reason: null,
      token: {
        isValid: result.isValid,
        expiresAt: result.expiresAt,
        dataAccessExpiresAt: result.dataAccessExpiresAt,
        grantedScopes: result.scopes,
        missingScopes: REQUIRED_SCOPES.filter((s) => !granted.has(s)),
        invalidReason: result.invalidReason,
      },
    };
  } catch {
    // Deliberately no error detail: debugToken's messages are already
    // secret-free, but the failure modes it distinguishes (bad app pair vs a
    // 502 from Meta) are both "we could not ask" from the reader's side, and
    // the wrong wording here would read as "your token is broken".
    return {
      ...base,
      configured: true,
      token: null,
      reason: 'לא הצלחנו לשאול את Meta על הטוקן כרגע. נסו לרענן בעוד רגע.',
    };
  }
}
