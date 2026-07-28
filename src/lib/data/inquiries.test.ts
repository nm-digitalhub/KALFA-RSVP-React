import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { CALLBACK_PREFERENCES } from '@/lib/callbacks/schedule-policy';
import { CALLBACK_TIME_PREFERENCES } from '@/lib/validation/inquiries';
import { createContactMessage, createCallbackRequest } from './inquiries';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function mockInsertReturning(id: string) {
  const { client, builder } = createMockSupabase<{ id: string }>({
    data: { id },
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, builder };
}

describe('createContactMessage', () => {
  const input = {
    name: 'דנה לוי',
    email: 'dana@example.com',
    phone: '052-111-2222',
    topic: 'מכירות',
    message: 'אשמח לפרטים',
  } as const;

  it('inserts a normalized row and logs activity for a signed-in submitter', async () => {
    const { client, builder } = mockInsertReturning('cm-1');

    const result = await createContactMessage(input, 'user-1');

    expect(result.ok).toBe(true);
    expect(client.from).toHaveBeenCalledWith('contact_messages');
    expect(builder.insert).toHaveBeenCalledWith({
      name: 'דנה לוי',
      email: 'dana@example.com',
      phone: '+972521112222',
      topic: 'מכירות',
      message: 'אשמח לפרטים',
      user_id: 'user-1',
    });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'inquiry.contact_created',
      meta: { contactMessageId: 'cm-1', source: 'app' },
    });
    // Slack alert fires with the row id + closed-vocabulary topic only — no PII.
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'customer_inquiry',
        source: 'contact_form',
        fields: { contactMessageId: 'cm-1', topic: 'מכירות' },
      }),
    );
  });

  it('fires the Slack alert even for an anonymous submitter (no session)', async () => {
    mockInsertReturning('cm-2');

    const result = await createContactMessage({ ...input, email: undefined }, null);

    expect(result.ok).toBe(true);
    // Anonymous → no activity log, but the Slack alert STILL fires (its whole point).
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false on insert error without throwing, and does not alert', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await createContactMessage(input, null);

    expect(result.ok).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('createCallbackRequest', () => {
  it('inserts a normalized callback row', async () => {
    const { client, builder } = mockInsertReturning('cb-1');

    const result = await createCallbackRequest(
      {
        full_name: 'יוסי כהן',
        phone: '0521112222',
        topic: 'תמיכה',
        note: undefined,
        preference: 'asap',
      },
      null,
    );

    expect(result.ok).toBe(true);
    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.insert).toHaveBeenCalledWith({
      full_name: 'יוסי כהן',
      phone: '+972521112222',
      topic: 'תמיכה',
      note: null,
      // 'asap' means "no stated time" — the scheduler resolves it against the
      // clock when it runs, not against submission time.
      requested_at: null,
      // The band is a DIRECTION as well as an instant, and the instant alone
      // cannot express it — recorded so a taken slot can still be resolved the
      // way the caller asked for.
      requested_rank: 'earliest',
    });
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'customer_inquiry',
        source: 'callback_form',
        fields: { callbackRequestId: 'cb-1', topic: 'תמיכה', מועד: 'asap' },
      }),
    );
  });

  // The field exists because prose in `note` never reaches the scheduler. If
  // the choice stopped being written here it would fail silently — the row
  // would look fine and the caller would be rung at the wrong time.
  it('records a chosen part of the day as the instant the search starts from', async () => {
    const { builder } = mockInsertReturning('cb-2');

    await createCallbackRequest(
      {
        full_name: 'נטלי',
        phone: '0548145688',
        topic: 'מכירות',
        note: undefined,
        preference: 'morning',
      },
      null,
    );

    const written = vi.mocked(builder.insert).mock.calls[0][0] as {
      requested_at: string | null;
      requested_rank: string;
    };
    expect(written.requested_at).not.toBeNull();
    expect(written.requested_rank).toBe('early');
    // Israel wall-clock 09:00 — the morning band's start in the policy engine.
    const israelHour = new Date(written.requested_at as string).toLocaleString('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      hour12: false,
    });
    expect(israelHour).toBe('09');
  });

  it('puts an afternoon request in the afternoon, not merely "later"', async () => {
    const { builder } = mockInsertReturning('cb-3');

    await createCallbackRequest(
      {
        full_name: 'דנה',
        phone: '0521112222',
        topic: 'מכירות',
        note: undefined,
        preference: 'afternoon',
      },
      null,
    );

    const written = vi.mocked(builder.insert).mock.calls[0][0] as {
      requested_at: string | null;
      requested_rank: string;
    };
    // Both afternoon and evening aim at the LATE end of what is workable.
    expect(written.requested_rank).toBe('late');
    const israelHour = new Date(written.requested_at as string).toLocaleString('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      hour12: false,
    });
    expect(israelHour).toBe('12');
  });
});

// The public form and the policy engine must offer the same choices. They are
// declared separately — the form's list excludes 'exact', which needs a picker
// the public form does not have — so this pins the relationship rather than
// leaving it to be noticed when a caller picks something the scheduler ignores.
describe('the form vocabulary and the scheduler agree', () => {
  it('offers every engine preference except the one that needs a picker', () => {
    expect([...CALLBACK_TIME_PREFERENCES]).toEqual(
      CALLBACK_PREFERENCES.filter((p) => p !== 'exact'),
    );
  });
});
