import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/cookie-consent', () => ({
  updateCookieConsentEnabled: vi.fn(),
  updateCookieConsentAnalyticsEnabled: vi.fn(),
  updateCookieConsentMarketingEnabled: vi.fn(),
  bumpCookieConsentRevision: vi.fn(),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { revalidatePath } from 'next/cache';
import {
  updateCookieConsentEnabled,
  updateCookieConsentAnalyticsEnabled,
  updateCookieConsentMarketingEnabled,
  bumpCookieConsentRevision,
} from '@/lib/data/admin/cookie-consent';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  updateCookieConsentEnabledAction,
  updateCookieConsentAnalyticsEnabledAction,
  updateCookieConsentMarketingEnabledAction,
  bumpCookieConsentRevisionAction,
} from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('updateCookieConsentEnabledAction', () => {
  it('enables when the checkbox is "on", saves, audits, and invalidates everywhere', async () => {
    vi.mocked(updateCookieConsentEnabled).mockResolvedValue({ changed: true, revisionBump: 6 });
    const result = await updateCookieConsentEnabledAction({}, fd({ cookie_consent_enabled: 'on' }));
    expect(updateCookieConsentEnabled).toHaveBeenCalledWith(true);
    expect(result?.notice).toContain('הופעל');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', category: 'security' }),
    );
  });

  it('an absent checkbox means disabled — unchecked checkboxes are omitted from FormData', async () => {
    vi.mocked(updateCookieConsentEnabled).mockResolvedValue({ changed: true, revisionBump: 1 });
    const result = await updateCookieConsentEnabledAction({}, fd({}));
    expect(updateCookieConsentEnabled).toHaveBeenCalledWith(false);
    expect(result?.notice).toContain('כובה');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('no-op (owner live-test finding, 27.7): submitting the value it already has skips the audit/alert and shows a distinct notice', async () => {
    vi.mocked(updateCookieConsentEnabled).mockResolvedValue({ changed: false, revisionBump: 5 });
    const result = await updateCookieConsentEnabledAction({}, fd({ cookie_consent_enabled: 'on' }));
    expect(result?.notice).toContain('לא בוצע שינוי');
    expect(sendSlackAlert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('propagates a NEXT_REDIRECT from the DAL instead of returning { error }', async () => {
    vi.mocked(updateCookieConsentEnabled).mockRejectedValue(NEXT_REDIRECT);
    await expect(
      updateCookieConsentEnabledAction({}, fd({ cookie_consent_enabled: 'on' })),
    ).rejects.toBe(NEXT_REDIRECT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns a safe Hebrew error and does not audit/invalidate on a real failure', async () => {
    vi.mocked(updateCookieConsentEnabled).mockRejectedValue(new Error('db down'));
    const result = await updateCookieConsentEnabledAction({}, fd({ cookie_consent_enabled: 'on' }));
    expect(result?.error).toBeTruthy();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('updateCookieConsentAnalyticsEnabledAction / updateCookieConsentMarketingEnabledAction', () => {
  it('analytics toggle calls the analytics DAL fn only', async () => {
    vi.mocked(updateCookieConsentAnalyticsEnabled).mockResolvedValue({
      changed: true,
      revisionBump: 1,
    });
    await updateCookieConsentAnalyticsEnabledAction(
      {},
      fd({ cookie_consent_analytics_enabled: 'on' }),
    );
    expect(updateCookieConsentAnalyticsEnabled).toHaveBeenCalledWith(true);
    expect(updateCookieConsentMarketingEnabled).not.toHaveBeenCalled();
  });

  it('marketing toggle calls the marketing DAL fn only', async () => {
    vi.mocked(updateCookieConsentMarketingEnabled).mockResolvedValue({
      changed: true,
      revisionBump: 1,
    });
    await updateCookieConsentMarketingEnabledAction({}, fd({}));
    expect(updateCookieConsentMarketingEnabled).toHaveBeenCalledWith(false);
    expect(updateCookieConsentAnalyticsEnabled).not.toHaveBeenCalled();
  });

  it('analytics no-op skips the audit/alert too', async () => {
    vi.mocked(updateCookieConsentAnalyticsEnabled).mockResolvedValue({
      changed: false,
      revisionBump: 2,
    });
    const result = await updateCookieConsentAnalyticsEnabledAction(
      {},
      fd({ cookie_consent_analytics_enabled: 'on' }),
    );
    expect(result?.notice).toContain('לא בוצע שינוי');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('marketing no-op skips the audit/alert too', async () => {
    vi.mocked(updateCookieConsentMarketingEnabled).mockResolvedValue({
      changed: false,
      revisionBump: 2,
    });
    const result = await updateCookieConsentMarketingEnabledAction({}, fd({}));
    expect(result?.notice).toContain('לא בוצע שינוי');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('bumpCookieConsentRevisionAction', () => {
  it('bumps, invalidates everywhere, and reports the new revision number', async () => {
    vi.mocked(bumpCookieConsentRevision).mockResolvedValue(9);
    const result = await bumpCookieConsentRevisionAction({}, fd({}));
    expect(result?.notice).toContain('9');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('returns a safe error on failure without invalidating', async () => {
    vi.mocked(bumpCookieConsentRevision).mockRejectedValue(new Error('db down'));
    const result = await bumpCookieConsentRevisionAction({}, fd({}));
    expect(result?.error).toBeTruthy();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
