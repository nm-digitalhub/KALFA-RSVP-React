import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: vi.fn() }));
vi.mock('@/lib/phone', () => ({ normalizePhone: vi.fn(() => PHONE) }));

import { createMockSupabase } from '@/test/supabase-mock';
import { normalizePhone } from '@/lib/phone';
import { getSmsSender } from '@/lib/sms/sender';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestOtp, verifyOtp } from './otp';

beforeEach(() => vi.clearAllMocks());

const PHONE = '+972501234567';
const PURPOSE = 'agreement_signing';

function hashCode(code: string, phone: string): string {
  return createHash('sha256').update(`${code}:${phone}`).digest('hex');
}

function wireChallenge(overrides: Partial<{
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
}> = {}) {
  const { client, builder } = createMockSupabase({
    data: {
      id: 'ch1',
      code_hash: hashCode('123456', PHONE),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      attempts: 0,
      consumed_at: null,
      ...overrides,
    },
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return builder;
}

describe('verifyOtp — default (consuming) behavior, unchanged', () => {
  it('marks the challenge consumed on a correct code', async () => {
    const builder = wireChallenge();

    const ok = await verifyOtp(PHONE, PURPOSE, '123456');

    expect(ok).toBe(true);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ consumed_at: expect.any(String) }),
    );
  });

  it('increments attempts and does not consume on a wrong code', async () => {
    const builder = wireChallenge({ attempts: 2 });

    const ok = await verifyOtp(PHONE, PURPOSE, '000000');

    expect(ok).toBe(false);
    expect(builder.update).toHaveBeenCalledWith({ attempts: 3 });
    expect(builder.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ consumed_at: expect.anything() }),
    );
  });
});

describe('verifyOtp — { consume: false } peek check', () => {
  it('returns true on a correct code without consuming the challenge', async () => {
    const builder = wireChallenge();

    const ok = await verifyOtp(PHONE, PURPOSE, '123456', { consume: false });

    expect(ok).toBe(true);
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('still increments attempts on a wrong code (same budget as a real check)', async () => {
    const builder = wireChallenge({ attempts: 4 });

    const ok = await verifyOtp(PHONE, PURPOSE, '000000', { consume: false });

    expect(ok).toBe(false);
    expect(builder.update).toHaveBeenCalledWith({ attempts: 5 });
  });

  it('still respects the max-attempts cutoff', async () => {
    wireChallenge({ attempts: 5 });

    const ok = await verifyOtp(PHONE, PURPOSE, '123456', { consume: false });

    expect(ok).toBe(false);
  });

  it('still respects TTL expiry', async () => {
    wireChallenge({ expires_at: new Date(Date.now() - 1000).toISOString() });

    const ok = await verifyOtp(PHONE, PURPOSE, '123456', { consume: false });

    expect(ok).toBe(false);
  });
});

describe('requestOtp', () => {
  const smsText = (code: string) => `קוד: ${code}`;
  const send = vi.fn();

  // One awaited chain per entry: the count of recent codes, then the insert.
  function wireQueries(...results: Parameters<typeof createMockSupabase>[0][]) {
    const { client } = createMockSupabase({ data: null, error: null });
    const builders = results.map((result) => createMockSupabase(result).builder);
    for (const builder of builders) client.from.mockReturnValueOnce(builder);
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return builders;
  }

  const countOf = (count: number) => ({ data: null, error: null, count });

  beforeEach(() => {
    send.mockReset().mockResolvedValue({ id: 'sms1' });
    vi.mocked(getSmsSender).mockResolvedValue({ send });
    vi.mocked(normalizePhone).mockReturnValue(PHONE);
  });

  it('sends the caller\'s wording around a six-digit code and stores only its hash', async () => {
    const [, insert] = wireQueries(countOf(0), { data: null, error: null });

    const result = await requestOtp(PHONE, PURPOSE, smsText);

    expect(result).toEqual({ ok: true });
    const { to, text } = send.mock.calls[0]?.[0] as { to: string; text: string };
    expect(to).toBe(PHONE);
    expect(text).toMatch(/^קוד: \d{6}$/);
    const code = text.replace('קוד: ', '');
    const row = insert?.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.code_hash).toBe(hashCode(code, PHONE));
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it('refuses a number it cannot normalize, before any query or send', async () => {
    vi.mocked(normalizePhone).mockReturnValue(null);

    expect(await requestOtp('abc', PURPOSE, smsText)).toEqual({ ok: false, reason: 'invalid_phone' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a failed count as otp_create_failed and sends nothing', async () => {
    wireQueries({ data: null, error: { message: 'db down' } });

    expect(await requestOtp(PHONE, PURPOSE, smsText)).toEqual({ ok: false, reason: 'otp_create_failed' });
    expect(send).not.toHaveBeenCalled();
  });

  it('stops at five codes per phone and purpose', async () => {
    wireQueries(countOf(5));

    expect(await requestOtp(PHONE, PURPOSE, smsText)).toEqual({ ok: false, reason: 'too_many_codes' });
    expect(send).not.toHaveBeenCalled();
  });

  it('still sends the fifth code', async () => {
    wireQueries(countOf(4), { data: null, error: null });

    expect(await requestOtp(PHONE, PURPOSE, smsText)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports a failed insert as otp_create_failed and sends nothing', async () => {
    wireQueries(countOf(0), { data: null, error: { message: 'insert failed' } });

    expect(await requestOtp(PHONE, PURPOSE, smsText)).toEqual({ ok: false, reason: 'otp_create_failed' });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a provider failure as send_failed and logs neither the code nor the phone', async () => {
    wireQueries(countOf(0), { data: null, error: null });
    send.mockRejectedValue(new Error('gateway down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await requestOtp(PHONE, PURPOSE, smsText)).toEqual({ ok: false, reason: 'send_failed' });

    const { text } = send.mock.calls[0]?.[0] as { text: string };
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('gateway down');
    expect(logged).not.toContain(text.replace('קוד: ', ''));
    expect(logged).not.toContain(PHONE);
    log.mockRestore();
  });
});
