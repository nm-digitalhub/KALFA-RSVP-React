import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/data/sumit-customers', () => ({ readSumitCustomerNumber: vi.fn() }));
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
import { getProfile } from '@/lib/data/profiles';
import { readSumitCustomerNumber } from '@/lib/data/sumit-customers';
import { getUserSettings } from '@/lib/data/user-settings';
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

describe('SettingsPage — SUMIT customer number', () => {
  type Props = { customerNumber: number | null; loadError: boolean };

  function signedIn(number: number | null) {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: 'dana@example.com' } as never);
    vi.mocked(getProfile).mockResolvedValue(null);
    vi.mocked(getUserSettings).mockResolvedValue(null);
    vi.mocked(readSumitCustomerNumber).mockResolvedValue(number);
  }

  it("reads the number for the VERIFIED user's id (never a browser value) and hands it to the screen", async () => {
    signedIn(2127277236);

    const tree = (await SettingsPage()) as ReactElement<Props>;

    expect(readSumitCustomerNumber).toHaveBeenCalledWith('u-1');
    expect(tree.props.customerNumber).toBe(2127277236);
    expect(tree.props.loadError).toBe(false);
  });

  it('passes null for an account that has not paid yet', async () => {
    signedIn(null);

    const tree = (await SettingsPage()) as ReactElement<Props>;

    expect(tree.props.customerNumber).toBeNull();
    expect(tree.props.loadError).toBe(false);
  });

  it('a failure to read the number is shown as a load problem, not as an empty field', async () => {
    signedIn(1);
    vi.mocked(readSumitCustomerNumber).mockRejectedValue(new Error('טעינת מספר הלקוח נכשלה'));

    const tree = (await SettingsPage()) as ReactElement<Props>;

    expect(tree.props.loadError).toBe(true);
  });
});
