export type OAuthProviderConfigState = {
  exists: boolean;
  configured: boolean;
  enabled: boolean;
};

export type OAuthProviderAvailability = {
  canConnect: boolean;
  reason: string | null;
  source: 'database' | 'system' | 'none';
};

/**
 * Resolves the effective availability of an interactive OAuth provider.
 *
 * DB-over-env precedence is deliberate and strict: once an operator has created
 * a provider row, that row is authoritative even when it is disabled or missing
 * a secret. This preserves the row as a durable kill switch and prevents a
 * stale deployment secret from silently re-enabling a provider.
 */
export function resolveOAuthProviderAvailability(args: {
  config: OAuthProviderConfigState;
  systemConfigured: boolean;
  canManage: boolean;
  providerName: string;
}): OAuthProviderAvailability {
  const { config, systemConfigured, canManage, providerName } = args;

  if (!canManage) {
    return {
      canConnect: false,
      reason: 'נדרשת הרשאת ניהול אינטגרציות כדי לחבר חשבון חדש.',
      source: config.exists ? 'database' : systemConfigured ? 'system' : 'none',
    };
  }

  if (config.exists) {
    if (!config.enabled) {
      return {
        canConnect: false,
        reason: `ספק ${providerName} כבוי. יש להפעיל אותו בעמוד האינטגרציות.`,
        source: 'database',
      };
    }

    if (!config.configured) {
      return {
        canConnect: false,
        reason: `הגדרת ${providerName} קיימת אך חסר Client Secret שמור.`,
        source: 'database',
      };
    }

    return { canConnect: true, reason: null, source: 'database' };
  }

  if (systemConfigured) {
    return { canConnect: true, reason: null, source: 'system' };
  }

  return {
    canConnect: false,
    reason: `חיבור ${providerName} אינו מוגדר ברמת המערכת.`,
    source: 'none',
  };
}
