import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ updateProfile: vi.fn() }));
vi.mock('@/lib/data/user-settings', () => ({ updateUserSettings: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { updateProfile } from '@/lib/data/profiles';
import { updateProfileAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('updateProfileAction — Next.js control-flow signals', () => {
  const FIELDS = { full_name: 'דנה', phone: '0501234567' };

  it('propagates a NEXT_REDIRECT from updateProfile (requireUser) instead of returning { error }', async () => {
    vi.mocked(updateProfile).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateProfileAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateProfile).mockRejectedValue(new Error('db down'));

    const result = await updateProfileAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'שמירת הפרטים נכשלה. נסו שוב.' });
  });
});
