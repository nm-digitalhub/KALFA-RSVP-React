import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { addToCallDnc } from '@/lib/data/admin/call-dnc';

function mock(error: { message: string } | null = null) {
  const { client, builder } = createMockSupabase<never>({ data: null, error });
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { client, builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  // requirePlatformPermission returns the authenticated admin; addToCallDnc records its id as added_by.
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as Awaited<
    ReturnType<typeof requirePlatformPermission>
  >);
});

describe('addToCallDnc', () => {
  it('rejects an unparseable phone without touching the DB', async () => {
    const { client } = mock();
    const result = await addToCallDnc({ phone: 'not-a-phone' });
    expect(result).toEqual({ ok: false, error: 'מספר טלפון לא תקין' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('upserts the normalized E.164 phone keyed on normalized_phone', async () => {
    const { client, builder } = mock();
    // Israeli local form → normalizePhone canonicalizes to E.164 (+972…).
    const result = await addToCallDnc({ phone: '050-123-4567', reason: 'בקשת הסרה' });
    expect(result).toEqual({ ok: true });
    expect(client.from).toHaveBeenCalledWith('call_dnc_list');
    expect(builder.upsert).toHaveBeenCalledWith(
      { normalized_phone: '+972501234567', reason: 'בקשת הסרה', added_by: 'admin-1' },
      { onConflict: 'normalized_phone' },
    );
  });

  it('maps an empty reason to null', async () => {
    const { builder } = mock();
    await addToCallDnc({ phone: '+972501234567', reason: '   ' });
    const payload = vi.mocked(builder.upsert).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.normalized_phone).toBe('+972501234567');
    expect(payload.reason).toBeNull();
  });

  it('returns a friendly error when the upsert fails', async () => {
    mock({ message: 'insert failed' });
    const result = await addToCallDnc({ phone: '+972501234567' });
    expect(result).toEqual({ ok: false, error: 'הוספה לרשימת ה-DNC נכשלה' });
  });
});
