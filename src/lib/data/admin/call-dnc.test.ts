import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: vi.fn() }));
vi.mock('@/lib/dnc/registry-check', () => ({ checkRegistry: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/security/rate-limit';
import { checkRegistry } from '@/lib/dnc/registry-check';
import { addToCallDnc, checkNumberAsStaff, listCallDnc } from '@/lib/data/admin/call-dnc';

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

describe('listCallDnc', () => {
  it('searches by digits, whatever form the number was typed in', async () => {
    const { builder } = mock();
    await listCallDnc({ page: 2, query: '050-123' });
    expect(builder.ilike).toHaveBeenCalledWith('normalized_phone', '%50123%');
    expect(builder.range).toHaveBeenCalledWith(50, 99);
  });
});

describe('checkNumberAsStaff', () => {
  const insert = vi.fn().mockResolvedValue({ error: null });

  beforeEach(() => {
    vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ insert }) } as unknown as ReturnType<
      typeof createAdminClient
    >);
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true } as Awaited<ReturnType<typeof rateLimit>>);
    vi.mocked(checkRegistry).mockResolvedValue({
      result: 'registry_clear',
      source: 'national_registry',
      checkedAt: '2026-10-11T10:00:00.000Z',
      transactionId: '871d18ef-7cfe-4cf9-8ce4-9def09668d96',
      errorCode: null,
      failure: null,
    });
  });

  it('checks the normalized number and records the check as a staff lookup', async () => {
    const r = await checkNumberAsStaff('050-1234567');
    expect(r).toMatchObject({ ok: true, check: { result: 'registry_clear' } });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
    expect(checkRegistry).toHaveBeenCalledWith('+972501234567');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ phone_e164: '+972501234567', purpose: 'admin_check', dial_path: 'admin_dnc_screen' }),
    );
  });

  it('is rate-limited per staff member, before any registry request', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false } as Awaited<ReturnType<typeof rateLimit>>);
    const r = await checkNumberAsStaff('0501234567');
    expect(r.ok).toBe(false);
    expect(rateLimit).toHaveBeenCalledWith('dnc-staff-check:admin-1', expect.anything());
    expect(checkRegistry).not.toHaveBeenCalled();
  });

  it('an unparseable number is refused without a registry request', async () => {
    expect(await checkNumberAsStaff('nope')).toEqual({ ok: false, error: 'מספר טלפון לא תקין' });
    expect(checkRegistry).not.toHaveBeenCalled();
  });
});
