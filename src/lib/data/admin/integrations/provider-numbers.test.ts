import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';

import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getPhoneNumbers } from '@/lib/voximplant/core';
import { listWabaPhoneNumbers } from '@/lib/whatsapp/phone-numbers';

import {
  assignRole,
  clearRole,
  listProviderNumbers,
  syncMetaNumbers,
  syncVoximplantNumbers,
  upsertProviderNumber,
} from './provider-numbers';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/voximplant/core', () => ({ getPhoneNumbers: vi.fn() }));
vi.mock('@/lib/whatsapp/phone-numbers', () => ({ listWabaPhoneNumbers: vi.fn() }));

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

describe('syncMetaNumbers', () => {
  function rpcClient() {
    const { client } = createMockSupabase({ data: null, error: null });
    client.rpc.mockResolvedValue({ data: 'id-1', error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    return client;
  }

  beforeEach(() => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue({
      phoneNumberId: '1018741517998430',
      wabaId: '990921550130385',
      accessToken: 'EAA-TOKEN',
      appSecret: null,
      verifyToken: null,
    });
  });

  it('refuses before calling Meta when the WABA id or token is missing', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(null);
    await expect(syncMetaNumbers()).rejects.toThrow('חסרים פרטי חיבור ל-Meta');
    expect(listWabaPhoneNumbers).not.toHaveBeenCalled();
  });

  it('normalises Meta\'s spaced display number into E.164', async () => {
    // Meta returns "+972 33 301505". Unnormalised it fails provider_numbers_e164_chk
    // AND stops the RPC recognising the backfill row for the same line.
    const client = rpcClient();
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: [
        {
          id: '1018741517998430',
          display_phone_number: '+972 33 301505',
          verified_name: 'KALFA',
          code_verification_status: 'EXPIRED',
        },
      ],
      degraded: false,
      complete: true,
    });

    const result = await syncMetaNumbers();

    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_e164).toBe('+97233301505');
    expect(args.p_provider_ref).toBe('1018741517998430');
    expect(args.p_source).toBe('sync');
    expect(result).toEqual({ count: 1, deactivated: 0, degraded: false });
  });

  it('carries code_verification_status into the snapshot', async () => {
    // The field Meta's own WhatsApp Manager table does not show. Measured live
    // 2026-09-10: the configured sender is EXPIRED, the import number VERIFIED.
    const client = rpcClient();
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: [
        {
          id: 'x',
          display_phone_number: '+972 50 0000000',
          code_verification_status: 'EXPIRED',
        },
      ],
      degraded: false,
      complete: true,
    });
    await syncMetaNumbers();
    const args = client.rpc.mock.calls[0][1] as { p_snapshot: Record<string, unknown> };
    expect(args.p_snapshot.code_verification_status).toBe('EXPIRED');
  });

  it('writes a number that holds NO role rather than skipping it', async () => {
    // The second number on this WABA predates the table. Invisible is worse than
    // "ללא תפקיד" — an admin cannot assign a role to a row that was never written.
    const client = rpcClient();
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: [
        { id: '1018741517998430', display_phone_number: '+972 33 301505' },
        { id: '1298694319994421', display_phone_number: '+972 37 219347' },
      ],
      degraded: false,
      complete: true,
    });
    const result = await syncMetaNumbers();
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(result.count).toBe(2);
  });

  // ── deactivating what Meta no longer lists ────────────────────────────────
  // The bug this closes, MEASURED on the live table: a number deleted at Meta was
  // never visited by the upsert loop, so its row kept is_active = true and the
  // panel went on showing it. Absence is the only signal Meta gives — which is
  // also why it must not be acted on from a read that cannot bear it.

  /** A client whose UPDATE ... .select('id') reports `rows` as changed. */
  function deactivationClient(rows: Array<{ id: string }>) {
    const calls: Array<[string, string, unknown]> = [];
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: 'id-1', error: null }),
      from: vi.fn(() => {
        const chain = {
          update: (v: unknown) => {
            calls.push(['update', 'values', v]);
            return chain;
          },
          eq: (c: string, v: unknown) => {
            calls.push(['eq', c, v]);
            return chain;
          },
          not: (c: string, op: string, v: unknown) => {
            calls.push(['not', `${c}.${op}`, v]);
            return chain;
          },
          select: async () => ({ data: rows, error: null }),
        };
        return chain;
      }),
    };
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    return calls;
  }

  const ONE_NUMBER = [{ id: 'kept-1', display_phone_number: '+972 33 301505' }];

  it('switches off a row whose number Meta no longer returns', async () => {
    const calls = deactivationClient([{ id: 'row-gone' }]);
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: ONE_NUMBER,
      degraded: false,
      complete: true,
    });

    const result = await syncMetaNumbers();

    expect(result.deactivated).toBe(1);
    expect(calls).toContainEqual(['update', 'values', { is_active: false }]);
    // Scoped to Meta rows this sync owns, and only ones currently on.
    expect(calls).toContainEqual(['eq', 'provider', 'meta_whatsapp']);
    expect(calls).toContainEqual(['eq', 'source', 'sync']);
    expect(calls).toContainEqual(['eq', 'is_active', true]);
    // And it EXCLUDES what did come back, rather than switching everything off.
    expect(calls).toContainEqual(['not', 'provider_ref.in', '("kept-1")']);
  });

  it('never touches BACKFILL rows — the RSVP sender is one', async () => {
    // No Meta response should be able to switch off the number the product sends
    // from. The filter is asserted by name because losing it is silent.
    const calls = deactivationClient([]);
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: ONE_NUMBER,
      degraded: false,
      complete: true,
    });
    await syncMetaNumbers();
    expect(calls).toContainEqual(['eq', 'source', 'sync']);
  });

  it('does NOTHING when the read was paginated short', async () => {
    // Without `complete`, number 51 of 51 is indistinguishable from a deleted one.
    const calls = deactivationClient([{ id: 'row-gone' }]);
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: ONE_NUMBER,
      degraded: false,
      complete: false,
    });
    const result = await syncMetaNumbers();
    expect(result.deactivated).toBe(0);
    expect(calls.some(([kind]) => kind === 'update')).toBe(false);
  });

  it('does NOTHING on a degraded read — a partial answer is not a census', async () => {
    const calls = deactivationClient([{ id: 'row-gone' }]);
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: ONE_NUMBER,
      degraded: true,
      complete: true,
    });
    const result = await syncMetaNumbers();
    expect(result.deactivated).toBe(0);
    expect(calls.some(([kind]) => kind === 'update')).toBe(false);
  });

  it('does NOTHING when Meta returns zero numbers', async () => {
    // Zero is a credentials or permissions anomaly far more often than "the WABA
    // was emptied" — and acting on it turns EVERY number off at once.
    const calls = deactivationClient([{ id: 'row-gone' }]);
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: [],
      degraded: false,
      complete: true,
    });
    const result = await syncMetaNumbers();
    expect(result.deactivated).toBe(0);
    expect(calls.some(([kind]) => kind === 'update')).toBe(false);
  });

  it('reports a degraded read instead of swallowing it', async () => {
    rpcClient();
    vi.mocked(listWabaPhoneNumbers).mockResolvedValue({
      numbers: [{ id: 'x', display_phone_number: '+972 50 0000000' }],
      degraded: true,
      complete: true,
    });
    await expect(syncMetaNumbers()).resolves.toEqual({ count: 1, deactivated: 0, degraded: true });
  });
});

