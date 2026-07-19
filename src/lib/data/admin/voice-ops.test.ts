import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/call-attempts', () => ({ countActiveCalls: vi.fn() }));
vi.mock('@/lib/data/admin/access-log', () => ({ recordStaffAccess: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  aggregateEventActivity,
  computeAnswerRate,
  listCallAttemptsForEvent,
  listCallRecordings,
} from './voice-ops';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as unknown as User);
});

describe('computeAnswerRate (binding formula)', () => {
  it('is completed / (completed+no_answer+no_response+failed)', () => {
    expect(computeAnswerRate(3, 10)).toBeCloseTo(0.3);
    expect(computeAnswerRate(0, 4)).toBe(0);
  });
  it('is null (shown as —) when the denominator is 0', () => {
    expect(computeAnswerRate(0, 0)).toBeNull();
  });
});

describe('aggregateEventActivity (JS-first grouping)', () => {
  it('groups by event, tallies statuses + rsvp, tracks last activity, sorts desc', () => {
    const agg = aggregateEventActivity([
      { event_id: 'e1', status: 'completed', rsvp_digit: '1', created_at: '2026-07-10T10:00:00Z' },
      { event_id: 'e1', status: 'no_answer', rsvp_digit: null, created_at: '2026-07-11T10:00:00Z' },
      { event_id: 'e2', status: 'failed', rsvp_digit: null, created_at: '2026-07-19T09:00:00Z' },
      { event_id: 'e1', status: 'completed', rsvp_digit: '2', created_at: '2026-07-09T10:00:00Z' },
    ]);
    // e2 has the most recent activity → sorted first.
    expect(agg.map((a) => a.eventId)).toEqual(['e2', 'e1']);
    const e1 = agg.find((a) => a.eventId === 'e1')!;
    expect(e1).toMatchObject({
      attempts: 3,
      completed: 2,
      noAnswer: 1,
      failed: 0,
      rsvpFromCall: 2,
      lastActivityAt: '2026-07-11T10:00:00Z',
    });
  });
  it('returns an empty array for no rows', () => {
    expect(aggregateEventActivity([])).toEqual([]);
  });
});

describe('listCallAttemptsForEvent — requirePlatformPermission + PII column guard', () => {
  it('does NOT query when the admin gate rejects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    await expect(listCallAttemptsForEvent('e1')).rejects.toThrow();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('never exposes access_token, and maps recording/transcript to booleans', async () => {
    let selectArg = '';
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'range']) {
      builder[m] = vi.fn((...args: unknown[]) => {
        if (m === 'select') selectArg = String(args[0]);
        return builder;
      });
    }
    (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
      onF({
        data: [
          {
            id: 'a1',
            status: 'completed',
            created_at: '2026-07-19T10:00:00Z',
            call_duration_sec: 42,
            rsvp_digit: '1',
            rsvp_method: 'dtmf',
            finish_reason: null,
            vox_call_session_history_id: '999',
            recording_url: 'https://secret/rec',
            transcript: [{ speaker: 'agent', text: 'x', at: 't' }],
          },
        ],
        count: 1,
        error: null,
      });
    // The fn now resolves the event owner (for the audit) before reading attempts.
    const eventsBuilder = {
      select: vi.fn(() => eventsBuilder),
      eq: vi.fn(() => eventsBuilder),
      maybeSingle: vi.fn(async () => ({ data: { owner_id: 'o1' }, error: null })),
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'events' ? eventsBuilder : builder,
      ),
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await listCallAttemptsForEvent('e1');

    // The select list must NOT request access_token (PII guard, plan §4).
    expect(selectArg).not.toContain('access_token');
    const row = res.items[0];
    expect(row.hasRecording).toBe(true);
    expect(row.hasTranscript).toBe(true);
    // The raw recording URL / transcript content must never surface on the DTO.
    expect(JSON.stringify(res.items)).not.toContain('https://secret/rec');
    expect(JSON.stringify(res.items)).not.toContain('speaker');
    expect(row.sessionHistoryId).toBe('999');
  });
});

describe('listCallRecordings — gate-before-query + service_role + column guard', () => {
  it('does NOT query when the view_recordings gate rejects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    await expect(listCallRecordings()).rejects.toThrow();
    // The gate is now the SOLE control (service_role bypasses RLS): if it does not
    // run before the client, the recording_url surface is unprotected.
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('reads via createAdminClient with a fixed column list that excludes access_token/transcript', async () => {
    let selectArg = '';
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit']) {
      builder[m] = vi.fn((...args: unknown[]) => {
        if (m === 'select') selectArg = String(args[0]);
        return builder;
      });
    }
    (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
      onF({
        data: [
          {
            id: 'a1',
            campaign_id: 'c1',
            event_id: 'e1',
            status: 'completed',
            finish_reason: null,
            call_duration_sec: 42,
            recording_url: 'https://secret/rec',
            recording_started_at: '2026-07-19T10:00:00Z',
            created_at: '2026-07-19T10:00:00Z',
          },
        ],
        error: null,
      });
    const fromSpy = vi.fn(() => builder);
    vi.mocked(createAdminClient).mockReturnValue({
      from: fromSpy,
    } as unknown as ReturnType<typeof createAdminClient>);

    const rows = await listCallRecordings();

    // Service-role client used (not the cookie client) — locks the flip against a
    // silent revert once the call_attempts_admin_read RLS policy is dropped.
    expect(createAdminClient).toHaveBeenCalled();
    expect(fromSpy).toHaveBeenCalledWith('call_attempts');
    // recording_url is intentionally selected (this is the surface that exposes it)…
    expect(selectArg).toContain('recording_url');
    // …but a future select('*') that would drag access_token/transcript into the
    // page must fail this test.
    expect(selectArg).not.toContain('access_token');
    expect(selectArg).not.toContain('transcript');
    expect(selectArg).not.toContain('*');
    expect(rows[0].recording_url).toBe('https://secret/rec');
  });
});
