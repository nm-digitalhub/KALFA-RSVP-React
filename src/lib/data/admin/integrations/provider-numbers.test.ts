import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';

import {
  assignRole,
  clearRole,
  listProviderNumbers,
  upsertProviderNumber,
} from './provider-numbers';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

function staff(): User {
  return { id: 'staff-1' } as unknown as User;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockRows(result: { data: any; error: any }) {
  const { client, builder } = createMockSupabase(result);
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { client, builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(staff());
});

describe('listProviderNumbers', () => {
  const VOX_ROW = {
    id: 'n1',
    provider: 'voximplant',
    provider_ref: null,
    e164: '+97237219347',
    display_label: 'מספר יוצא (Caller ID)',
    is_active: true,
    snapshot: null,
    snapshot_at: null,
    source: 'backfill',
    provider_number_roles: [
      { role: 'voice_inbound_did' },
      { role: 'voice_caller_id_rsvp' },
    ],
  };

  it('gates on manage_settings', async () => {
    mockRows({ data: [VOX_ROW], error: null });
    await listProviderNumbers();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('joins roles onto numbers, sorted so chips do not reorder between renders', async () => {
    mockRows({ data: [VOX_ROW], error: null });
    const rows = await listProviderNumbers();
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toEqual(['voice_caller_id_rsvp', 'voice_inbound_did']);
    expect(rows[0].e164).toBe('+97237219347');
    expect(rows[0].providerRef).toBeNull();
  });

  it('reads roles through the embedded relationship, not a second query', async () => {
    // A number and its roles observed a moment apart can disagree; one query cannot.
    const { client, builder } = mockRows({ data: [VOX_ROW], error: null });
    await listProviderNumbers();
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('provider_numbers');
    expect(builder.select.mock.calls[0][0]).toContain('provider_number_roles(role)');
  });

  it('a number with no roles comes back with an empty array, not undefined', async () => {
    // The panel prints "ללא תפקיד" from this; undefined would throw on .length.
    mockRows({
      data: [{ ...VOX_ROW, provider_number_roles: [] }],
      error: null,
    });
    const rows = await listProviderNumbers();
    expect(rows[0].roles).toEqual([]);
  });

  it('throws rather than returning an empty list when the query fails', async () => {
    // An empty list reads as "no numbers are connected" — a confident, wrong answer.
    mockRows({ data: null, error: { message: 'boom' } });
    await expect(listProviderNumbers()).rejects.toThrow('טעינת רשימת המספרים נכשלה');
  });
});

describe('assignRole', () => {
  it('takes manage_voice for a voice role and manage_settings for the rest', async () => {
    mockRows({ data: null, error: null });
    await assignRole('voice_caller_id_rsvp', '11111111-1111-4111-8111-111111111111');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');

    vi.clearAllMocks();
    vi.mocked(requirePlatformPermission).mockResolvedValue(staff());
    mockRows({ data: null, error: null });
    await assignRole('whatsapp_rsvp_sender', '11111111-1111-4111-8111-111111111111');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('upserts on `role`, so a reassignment cannot leave two numbers holding it', async () => {
    const { client, builder } = mockRows({ data: null, error: null });
    await assignRole('sms_sender', '11111111-1111-4111-8111-111111111111');
    expect(client.from).toHaveBeenCalledWith('provider_number_roles');
    expect(builder.upsert.mock.calls[0][1]).toEqual({ onConflict: 'role' });
  });

  it('rejects a non-uuid number id before touching the database', async () => {
    const { client } = mockRows({ data: null, error: null });
    await expect(assignRole('sms_sender', 'not-a-uuid')).rejects.toThrow();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('names the fixable failure when the number does not exist', async () => {
    // 23503 is the FK. "שמירה נכשלה" would send an admin to check permissions.
    mockRows({ data: null, error: { message: 'fk', code: '23503' } });
    await expect(
      assignRole('sms_sender', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow('המספר שנבחר אינו קיים');
  });

  it('gates BEFORE writing, not after', async () => {
    const { client } = mockRows({ data: null, error: null });
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(new Error('redirect'));
    await expect(
      assignRole('voice_inbound_did', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow('redirect');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('clearRole', () => {
  it('deletes exactly the one role row and gates on that role permission', async () => {
    const { client, builder } = mockRows({ data: null, error: null });
    await clearRole('voice_caller_id_sales');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
    expect(client.from).toHaveBeenCalledWith('provider_number_roles');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('role', 'voice_caller_id_sales');
  });

  it('refuses a role that is not in the database vocabulary', async () => {
    const { client } = mockRows({ data: null, error: null });
    await expect(
      clearRole('not_a_role' as Parameters<typeof clearRole>[0]),
    ).rejects.toThrow();
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('upsertProviderNumber', () => {
  function mockRpc(result: { data: unknown; error: unknown }) {
    const { client } = createMockSupabase({ data: null, error: null });
    client.rpc.mockResolvedValue(result);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    return client;
  }

  it('gates by PROVIDER: voximplant takes manage_voice, the rest manage_settings', async () => {
    mockRpc({ data: 'id-1', error: null });
    await upsertProviderNumber({ provider: 'voximplant', e164: '+97237219347' });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');

    vi.clearAllMocks();
    vi.mocked(requirePlatformPermission).mockResolvedValue(staff());
    mockRpc({ data: 'id-2', error: null });
    await upsertProviderNumber({ provider: 'meta_whatsapp', providerRef: '101' });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('goes through the RPC, not .upsert() — the partial index makes ON CONFLICT 42P10', async () => {
    const client = mockRpc({ data: 'id-1', error: null });
    await upsertProviderNumber({ provider: 'company', e164: '+97233301505' });
    expect(client.rpc).toHaveBeenCalledWith('upsert_provider_number', expect.anything());
    expect(client.from).not.toHaveBeenCalled();
  });

  it('OMITS absent fields rather than sending null, so a sync cannot blank a label', async () => {
    // The function coalesces a missing argument to what is stored. An explicit null
    // would mean the opposite of what a label-less sync intends.
    const client = mockRpc({ data: 'id-1', error: null });
    await upsertProviderNumber({
      provider: 'voximplant',
      providerRef: 'VOX-1',
      e164: '+97237219347',
      source: 'sync',
    });
    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('p_display_label');
    expect(args).not.toHaveProperty('p_snapshot');
    expect(args.p_provider_ref).toBe('VOX-1');
    expect(args.p_source).toBe('sync');
    // is_active is not nullable, so it is always the caller's word.
    expect(args.p_is_active).toBe(true);
  });

  it('rejects a non-E.164 value before the round trip', async () => {
    const client = mockRpc({ data: null, error: null });
    await expect(
      upsertProviderNumber({ provider: 'voximplant', e164: '03-7219347' }),
    ).rejects.toThrow('E.164');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects a row identified by neither a ref nor a number', async () => {
    const client = mockRpc({ data: null, error: null });
    await expect(upsertProviderNumber({ provider: 'company' })).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects a snapshot that could not survive the jsonb round trip', async () => {
    // Validated AS Json at the boundary rather than cast at the call site.
    const client = mockRpc({ data: null, error: null });
    await expect(
      upsertProviderNumber({
        provider: 'voximplant',
        e164: '+97237219347',
        snapshot: { seen: new Date() } as never,
      }),
    ).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('maps the two caller-fixable SQLSTATEs to messages a field can carry', async () => {
    mockRpc({ data: null, error: { message: 'chk', code: '23514' } });
    await expect(
      upsertProviderNumber({ provider: 'company', e164: '+97233301505' }),
    ).rejects.toThrow('E.164');

    mockRpc({ data: null, error: { message: 'needs id', code: '22023' } });
    await expect(
      upsertProviderNumber({ provider: 'company', e164: '+97233301505' }),
    ).rejects.toThrow('צריך לפחות מזהה');

    mockRpc({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(
      upsertProviderNumber({ provider: 'company', e164: '+97233301505' }),
    ).rejects.toThrow('שמירת המספר נכשלה');
  });

  it('returns the id the function hands back', async () => {
    mockRpc({ data: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', error: null });
    await expect(
      upsertProviderNumber({ provider: 'extra_sms', e164: '+97233301505' }),
    ).resolves.toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