describe('syncVoximplantNumbers', () => {
  function rpcClient() {
    const { client } = createMockSupabase({ data: null, error: null });
    client.rpc.mockResolvedValue({ data: 'id-1', error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    return client;
  }

  beforeEach(() => {
    vi.mocked(getVoximplantConfig).mockResolvedValue({
      auth: { accountId: 1, keyId: 'k', privateKey: 'p' },
      ruleId: '1',
      callerId: '+97237219347',
    } as unknown as Awaited<ReturnType<typeof getVoximplantConfig>>);
  });

  it('gates on manage_voice', async () => {
    rpcClient();
    vi.mocked(getPhoneNumbers).mockResolvedValue({ result: [], total_count: 0 });
    await syncVoximplantNumbers();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
  });

  it('sends the phone_id as provider_ref, which is what lets the RPC adopt the backfill row', async () => {
    const client = rpcClient();
    vi.mocked(getPhoneNumbers).mockResolvedValue({
      result: [
        {
          phone_id: 4242,
          phone_number: '97237219347',
          phone_name: null,
          deactivated: false,
          rule_name: 'OutCallAgent',
        },
      ],
      total_count: 1,
    } as unknown as Awaited<ReturnType<typeof getPhoneNumbers>>);

    await syncVoximplantNumbers();

    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_provider_ref).toBe('4242');
    expect(args.p_e164).toBe('+97237219347');
    expect(args.p_is_active).toBe(true);
  });

  it('a number Voximplant deactivated becomes inactive without anyone editing the panel', async () => {
    const client = rpcClient();
    vi.mocked(getPhoneNumbers).mockResolvedValue({
      result: [{ phone_id: 1, phone_number: '97237219347', deactivated: true }],
      total_count: 1,
    } as unknown as Awaited<ReturnType<typeof getPhoneNumbers>>);
    await syncVoximplantNumbers();
    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_is_active).toBe(false);
  });

  it('refuses before calling Voximplant when nothing is configured', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(null);
    await expect(syncVoximplantNumbers()).rejects.toThrow('חסרים פרטי חיבור ל-Voximplant');
    expect(getPhoneNumbers).not.toHaveBeenCalled();
  });
});
