import { describe, expect, it } from 'vitest';

import { resolveOAuthProviderAvailability } from './provider-availability';

const absent = { exists: false, configured: false, enabled: false };
const active = { exists: true, configured: true, enabled: true };

describe('resolveOAuthProviderAvailability', () => {
  it('uses the system client only when no DB row exists', () => {
    expect(
      resolveOAuthProviderAvailability({
        config: absent,
        systemConfigured: true,
        canManage: true,
        providerName: 'Microsoft 365',
      }),
    ).toEqual({ canConnect: true, reason: null, source: 'system' });
  });

  it('prefers an active DB row over the system client', () => {
    expect(
      resolveOAuthProviderAvailability({
        config: active,
        systemConfigured: true,
        canManage: true,
        providerName: 'Microsoft 365',
      }),
    ).toEqual({ canConnect: true, reason: null, source: 'database' });
  });

  it('treats a disabled DB row as an authoritative kill switch even when env is configured', () => {
    const result = resolveOAuthProviderAvailability({
      config: { ...active, enabled: false },
      systemConfigured: true,
      canManage: true,
      providerName: 'Microsoft 365',
    });

    expect(result.canConnect).toBe(false);
    expect(result.source).toBe('database');
    expect(result.reason).toContain('כבוי');
  });

  it('does not fall back to env when an existing DB row is missing its secret', () => {
    const result = resolveOAuthProviderAvailability({
      config: { ...active, configured: false },
      systemConfigured: true,
      canManage: true,
      providerName: 'Microsoft 365',
    });

    expect(result.canConnect).toBe(false);
    expect(result.source).toBe('database');
    expect(result.reason).toContain('Client Secret');
  });

  it('reports missing system configuration only when there is no DB row and no env client', () => {
    const result = resolveOAuthProviderAvailability({
      config: absent,
      systemConfigured: false,
      canManage: true,
      providerName: 'Microsoft 365',
    });

    expect(result.canConnect).toBe(false);
    expect(result.source).toBe('none');
    expect(result.reason).toContain('אינו מוגדר ברמת המערכת');
  });

  it('keeps the permission gate outermost', () => {
    const result = resolveOAuthProviderAvailability({
      config: active,
      systemConfigured: true,
      canManage: false,
      providerName: 'Microsoft 365',
    });

    expect(result.canConnect).toBe(false);
    expect(result.reason).toContain('הרשאת ניהול אינטגרציות');
  });
});
