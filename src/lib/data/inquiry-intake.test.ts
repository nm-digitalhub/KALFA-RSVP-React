import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { insertContactMessage } from './inquiry-intake';
import type { ContactMessageInput } from '@/lib/validation/inquiries';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

function input(overrides: Partial<ContactMessageInput> = {}): ContactMessageInput {
  return {
    name: 'דנה',
    email: 'dana@example.com',
    topic: 'תמיכה' as ContactMessageInput['topic'],
    message: 'שלום, יש לי שאלה לגבי האירוע',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertContactMessage', () => {
  it('mirrors the message into inquiry_messages as an inbound row (so the thread view shows the original question)', async () => {
    // The shared mock builder resolves every awaited chain the same way; the
    // insert-then-select-single chain for contact_messages needs `data.id`,
    // and the thread insert below only reads `.error`, so one configured
    // result correctly serves both calls.
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'c-new-1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await insertContactMessage(input(), null);

    expect(result).toEqual({ ok: true, id: 'c-new-1' });
    expect(client.from).toHaveBeenCalledWith('inquiry_messages');
    expect(builder.insert).toHaveBeenCalledWith({
      inquiry_id: 'c-new-1',
      direction: 'inbound',
      body: input().message,
    });
  });

  it('still reports success when the thread mirror insert fails (the inquiry row is what must not be lost)', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'c-new-2' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    // Same shared builder serves THREE sequential awaits here — the queue
    // lookup (resolveQueueId), the contact_messages insert, and the
    // inquiry_messages thread mirror — so only the LAST one is made to fail.
    let calls = 0;
    builder.then = ((onFulfilled: (v: unknown) => unknown) => {
      calls += 1;
      return onFulfilled(
        calls <= 2
          ? { data: { id: 'c-new-2' }, error: null }
          : { data: null, error: { message: 'boom', code: '23505' } },
      );
    }) as typeof builder.then;

    const result = await insertContactMessage(input(), null);

    expect(result).toEqual({ ok: true, id: 'c-new-2' });
  });

  it('sends exactly one Slack alert with no PII (id + topic only)', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: { id: 'c-new-3' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await insertContactMessage(input({ topic: 'מכירות' as ContactMessageInput['topic'] }), null);

    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'contact_form',
        fields: { contactMessageId: 'c-new-3', topic: 'מכירות' },
      }),
    );
  });
});
