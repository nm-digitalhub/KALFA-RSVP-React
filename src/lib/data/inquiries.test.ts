import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import { createContactMessage, createCallbackRequest } from './inquiries';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

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
  });

  it('does NOT call logActivity for an anonymous submitter (no session)', async () => {
    mockInsertReturning('cm-2');

    const result = await createContactMessage({ ...input, email: undefined }, null);

    expect(result.ok).toBe(true);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('returns ok:false on insert error without throwing', async () => {
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
  });
});
