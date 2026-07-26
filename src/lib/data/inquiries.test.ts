import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
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
      { full_name: 'יוסי כהן', phone: '0521112222', topic: 'תמיכה', note: undefined },
      null,
    );

    expect(result.ok).toBe(true);
    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.insert).toHaveBeenCalledWith({
      full_name: 'יוסי כהן',
      phone: '+972521112222',
      topic: 'תמיכה',
      note: null,
    });
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'customer_inquiry',
        source: 'callback_form',
        fields: { callbackRequestId: 'cb-1', topic: 'תמיכה' },
      }),
    );
  });
});
