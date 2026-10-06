import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { debugToken } from '@/lib/whatsapp/debug-token';
import { resolveMetaAppId } from '@/lib/whatsapp/meta-app-id';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

// The Meta connection as Meta describes it, rather than as our own columns
// describe it.
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

  const appId = await resolveMetaAppId();
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
