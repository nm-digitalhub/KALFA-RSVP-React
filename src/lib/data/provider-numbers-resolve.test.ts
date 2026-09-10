import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';

import { resolveNumberForRole } from './provider-numbers-resolve';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockRow(result: { data: any; error: any }) {
  const { client, builder } = createMockSupabase(result);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, builder };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveNumberForRole', () => {
  it('returns the number wired to the role', async () => {
    mockRow({
      data: {
        provider_numbers: {
          e164: '+97237219347',
          provider_ref: 'VOX-1',
          is_active: true,
        },
      },
      error: null,
    });
    await expect(resolveNumberForRole('voice_caller_id_rsvp')).resolves.toEqual({
      e164: '+97237219347',
      providerRef: 'VOX-1',
    });
  });

  it('queries by role with maybeSingle — the PK guarantees at most one row', async () => {
    const { client, builder } = mockRow({ data: null, error: null });
    await resolveNumberForRole('sms_sender');
    expect(client.from).toHaveBeenCalledWith('provider_number_roles');
    expect(builder.eq).toHaveBeenCalledWith('role', 'sms_sender');
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it('returns null when nothing is assigned', async () => {
    mockRow({ data: null, error: null });
    await expect(resolveNumberForRole('whatsapp_import_sender')).resolves.toBeNull();
  });

  it('returns null for a DEACTIVATED number rather than handing it to a send path', async () => {
    // The role row stays — the assignment is still the admin's stated intent, and
    // clearing it on deactivation would silently lose the wiring. Runtime must not
    // USE it, so the answer here matches "unassigned" and the caller falls back.
    mockRow({
      data: {
        provider_numbers: {
          e164: '+97237219347',
          provider_ref: 'VOX-1',
          is_active: false,
        },
      },
      error: null,
    });
    await expect(resolveNumberForRole('voice_inbound_did')).resolves.toBeNull();
  });

  it('fails SAFE on a query error instead of throwing into a send', async () => {
    // A lookup with a perfectly good default must not take down a campaign send.
    mockRow({ data: null, error: { message: 'connection reset' } });
    await expect(resolveNumberForRole('whatsapp_rsvp_sender')).resolves.toBeNull();
  });

  it('fails SAFE when the client itself throws', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('no service role key');
    });
    await expect(resolveNumberForRole('company_contact')).resolves.toBeNull();
  });

  it('never imports next/headers — it is bundled into the worker', async () => {
    // `worker:deps` enforces this repo-wide via dependency-cruiser; asserted here too
    // so the reason travels with the module rather than living only in a config file.
    //
    // IMPORT LINES ONLY, not the whole file: the module's own header explains why
    // next/headers is forbidden, and a substring search reported that sentence as a
    // violation. A test that fails on its own documentation teaches people to delete
    // the documentation.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('./provider-numbers-resolve.ts', import.meta.url).pathname,
        'utf8',
      ),
    );
    const imports = [...source.matchAll(/^\s*import[^;]*from\s*'([^']+)'/gm)].map(
      (m) => m[1],
    );
    expect(imports).not.toContain('next/headers');
    expect(imports).not.toContain('@/lib/supabase/server');
    expect(imports).toContain('@/lib/supabase/admin');
  });
});
