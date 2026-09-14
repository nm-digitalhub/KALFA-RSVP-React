import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminMock, mintMock, senderMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  mintMock: vi.fn(),
  senderMock: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/data/callback-intake', () => ({ mintCallbackIntakeToken: mintMock }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: senderMock }));
vi.mock('@/lib/url', () => ({ getAppOrigin: async () => 'https://beta.kalfa.me' }));

import { armCallbackIntake } from './intake-dispatch';

// ⚠️ WHY THIS FILE EXISTS. Every missed call now reaches a paid SMS gateway, so
// the gates below are the difference between a feature and a bill. Each test
// here corresponds to one way the spend could run away, and none of them is
// covered by any other test in the suite.

type Row = Record<string, unknown>;

/** A Supabase double that answers per table and records what was written. */
function mockDb(opts: {
  settings?: Row | null;
  settingsError?: boolean;
  sentToday?: number;
  claimed?: Row | null;
}) {
  const writes: Row[] = [];

  const settingsBuilder = {
    select: () => settingsBuilder,
    eq: () => settingsBuilder,
    maybeSingle: async () => ({
      data: opts.settingsError ? null : (opts.settings ?? null),
      error: opts.settingsError ? { message: 'boom' } : null,
    }),
  };

  const countBuilder = {
    select: () => countBuilder,
    gte: async () => ({ count: opts.sentToday ?? 0, error: null }),
  };

  function requestsBuilder() {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.gte = countBuilder.gte;
    b.update = (patch: Row) => {
      writes.push(patch);
      return b;
    };
    b.eq = () => b;
    b.is = () => b;
    b.maybeSingle = async () => ({ data: opts.claimed ?? null, error: null });
    return b;
  }

  adminMock.mockReturnValue({
    from: (table: string) => {
      if (table === 'app_settings') return settingsBuilder;
      // The cap probe and the claim both hit callback_requests; the probe uses
      // .select().gte(), the claim .update().eq().is().select().maybeSingle().
      return requestsBuilder();
    },
  });
  return writes;
}

const ARMED = { callback_intake_sms_enabled: true, callback_intake_sms_daily_cap: 50 };
const INPUT = { requestId: 'req-1', phone: '+972500000000' };

beforeEach(() => {
  vi.clearAllMocks();
  mintMock.mockResolvedValue('0123456789abcdef0123456789abcdef');
  senderMock.mockResolvedValue({ send: vi.fn(async () => ({ id: 'prov-1' })) });
});

describe('armCallbackIntake', () => {
  it('⚠️ sends NOTHING when the switch is off', async () => {
    mockDb({ settings: { callback_intake_sms_enabled: false, callback_intake_sms_daily_cap: 50 } });
    await armCallbackIntake(INPUT);
    expect(senderMock).not.toHaveBeenCalled();
  });

  it('⚠️ sends nothing when the settings row cannot be read', async () => {
    // Fail CLOSED: an unreadable switch is not an ON switch.
    mockDb({ settingsError: true });
    await armCallbackIntake(INPUT);
    expect(senderMock).not.toHaveBeenCalled();
  });

  it('⚠️ sends nothing once the daily cap is reached', async () => {
    mockDb({ settings: ARMED, sentToday: 50 });
    await armCallbackIntake(INPUT);
    expect(senderMock).not.toHaveBeenCalled();
  });

  it('⚠️ treats a cap of 0 as off', async () => {
    mockDb({ settings: { callback_intake_sms_enabled: true, callback_intake_sms_daily_cap: 0 } });
    await armCallbackIntake(INPUT);
    expect(senderMock).not.toHaveBeenCalled();
  });

  it('⚠️ sends nothing when another worker already claimed the row', async () => {
    // Claim-then-send is what stops one missed call becoming two texts.
    mockDb({ settings: ARMED, sentToday: 0, claimed: null });
    await armCallbackIntake(INPUT);
    expect(senderMock).not.toHaveBeenCalled();
  });

  it('sends once, and records the provider id, when armed and under the cap', async () => {
    const writes = mockDb({ settings: ARMED, sentToday: 3, claimed: { id: 'req-1' } });
    await armCallbackIntake(INPUT);
    expect(senderMock).toHaveBeenCalledTimes(1);
    expect(writes.some((w) => w.intake_sms_provider_id === 'prov-1')).toBe(true);
  });

  it('⚠️ never sends when no token could be minted', async () => {
    // A row that already has a token has already been offered a link; re-sending
    // would point the person at a second form for the same request.
    mintMock.mockResolvedValue(null);
    mockDb({ settings: ARMED });
    await armCallbackIntake(INPUT);
    expect(senderMock).not.toHaveBeenCalled();
  });

  it('⚠️ records a send failure instead of throwing at the caller', async () => {
    // The caller is a missed-call handler whose real work already succeeded.
    const writes = mockDb({ settings: ARMED, sentToday: 0, claimed: { id: 'req-1' } });
    senderMock.mockResolvedValue({
      send: vi.fn(async () => {
        throw new Error('provider down');
      }),
    });
    await expect(armCallbackIntake(INPUT)).resolves.toBeUndefined();
    expect(writes.some((w) => w.intake_sms_error === 'provider down')).toBe(true);
  });
});
