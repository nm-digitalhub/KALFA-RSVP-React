// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn(async () => ({ name: 'KALFA' })) }));
vi.mock('@/lib/consent/admin-config', () => ({
  getCookieConsentPublicConfig: vi.fn(async () => ({ analyticsEnabled: true, marketingEnabled: true })),
}));
vi.mock('@/lib/data/marketing-consent', () => ({ isMarketingConsentEnabled: vi.fn() }));
vi.mock('@/components/consent/manage-cookies-button', () => ({ ManageCookiesButton: () => null }));

import { isMarketingConsentEnabled } from '@/lib/data/marketing-consent';

import PrivacyPage from './page';

afterEach(cleanup);

async function text(enabled: boolean): Promise<string> {
  vi.mocked(isMarketingConsentEnabled).mockResolvedValue(enabled);
  const { container } = render((await PrivacyPage()) as ReactElement);
  return container.textContent ?? '';
}

// The marketing-email passages are a draft awaiting approval; they go live only with the feature's switch, so the
// published policy matches what is running (openspec change marketing-email-consent, task 7.1).
describe('privacy page — marketing email passages', () => {
  it('switched off: the approved text, unchanged', async () => {
    const t = await text(false);
    expect(t).toContain('המידע משמש אך ורק לאספקת השירות');
    expect(t).toContain('עודכן לאחרונה: יוני 2026');
    expect(t).not.toContain('Resend');
    expect(t).not.toContain('הסכמה לדיוור בדוא״ל');
  });

  it('switched on: marketing email to consenting owners only, Resend named, guests excluded', async () => {
    const t = await text(true);
    expect(t).not.toContain('המידע משמש אך ורק לאספקת השירות');
    expect(t).toContain('ורק לבעלי אירוע שהסכימו לכך במפורש');
    expect(t).toContain('Resend');
    expect(t).toContain('לאורחים ולאנשי קשר של אירועים איננו שולחים דיוור של KALFA בשום מקרה');
    expect(t).toContain('עודכן לאחרונה: אוקטובר 2026');
  });
});
