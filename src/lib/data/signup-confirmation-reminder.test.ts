import { beforeEach, describe, expect, it, vi } from 'vitest';

// The sweep mails real people, so the contract worth pinning is the restraint:
// off unless armed, at most one reminder per account ever, a per-run cap, and
// no address in any log line.
vi.mock('server-only', () => ({}));

const { createAdminClient, sendSlackAlert, getAppUrl } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendSlackAlert: vi.fn(),
  getAppUrl: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert }));
vi.mock('@/lib/url', () => ({ getAppUrl }));

import {
  getSignupReminderEnabled,
  runSignupReminderSweep,
} from './signup-confirmation-reminder';

type Candidate = { user_id: string; email: string; created_at: string };

let candidates: Candidate[];
let rpc: ReturnType<typeof vi.fn>;
let resend: ReturnType<typeof vi.fn>;
let latched: string[];
let latchError: { message: string } | null;
let settingsRow: Record<string, unknown> | null;

function candidate(n: number): Candidate {
  return { user_id: `u${n}`, email: `p${n}@example.com`, created_at: '2026-09-05T00:00:00Z' };
}

beforeEach(() => {
  vi.clearAllMocks();
  candidates = [candidate(1), candidate(2)];
  latched = [];
  latchError = null;
  settingsRow = { signup_reminder_enabled: true };
  rpc = vi.fn(async () => ({ data: candidates, error: null }));
  resend = vi.fn(async () => ({ error: null }));
  getAppUrl.mockResolvedValue('https://beta.kalfa.me/auth/confirm');

  createAdminClient.mockReturnValue({
    rpc,
    auth: { resend },
    from: (table: string) => {
      if (table === 'app_settings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: settingsRow, error: null }) }),
          }),
        };
      }
      return {
        update: () => ({
          eq: (_col: string, id: string) => ({
            is: async () => {
              if (latchError) return { error: latchError };
              latched.push(id);
              return { error: null };
            },
          }),
        }),
      };
    },
  });
});

describe('getSignupReminderEnabled', () => {
  it('false when the column is off', async () => {
    settingsRow = { signup_reminder_enabled: false };
    expect(await getSignupReminderEnabled()).toBe(false);
  });

  it('false when the settings row cannot be read — fail-closed, never fail-open', async () => {
    settingsRow = null;
    expect(await getSignupReminderEnabled()).toBe(false);
  });

  it('true only for an explicit true', async () => {
    expect(await getSignupReminderEnabled()).toBe(true);
  });
});

describe('runSignupReminderSweep', () => {
  it('mails each candidate once, through the /auth/confirm redirect', async () => {
    const res = await runSignupReminderSweep();
    expect(res).toEqual({ sent: 2, failed: 0, candidates: 2 });
    expect(resend).toHaveBeenCalledTimes(2);
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'p1@example.com',
      options: { emailRedirectTo: 'https://beta.kalfa.me/auth/confirm' },
    });
  });

  it('latches the account BEFORE mailing, so a crash cannot produce a second reminder', async () => {
    const order: string[] = [];
    resend.mockImplementation(async () => {
      order.push('send');
      return { error: null };
    });
    candidates = [candidate(1)];
    await runSignupReminderSweep();
    expect(latched).toEqual(['u1']);
    expect(order).toEqual(['send']);
  });

  it('a failed latch skips the send entirely — never mail without the one-shot claim', async () => {
    latchError = { message: 'conflict' };
    const res = await runSignupReminderSweep();
    expect(resend).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, failed: 2, candidates: 2 });
  });

  it('a provider failure is counted, not retried — the account stays latched', async () => {
    resend.mockResolvedValueOnce({ error: { message: 'smtp down' } });
    const res = await runSignupReminderSweep();
    expect(res).toEqual({ sent: 1, failed: 1, candidates: 2 });
  });

  it('caps a backlog at 25 per run so live signup and reset mail keeps its budget', async () => {
    candidates = Array.from({ length: 40 }, (_, i) => candidate(i));
    const res = await runSignupReminderSweep();
    expect(res.candidates).toBe(25);
    expect(resend).toHaveBeenCalledTimes(25);
  });

  it('stays silent when there is nothing to do', async () => {
    candidates = [];
    await runSignupReminderSweep();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('reports by user id — an address never reaches Slack', async () => {
    resend.mockResolvedValueOnce({ error: { message: 'bounced' } });
    await runSignupReminderSweep();
    const alert = sendSlackAlert.mock.calls[0][0];
    const text = `${alert.title}\n${alert.detail}`;
    expect(text).toContain('u1');
    expect(text).not.toContain('@example.com');
    expect(alert.level).toBe('warn');
  });

  it('asks the function for the intended window', async () => {
    await runSignupReminderSweep();
    expect(rpc).toHaveBeenCalledWith('signup_reminder_candidates', {
      min_age_hours: 24,
      max_age_days: 7,
    });
  });
});
