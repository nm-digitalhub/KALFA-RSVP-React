import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/provider-numbers-resolve', () => ({
  resolveNumberForRole: vi.fn(),
}));

import { readFileSync } from 'node:fs';

import { resolveNumberForRole } from '@/lib/data/provider-numbers-resolve';
import { getWhatsAppImportChannel } from './whatsapp-import-channel';

beforeEach(() => vi.clearAllMocks());

describe('getWhatsAppImportChannel', () => {
  it('returns the number and its wa.me link when the role is assigned', async () => {
    vi.mocked(resolveNumberForRole).mockResolvedValue({
      e164: '+97233301505',
      providerRef: '1298694319994421',
    });
    await expect(getWhatsAppImportChannel()).resolves.toEqual({
      displayNumber: '+97233301505',
      waMeUrl: 'https://wa.me/97233301505',
    });
    expect(resolveNumberForRole).toHaveBeenCalledWith('whatsapp_import_sender');
  });

  it('null when the role is unassigned — the screen keeps its legacy copy', async () => {
    vi.mocked(resolveNumberForRole).mockResolvedValue(null);
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
  });

  it('null when the row carries no Meta phone_number_id (nothing routes there)', async () => {
    vi.mocked(resolveNumberForRole).mockResolvedValue({
      e164: '+97233301505',
      providerRef: null,
    });
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
  });

  it('null when there is no E.164 to show, or it does not normalize (no broken link)', async () => {
    vi.mocked(resolveNumberForRole).mockResolvedValue({
      e164: null,
      providerRef: 'x',
    });
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();

    vi.mocked(resolveNumberForRole).mockResolvedValue({
      e164: 'call us',
      providerRef: 'x',
    });
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
  });

  it('a read failure degrades to null rather than throwing into the guests page', async () => {
    // resolveNumberForRole is the FAIL-SAFE reader — it answers null on an
    // error. This pins that this module uses that one and not the strict twin.
    vi.mocked(resolveNumberForRole).mockResolvedValue(null);
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
  });

  it('SECRET-FREE by construction: never reaches app_settings or the token', () => {
    // Structural, not behavioural: this module feeds a client component, so the
    // access token must have no path into it. app_settings is where the token
    // lives; getWhatsAppChannel/getWhatsAppConfig are what load it.
    const src = readFileSync(
      new URL('./whatsapp-import-channel.ts', import.meta.url),
      'utf8',
    );
    const code = src
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toContain('app_settings');
    expect(code).not.toContain('accessToken');
    expect(code).not.toContain('outreach-config');
  });
});
