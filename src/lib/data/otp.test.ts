import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: vi.fn() }));
vi.mock('@/lib/phone', () => ({ normalizePhone: vi.fn(() => PHONE) }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyOtp } from './otp';

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
