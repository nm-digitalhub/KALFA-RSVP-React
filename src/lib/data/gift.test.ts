import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';
import { getGiftByToken } from '@/lib/data/gift';

type EventRow = {
  id: string;
  name: string;
  event_type: string;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  celebrants: unknown;
  invite_image_path: string | null;
  status: string;
  gift_payment_url: string | null;
};

function baseRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'ev1',
    name: 'אירוע',
    event_type: 'brit',
    event_date: '2026-07-12T14:30:00+00:00',
    venue_name: 'בית כנסת',
    venue_address: 'רחוב 1',
    celebrants: { parents: 'נטלי' },
    invite_image_path: null,
    status: 'active',
    gift_payment_url: 'https://www.bitpay.co.il/app/me/ABC',
    ...overrides,
  };
}

function mock(result: QueryResult<EventRow>) {
  const { client, builder } = createMockSupabase<EventRow>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe('getGiftByToken', () => {
  it('returns a safe view for an active event with an https link, and NEVER exposes gift_payment_url', async () => {
    const builder = mock({ data: baseRow(), error: null });
    const view = await getGiftByToken('a'.repeat(32));

    expect(view).not.toBeNull();
    expect(view).toMatchObject({ id: 'ev1', event_type: 'brit', giftProvider: 'bit' });
    // The raw payment URL must never leave the server.
    expect(view as object).not.toHaveProperty('gift_payment_url');
    expect(builder.eq).toHaveBeenCalledWith('gift_link_token', 'a'.repeat(32));
  });

  it('derives the provider from the URL (paybox / other)', async () => {
    mock({ data: baseRow({ gift_payment_url: 'https://link.paybox.co.il/x' }), error: null });
    expect((await getGiftByToken('t'))?.giftProvider).toBe('paybox');

    mock({ data: baseRow({ gift_payment_url: 'https://example.com/pay' }), error: null });
    expect((await getGiftByToken('t'))?.giftProvider).toBe('other');
  });

  it('returns null when the event is not active', async () => {
    mock({ data: baseRow({ status: 'draft' }), error: null });
    expect(await getGiftByToken('t')).toBeNull();

    mock({ data: baseRow({ status: 'closed' }), error: null });
    expect(await getGiftByToken('t')).toBeNull();
  });

  it('returns null when the payment link is missing or not https', async () => {
    mock({ data: baseRow({ gift_payment_url: null }), error: null });
    expect(await getGiftByToken('t')).toBeNull();

    mock({ data: baseRow({ gift_payment_url: 'http://insecure.example/pay' }), error: null });
    expect(await getGiftByToken('t')).toBeNull();
  });

  it('returns null on no row or a DB error', async () => {
    mock({ data: null, error: null });
    expect(await getGiftByToken('t')).toBeNull();

    mock({ data: null, error: { message: 'boom' } });
    expect(await getGiftByToken('t')).toBeNull();
  });
});
