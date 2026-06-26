import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { ProfileDTO } from '@/lib/data/profiles';
import { getProfile, updateProfile } from '@/lib/data/profiles';

// `profiles.ts` and `dal.ts` begin with `import 'server-only'`, which throws
// outside Next's RSC context. Vitest does not set that export condition.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

// The exact column projection profiles.ts requests — this string IS the DTO
// contract; the data functions return rows pass-through.
const PROFILE_COLUMNS = 'id, full_name, phone, updated_at';

const USER_ID = 'user-123';

function mockUser(): User {
  return { id: USER_ID } as unknown as User;
}

function sampleRow(overrides: Partial<ProfileDTO> = {}): ProfileDTO {
  return {
    id: USER_ID,
    full_name: 'דנה כהן',
    phone: '050-123-4567',
    updated_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(mockUser());
});

describe('getProfile', () => {
  it('filters by the verified user id (id = user.id), not a browser value', async () => {
    const { client, builder } = createMockSupabase<ProfileDTO>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await getProfile();

    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(builder.eq).toHaveBeenCalledWith('id', USER_ID);
  });

  it('requests exactly the DTO columns', async () => {
    const { client, builder } = createMockSupabase<ProfileDTO>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await getProfile();

    expect(builder.select).toHaveBeenCalledWith(PROFILE_COLUMNS);
  });

  it('returns null when no profile row exists yet', async () => {
    const { client } = createMockSupabase<ProfileDTO>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getProfile()).resolves.toBeNull();
  });

  it('throws a safe Hebrew error when the query fails', async () => {
    const { client } = createMockSupabase<ProfileDTO>({
      data: null,
      error: { message: 'db exploded' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getProfile()).rejects.toThrow('טעינת הפרופיל נכשלה');
  });
});

describe('updateProfile', () => {
  const fields = { full_name: 'יוסי לוי', phone: '052-987-6543' };

  it('upserts with the id derived server-side from the verified user', async () => {
    const { client, builder } = createMockSupabase<ProfileDTO>({
      data: sampleRow({ full_name: fields.full_name, phone: fields.phone }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await updateProfile(fields);

    // Security-critical: id comes from the session, never from the form, and the
    // caller's editable fields ride along.
    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID, ...fields }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'profile.updated',
      }),
    );
  });

  it('selects exactly the DTO columns on the returned row', async () => {
    const { client, builder } = createMockSupabase<ProfileDTO>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await updateProfile(fields);

    expect(builder.select).toHaveBeenCalledWith(PROFILE_COLUMNS);
  });

  it('returns the upserted row', async () => {
    const row = sampleRow({ full_name: fields.full_name, phone: fields.phone });
    const { client } = createMockSupabase<ProfileDTO>({ data: row, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(updateProfile(fields)).resolves.toEqual(row);
  });

  it('throws a safe Hebrew error when the upsert fails', async () => {
    const { client } = createMockSupabase<ProfileDTO>({
      data: null,
      error: { message: 'upsert failed' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(updateProfile(fields)).rejects.toThrow('שמירת הפרופיל נכשלה');
  });

  it('clears values when null is passed (stored as NULL)', async () => {
    const { client, builder } = createMockSupabase<ProfileDTO>({
      data: sampleRow({ full_name: null, phone: null }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await updateProfile({ full_name: null, phone: null });

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID, full_name: null, phone: null }),
    );
  });
});
