import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `admin.ts` starts with `import 'server-only'`, whose default export throws
// outside the React Server Component context Next.js provides. Vitest does not
// set that export condition, so we stub the module to an empty object. We mock
// it here (in the test) rather than touching the shared vitest config.
vi.mock('server-only', () => ({}));

describe('createAdminClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('throws when the service-role key is the placeholder value', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service-role-key';

    const { createAdminClient } = await import('./admin');
    expect(() => createAdminClient()).toThrow(
      'SUPABASE_SERVICE_ROLE_KEY is not configured',
    );
  });

  it('throws when the service-role key is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { createAdminClient } = await import('./admin');
    expect(() => createAdminClient()).toThrow(
      'SUPABASE_SERVICE_ROLE_KEY is not configured',
    );
  });

  it('throws when the Supabase URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-real-looking-key';

    const { createAdminClient } = await import('./admin');
    expect(() => createAdminClient()).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL is not configured',
    );
  });

  it('constructs a client when URL and a non-placeholder key are present', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-real-looking-service-role-key';

    const { createAdminClient } = await import('./admin');
    expect(() => createAdminClient()).not.toThrow();
  });
});

describe('isConfiguredServiceRoleKey', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns false for undefined', async () => {
    const { isConfiguredServiceRoleKey } = await import('./admin');
    expect(isConfiguredServiceRoleKey(undefined)).toBe(false);
  });

  it('returns false for an empty string', async () => {
    const { isConfiguredServiceRoleKey } = await import('./admin');
    expect(isConfiguredServiceRoleKey('')).toBe(false);
  });

  it('returns false for the placeholder value', async () => {
    const { isConfiguredServiceRoleKey } = await import('./admin');
    expect(isConfiguredServiceRoleKey('placeholder-service-role-key')).toBe(
      false,
    );
  });

  it('returns true for a real-looking key (type guard narrows to string)', async () => {
    const { isConfiguredServiceRoleKey } = await import('./admin');
    const key: string | undefined = 'a-real-looking-service-role-key';
    expect(isConfiguredServiceRoleKey(key)).toBe(true);
    if (isConfiguredServiceRoleKey(key)) {
      // Narrowed to `string` — this line only type-checks if the guard works.
      const narrowed: string = key;
      expect(narrowed).toBe(key);
    }
  });
});
