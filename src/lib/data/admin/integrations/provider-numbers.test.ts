import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';

import { assignRole, clearRole, listProviderNumbers } from './provider-numbers';

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
