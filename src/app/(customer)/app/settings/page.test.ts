import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/data/user-settings', () => ({
  DEFAULT_USER_SETTINGS: {
    event_updates: true,
    reminder_updates: true,
    billing_updates: true,
  },
  getUserSettings: vi.fn(),
}));
vi.mock('./settings-client', () => ({
  SettingsPageClient: (props: unknown) => ({
    type: 'SettingsPageClient',
    props,
  }),
}));

import { requireUser } from '@/lib/auth/dal';
import SettingsPage from './page';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

describe('SettingsPage', () => {
  it('propagates a NEXT_REDIRECT from requireUser (unauthenticated -> login) instead of rendering loadError', async () => {
    vi.mocked(requireUser).mockRejectedValue(NEXT_REDIRECT);

    await expect(SettingsPage()).rejects.toThrow('NEXT_REDIRECT');
  });

  it('converts a genuine load failure into loadError=true, not a thrown error', async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error('db down'));

    const tree = (await SettingsPage()) as ReactElement<{ loadError: boolean }>;

    expect(tree.props.loadError).toBe(true);
  });
});
