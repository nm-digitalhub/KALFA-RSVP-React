import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getPaymentsEnabled,
  getSumitPublicConfig,
  getSumitServerConfig,
} from '@/lib/data/payments';

// payments.ts begins with `import 'server-only'`, which throws outside Next's
// RSC context. Vitest does not set that export condition.
vi.mock('server-only', () => ({}));
// app_settings is admin-only RLS, so payments.ts reads via the service-role
// admin client. createAdminClient() is synchronous and returns the client.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

type Row = Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
});

function mockAdmin(result: { data: Row | null; error: { message: string } | null }) {
  const { client } = createMockSupabase<Row>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
}

function mockAdminThrows() {
  vi.mocked(createAdminClient).mockImplementation(() => {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  });
}

describe('getPaymentsEnabled', () => {
  it('returns true when the flag is on', async () => {
    mockAdmin({ data: { payments_enabled: true }, error: null });
    await expect(getPaymentsEnabled()).resolves.toBe(true);
  });

  it('returns false when the flag is off', async () => {
    mockAdmin({ data: { payments_enabled: false }, error: null });
    await expect(getPaymentsEnabled()).resolves.toBe(false);
  });

  it('fail-safe: returns false on a query error', async () => {
    mockAdmin({ data: null, error: { message: 'boom' } });
    await expect(getPaymentsEnabled()).resolves.toBe(false);
  });

  it('fail-safe: returns false when the service-role key is a placeholder (throws)', async () => {
    mockAdminThrows();
    await expect(getPaymentsEnabled()).resolves.toBe(false);
  });
});

describe('getSumitServerConfig', () => {
  it('returns the secret config when fully set', async () => {
    mockAdmin({
      data: { sumit_company_id: '12345', sumit_api_key: 'secret-key' },
      error: null,
    });
    await expect(getSumitServerConfig()).resolves.toEqual({
      companyId: 12345,
      apiKey: 'secret-key',
    });
  });

  it('returns null when the api key is missing', async () => {
    mockAdmin({
      data: { sumit_company_id: '12345', sumit_api_key: null },
      error: null,
    });
    await expect(getSumitServerConfig()).resolves.toBeNull();
  });

  it('returns null when the company id is not a positive number', async () => {
    mockAdmin({
      data: { sumit_company_id: '', sumit_api_key: 'secret-key' },
      error: null,
    });
    await expect(getSumitServerConfig()).resolves.toBeNull();
  });
});

describe('getSumitPublicConfig', () => {
  it('returns the public config when set', async () => {
    mockAdmin({
      data: { sumit_company_id: '777', sumit_api_public_key: 'pub-key' },
      error: null,
    });
    await expect(getSumitPublicConfig()).resolves.toEqual({
      companyId: 777,
      apiPublicKey: 'pub-key',
    });
  });

  it('returns null when the public key is missing', async () => {
    mockAdmin({
      data: { sumit_company_id: '777', sumit_api_public_key: null },
      error: null,
    });
    await expect(getSumitPublicConfig()).resolves.toBeNull();
  });
});
