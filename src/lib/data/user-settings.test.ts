import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { UserSettingsDTO } from '@/lib/data/user-settings';
import { getUserSettings, updateUserSettings } from '@/lib/data/user-settings';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

const SETTINGS_COLUMNS =
  'user_id, event_updates, reminder_updates, billing_updates, updated_at';
const USER_ID = 'user-123';

function mockUser(): User {
  return { id: USER_ID } as unknown as User;
}

function sampleRow(overrides: Partial<UserSettingsDTO> = {}): UserSettingsDTO {
  return {
    user_id: USER_ID,
    event_updates: true,
    reminder_updates: true,
    billing_updates: false,
    updated_at: '2026-06-24T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(mockUser());
});

describe('getUserSettings', () => {
  it('filters by the verified user id', async () => {
    const { client, builder } = createMockSupabase<UserSettingsDTO>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await getUserSettings();

    expect(client.from).toHaveBeenCalledWith('user_settings');
    expect(builder.select).toHaveBeenCalledWith(SETTINGS_COLUMNS);
    expect(builder.eq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('returns null when the user has no settings row yet', async () => {
    const { client } = createMockSupabase<UserSettingsDTO>({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getUserSettings()).resolves.toBeNull();
  });

  it('throws a safe Hebrew error when loading fails', async () => {
    const { client } = createMockSupabase<UserSettingsDTO>({
      data: null,
      error: { message: 'db exploded' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getUserSettings()).rejects.toThrow('טעינת ההגדרות נכשלה');
  });
});

describe('updateUserSettings', () => {
  const fields = {
    event_updates: false,
    reminder_updates: true,
    billing_updates: false,
  };

  it('upserts with user_id derived from the verified session', async () => {
    const { client, builder } = createMockSupabase<UserSettingsDTO>({
      data: sampleRow(fields),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await updateUserSettings(fields);

    expect(client.from).toHaveBeenCalledWith('user_settings');
    expect(builder.upsert).toHaveBeenCalledWith({ user_id: USER_ID, ...fields });
    expect(builder.select).toHaveBeenCalledWith(SETTINGS_COLUMNS);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.updated',
      }),
    );
  });

  it('throws a safe Hebrew error when saving fails', async () => {
    const { client } = createMockSupabase<UserSettingsDTO>({
      data: null,
      error: { message: 'upsert failed' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(updateUserSettings(fields)).rejects.toThrow('שמירת ההגדרות נכשלה');
  });
});
