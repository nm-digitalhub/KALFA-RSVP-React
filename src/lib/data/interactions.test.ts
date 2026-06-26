import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  insertInteraction,
  resolveInboundContact,
  setContactOpStatus,
  type InteractionRow,
} from '@/lib/data/interactions';

type Row = Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

function mockAdmin(result: QueryResult<Row | Row[]>) {
  const m = createMockSupabase<Row | Row[]>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    m.client as unknown as ReturnType<typeof createAdminClient>,
  );
  return m;
}

const inboundRow: InteractionRow = {
  event_id: 'e1',
  campaign_id: 'c1',
  contact_id: 'k1',
  channel: 'whatsapp',
  direction: 'in',
  kind: 'message',
  provider_id: 'wamid.1',
  billable: true,
};

describe('insertInteraction', () => {
  it('returns true when this call inserted (no conflict)', async () => {
    const { builder } = mockAdmin({ data: { id: 'i1' }, error: null });
    await expect(insertInteraction(inboundRow)).resolves.toBe(true);
    expect(builder.upsert).toHaveBeenCalledWith(inboundRow, {
      onConflict: 'channel,provider_id',
      ignoreDuplicates: true,
    });
  });

  it('returns false when the provider event was already recorded (Meta retry)', async () => {
    mockAdmin({ data: null, error: null });
    await expect(insertInteraction(inboundRow)).resolves.toBe(false);
  });
});

describe('resolveInboundContact', () => {
  it('returns null for an unparseable phone', async () => {
    await expect(resolveInboundContact('not-a-phone')).resolves.toBeNull();
  });

  it('returns null when no contact has that phone', async () => {
    mockAdmin({ data: [], error: null });
    await expect(resolveInboundContact('0501234567')).resolves.toBeNull();
  });

  it('resolves to the campaign/contact of the latest prior outbound interaction', async () => {
    const { client, builder } = createMockSupabase<Row | Row[]>({
      data: null,
      error: null,
    });
    let call = 0;
    builder.then = (onFulfilled) => {
      call += 1;
      if (call === 1) {
        return onFulfilled({ data: [{ id: 'k1' }], error: null });
      }
      return onFulfilled({
        data: { event_id: 'e1', campaign_id: 'c1', contact_id: 'k1' },
        error: null,
      });
    };
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const r = await resolveInboundContact('0501234567');

    expect(r).toEqual({ eventId: 'e1', campaignId: 'c1', contactId: 'k1' });
    expect(builder.eq).toHaveBeenCalledWith('direction', 'out');
  });
});

describe('setContactOpStatus', () => {
  it('updates op_status for the contact', async () => {
    const { builder } = mockAdmin({ data: null, error: null });
    await setContactOpStatus('k1', 'reached_billed');
    expect(builder.update).toHaveBeenCalledWith({ op_status: 'reached_billed' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'k1');
  });
});
