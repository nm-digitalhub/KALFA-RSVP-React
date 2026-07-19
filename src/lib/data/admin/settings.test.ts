import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getInfraConfigStatus } from './settings';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as never);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getInfraConfigStatus', () => {
  it('reports SUPABASE_SERVICE_ROLE_KEY as configured:false when unset', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const items = await getInfraConfigStatus();

    expect(
      items.find((i) => i.key === 'SUPABASE_SERVICE_ROLE_KEY')?.configured,
    ).toBe(false);
  });

  it('reports SUPABASE_SERVICE_ROLE_KEY as configured:false for the placeholder value', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service-role-key';

    const items = await getInfraConfigStatus();

    expect(
      items.find((i) => i.key === 'SUPABASE_SERVICE_ROLE_KEY')?.configured,
    ).toBe(false);
  });

  it('reports SUPABASE_SERVICE_ROLE_KEY as configured:true for a real value', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-real-looking-service-role-key';

    const items = await getInfraConfigStatus();

    expect(
      items.find((i) => i.key === 'SUPABASE_SERVICE_ROLE_KEY')?.configured,
    ).toBe(true);
  });

  it('gates on requirePlatformPermission and never evaluates config when it redirects', async () => {
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(redirectErr);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-real-looking-service-role-key';

    await expect(getInfraConfigStatus()).rejects.toThrow('NEXT_REDIRECT');
  });
});
