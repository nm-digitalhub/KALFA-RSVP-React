import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));

import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requireOwnedEvent } from '@/lib/data/events';
import {
  getGuestOutreachSummary,
  insertInteraction,
  listInteractionsForContact,
  markContactRemovalRequested,
  recordRsvpFromWhatsapp,
  resolveGuestByContact,
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

// Cookie (owner) client double for the B7 owner-facing reads. requireOwnedEvent
// is mocked as a no-op so the tests exercise only the query shape + mapping.
function mockCookie(result: QueryResult<Row | Row[]>) {
  const m = createMockSupabase<Row | Row[]>(result);
  vi.mocked(createClient).mockResolvedValue(
    m.client as unknown as Awaited<ReturnType<typeof createClient>>,
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

  it("accepts Meta's bare wa_id format (e.g. '972501234567', no +) — the webhook fallback input", async () => {
    // Guards the phone-fallback billing path: Meta sends `from` as a wa_id with
    // no leading '+'. If normalizePhone rejected it, the fallback would silently
    // no-op and every context-less reply would drop. It must resolve.
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

    const r = await resolveInboundContact('972501234567');

    expect(r).toEqual({ eventId: 'e1', campaignId: 'c1', contactId: 'k1' });
    // Reached the contacts lookup → the wa_id was parsed, not rejected.
    expect(builder.eq).toHaveBeenCalledWith('normalized_phone', '+972501234567');
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

describe('markContactRemovalRequested', () => {
  it('sets removal_requested=true for the contact (leaves op_status alone)', async () => {
    const { builder } = mockAdmin({ data: null, error: null });
    await markContactRemovalRequested('k1');
    expect(builder.update).toHaveBeenCalledWith({ removal_requested: true });
    expect(builder.eq).toHaveBeenCalledWith('id', 'k1');
  });

  it('throws a safe error when the update fails', async () => {
    mockAdmin({ data: null, error: { message: 'boom' } });
    await expect(markContactRemovalRequested('k1')).rejects.toThrow(
      'עדכון בקשת ההסרה נכשל',
    );
  });
});

describe('listInteractionsForContact', () => {
  it('lists the contact timeline oldest-first, scoped to event + contact', async () => {
    const rows: Row[] = [
      {
        id: 'i1',
        direction: 'out',
        kind: 'message',
        delivery_status: 'read',
        delivery_error_code: null,
        provider_id: 'wamid.out1',
        context_message_id: null,
        created_at: '2026-06-30T10:00:00Z',
      },
      {
        id: 'i2',
        direction: 'in',
        kind: 'message',
        delivery_status: null,
        delivery_error_code: null,
        provider_id: 'wamid.in1',
        context_message_id: 'wamid.out1',
        created_at: '2026-06-30T10:05:00Z',
      },
    ];
    const { client, builder } = mockCookie({ data: rows, error: null });

    const r = await listInteractionsForContact('e1', 'k1');

    expect(requireOwnedEvent).toHaveBeenCalledWith('e1');
    expect(client.from).toHaveBeenCalledWith('contact_interactions');
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(builder.eq).toHaveBeenCalledWith('contact_id', 'k1');
    expect(builder.order).toHaveBeenCalledWith('created_at', {
      ascending: true,
    });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      id: 'i1',
      direction: 'out',
      delivery_status: 'read',
    });
    expect(r[1]).toMatchObject({ id: 'i2', direction: 'in' });
  });

  it('returns an empty timeline when the contact has no interactions', async () => {
    mockCookie({ data: [], error: null });
    await expect(listInteractionsForContact('e1', 'k1')).resolves.toEqual([]);
  });

  it('throws a safe error when the query fails', async () => {
    mockCookie({ data: null, error: { message: 'boom' } });
    await expect(listInteractionsForContact('e1', 'k1')).rejects.toThrow(
      'טעינת היסטוריית האינטראקציות נכשלה',
    );
  });
});

describe('getGuestOutreachSummary', () => {
  it("returns the op_status + opt-out from the guest's linked contact", async () => {
    const { client, builder } = mockCookie({ data: null, error: null });
    let call = 0;
    builder.then = (onFulfilled) => {
      call += 1;
      if (call === 1) {
        return onFulfilled({ data: { contact_id: 'k1' }, error: null });
      }
      return onFulfilled({
        data: { op_status: 'reached_billed', removal_requested: true },
        error: null,
      });
    };

    const r = await getGuestOutreachSummary('e1', 'g1');

    expect(requireOwnedEvent).toHaveBeenCalledWith('e1');
    expect(client.from).toHaveBeenCalledWith('guests');
    expect(client.from).toHaveBeenCalledWith('contacts');
    expect(r).toEqual({
      contactId: 'k1',
      opStatus: 'reached_billed',
      removalRequested: true,
    });
  });

  it('returns null when the guest has no linked contact (invalid/missing phone)', async () => {
    mockCookie({ data: { contact_id: null }, error: null });
    await expect(getGuestOutreachSummary('e1', 'g1')).resolves.toBeNull();
  });

  it('throws a safe error when the guest lookup fails', async () => {
    mockCookie({ data: null, error: { message: 'boom' } });
    await expect(getGuestOutreachSummary('e1', 'g1')).rejects.toThrow(
      'טעינת המוזמן נכשלה',
    );
  });
});

describe('resolveGuestByContact', () => {
  it('returns the guest id + token scoped by BOTH contact_id and event_id', async () => {
    const { builder } = mockAdmin({
      data: { id: 'g1', rsvp_token: 'tok-1' },
      error: null,
    });

    const r = await resolveGuestByContact('k1', 'e1');

    expect(r).toEqual({ guestId: 'g1', token: 'tok-1' });
    expect(builder.eq).toHaveBeenCalledWith('contact_id', 'k1');
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
    // limit(1) keeps a stray duplicate (no uniqueness on guests.contact_id) from throwing.
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it('returns null when the contact maps to no guest in that event', async () => {
    mockAdmin({ data: null, error: null });
    await expect(resolveGuestByContact('k1', 'e1')).resolves.toBeNull();
  });

  it('throws a safe error when the lookup fails', async () => {
    mockAdmin({ data: null, error: { message: 'boom' } });
    await expect(resolveGuestByContact('k1', 'e1')).rejects.toThrow(
      'טעינת האורח נכשלה',
    );
  });
});

describe('recordRsvpFromWhatsapp', () => {
  it('inserts a PII-free source marker (ids + status only, user_id null)', async () => {
    const { builder } = mockAdmin({ data: null, error: null });

    await recordRsvpFromWhatsapp('e1', 'g1', 'attending');

    expect(builder.insert).toHaveBeenCalledWith({
      event_id: 'e1',
      user_id: null,
      action: 'rsvp.from_whatsapp',
      meta: { guest_id: 'g1', status: 'attending' },
    });
  });

  it('swallows a failure — the marker is best-effort and never throws', async () => {
    // Force the insert path to throw; the try/catch must absorb it so a marker
    // failure can never fail the RSVP it annotates.
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(
      recordRsvpFromWhatsapp('e1', 'g1', 'declined'),
    ).resolves.toBeUndefined();
  });
});
