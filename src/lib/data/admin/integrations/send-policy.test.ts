import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, clientMock, logMock, updateMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  clientMock: vi.fn(),
  logMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/supabase/server', () => ({ createClient: clientMock }));
vi.mock('@/lib/data/activity', () => ({ logActivity: logMock }));

import { DEFAULT_SEND_POLICY, type SendPolicy } from '@/lib/outreach/send-policy';
import { getSendPolicyForAdmin, updateSendPolicy } from './send-policy';

/** app_settings singleton double. `update` records what was written. */
function mockSettings(row: Record<string, unknown> | null, error: unknown = null) {
  clientMock.mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error }) }),
      }),
      update: (values: Record<string, unknown>) => {
        updateMock(values);
        return { eq: async () => ({ error: null }) };
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'u1' });
  mockSettings({ whatsapp_send_policy: DEFAULT_SEND_POLICY });
});

describe('getSendPolicyForAdmin', () => {
  it('requires manage_settings', async () => {
    await getSendPolicyForAdmin();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('a stored, valid policy is returned as stored', async () => {
    await expect(getSendPolicyForAdmin()).resolves.toEqual({
      policy: DEFAULT_SEND_POLICY,
      source: 'stored',
      invalidReason: null,
    });
  });

  it('no stored value reports the DEFAULT as default, not as stored', async () => {
    // The distinction matters on screen: "nothing is saved, this is what runs"
    // is a different sentence from "this is what you saved".
    mockSettings({ whatsapp_send_policy: null });
    const r = await getSendPolicyForAdmin();
    expect(r.source).toBe('default');
    expect(r.policy).toEqual(DEFAULT_SEND_POLICY);
  });

  it('a stored value the SENDER rejects is reported as invalid, with the reason', async () => {
    // This is the state that had no way to be seen. getSendPolicy() swallows the
    // failure and schedules against the default, so the panel would otherwise
    // print a policy nothing was obeying.
    mockSettings({
      whatsapp_send_policy: { ...DEFAULT_SEND_POLICY, hardCap: '23:00' },
    });
    const r = await getSendPolicyForAdmin();
    expect(r.source).toBe('invalid');
    expect(r.invalidReason).toContain('21:00');
    // And it shows what the sender is ACTUALLY using, not the rejected value.
    expect(r.policy).toEqual(DEFAULT_SEND_POLICY);
  });

  it('garbage in the column is invalid, not a crash', async () => {
    mockSettings({ whatsapp_send_policy: 'not an object' });
    const r = await getSendPolicyForAdmin();
    expect(r.source).toBe('invalid');
    expect(r.policy).toEqual(DEFAULT_SEND_POLICY);
  });

  it('a READ failure throws rather than reporting a default that is not in use', async () => {
    mockSettings(null, { message: 'boom' });
    await expect(getSendPolicyForAdmin()).rejects.toThrow(/מדיניות השליחה/);
  });
});

describe('updateSendPolicy', () => {
  const NARROWED: SendPolicy = {
    ...DEFAULT_SEND_POLICY,
    weekday: [
      { start: '10:00', end: '18:00' },
      ...DEFAULT_SEND_POLICY.weekday.slice(1),
    ] as SendPolicy['weekday'],
  };

  it('requires manage_settings and writes the column', async () => {
    await updateSendPolicy(NARROWED);
    expect(permMock).toHaveBeenCalledWith('manage_settings');
    expect(updateMock).toHaveBeenCalledWith({ whatsapp_send_policy: NARROWED });
  });

  it('re-validates at the DAL — a policy past the ceiling never reaches the table', async () => {
    // The Server Action validates too. This asserts the DAL does not DEPEND on
    // that: any future caller hits the same refusal.
    await expect(
      updateSendPolicy({ ...DEFAULT_SEND_POLICY, hardCap: '22:00' }),
    ).rejects.toThrow(/21:00/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('a Saturday window is refused at the DAL as well', async () => {
    await expect(
      updateSendPolicy({
        ...DEFAULT_SEND_POLICY,
        weekday: [
          ...DEFAULT_SEND_POLICY.weekday.slice(0, 6),
          { start: '20:00', end: '20:30' },
        ] as SendPolicy['weekday'],
      }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('a permission rejection stops the write', async () => {
    permMock.mockRejectedValueOnce(new Error('forbidden'));
    await expect(updateSendPolicy(NARROWED)).rejects.toThrow('forbidden');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('audits the window that was saved, and no personal data', async () => {
    await updateSendPolicy(NARROWED);
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.send_policy.updated' }),
    );
    const meta = logMock.mock.calls[0][0].meta as Record<string, unknown>;
    expect(meta.weekday).toEqual([
      '10:00-18:00',
      '09:00-20:30',
      '09:00-20:30',
      '09:00-20:30',
      '09:00-20:30',
      '09:00-12:00',
      null,
    ]);
  });
});
