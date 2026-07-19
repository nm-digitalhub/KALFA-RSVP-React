import { afterEach, describe, expect, it, vi } from 'vitest';

// server-only stub (repo convention: voximplant-reconcile.test.ts).
vi.mock('server-only', () => ({}));

const { getConfigMock, adminMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  adminMock: vi.fn(),
}));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: getConfigMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/voximplant/core', () => ({
  getCallHistory: vi.fn(),
  signManagementJwt: () => 'JWT',
}));
vi.mock('@/lib/voximplant/log-download', () => ({ downloadLogFile: vi.fn() }));

import { runLogExport, shouldAlertLogExport } from './vox-log-export';

afterEach(() => vi.clearAllMocks());

describe('shouldAlertLogExport (pure)', () => {
  it('pages only when every processed row failed', () => {
    expect(shouldAlertLogExport({ claimed: 3, stored: 0, noLog: 0, failed: 3, purged: 0 })).toBe(
      true,
    );
  });
  it('is silent when anything stored or resolved as no_log', () => {
    expect(shouldAlertLogExport({ claimed: 3, stored: 1, noLog: 0, failed: 2, purged: 0 })).toBe(
      false,
    );
    expect(shouldAlertLogExport({ claimed: 2, stored: 0, noLog: 2, failed: 0, purged: 0 })).toBe(
      false,
    );
  });
  it('is silent on an empty run', () => {
    expect(shouldAlertLogExport({ claimed: 0, stored: 0, noLog: 0, failed: 0, purged: 0 })).toBe(
      false,
    );
  });
});

describe('runLogExport dark-safe gate', () => {
  it('is a no-op when the Voximplant channel is not configured', async () => {
    getConfigMock.mockResolvedValue(null);
    const summary = await runLogExport();
    expect(summary).toEqual({ claimed: 0, stored: 0, noLog: 0, failed: 0, purged: 0 });
    // Must not even construct the admin client when config is absent.
    expect(adminMock).not.toHaveBeenCalled();
  });
});
