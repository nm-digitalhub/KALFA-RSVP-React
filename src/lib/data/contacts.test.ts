import { describe, expect, it, vi } from 'vitest';

// contacts.ts begins with `import 'server-only'` (and pulls in server-only deps);
// that throws outside Next's RSC context. deriveContacts itself is pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// linkGuestContact verifies ownership server-side; stub it as a no-op so the
// unit tests exercise only the contact upsert/link logic.
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  deriveContacts,
  linkGuestContact,
  recordWhatsAppConsent,
  listSendableContacts,
  pruneOrphanContact,
  computeCoveredContacts,
  snapshotAuthorizedSet,
} from '@/lib/data/contacts';

describe('deriveContacts', () => {
  it('de-duplicates guests sharing one phone into a single contact (§13)', () => {
    const r = deriveContacts([
      { id: 'g1', phone: '050-123-4567' },
      { id: 'g2', phone: '+972 50 123 4567' }, // same number, different format
    ]);
    expect(r.uniquePhones).toEqual(['+972501234567']);
    expect(r.guestToPhone.get('g1')).toBe('+972501234567');
    expect(r.guestToPhone.get('g2')).toBe('+972501234567');
    expect(r.withValidPhone).toBe(2);
    expect(r.invalid).toBe(0);
  });

  it('excludes invalid / missing phones (not billable, not a contact)', () => {
    const r = deriveContacts([
      { id: 'g1', phone: '0501234567' },
      { id: 'g2', phone: '123' }, // invalid
      { id: 'g3', phone: null }, // missing
    ]);
    expect(r.uniquePhones).toEqual(['+972501234567']);
    expect(r.guestToPhone.get('g2')).toBeNull();
    expect(r.guestToPhone.get('g3')).toBeNull();
    expect(r.withValidPhone).toBe(1);
    expect(r.invalid).toBe(2);
  });

  it('counts distinct valid numbers', () => {
    const r = deriveContacts([
      { id: 'g1', phone: '0501111111' },
      { id: 'g2', phone: '0502222222' },
      { id: 'g3', phone: '0501111111' },
    ]);
    expect(r.uniquePhones.length).toBe(2);
    expect(r.withValidPhone).toBe(3);
  });

  it('handles an empty guest list', () => {
    const r = deriveContacts([]);
    expect(r.uniquePhones).toEqual([]);
    expect(r.withValidPhone).toBe(0);
    expect(r.invalid).toBe(0);
  });
});

describe('linkGuestContact', () => {
  it('upserts the contact (idempotent) and links the guest for a valid phone', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'c1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await linkGuestContact('e1', 'g1', '050-123-4567');

    expect(client.from).toHaveBeenCalledWith('contacts');
    expect(builder.upsert).toHaveBeenCalledWith(
      { event_id: 'e1', normalized_phone: '+972501234567' },
      { onConflict: 'event_id,normalized_phone' },
    );
    expect(client.from).toHaveBeenCalledWith('guests');
    expect(builder.update).toHaveBeenCalledWith({ contact_id: 'c1' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'g1');
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
  });

  it('sets contact_id to null for an invalid phone (no contact upsert, §5.4)', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await linkGuestContact('e1', 'g2', '123');

    expect(builder.upsert).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ contact_id: null });
    expect(builder.eq).toHaveBeenCalledWith('id', 'g2');
  });

  it('treats a missing (null) phone as not billable', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await linkGuestContact('e1', 'g3', null);

    expect(builder.upsert).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ contact_id: null });
  });
});

describe('pruneOrphanContact', () => {
  // Per-table builders so each count query (guests/billed_results/
  // contact_interactions) resolves to a DIFFERENT count, and contacts.delete is
  // observable. (The shared createMockSupabase returns one count for all awaits.)
  function mockPrune(counts: {
    guests: number;
    billed: number;
    interactions: number;
  }) {
    const mkCount = (count: number) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'delete']) b[m] = vi.fn(() => b);
      (b as { then: unknown }).then = (f: (v: unknown) => unknown) =>
        f({ data: null, error: null, count });
      return b;
    };
    const del: Record<string, unknown> = {};
    for (const m of ['delete', 'eq']) del[m] = vi.fn(() => del);
    (del as { then: unknown }).then = (f: (v: unknown) => unknown) =>
      f({ data: null, error: null });
    const from = vi.fn((table: string) => {
      if (table === 'guests') return mkCount(counts.guests);
      if (table === 'billed_results') return mkCount(counts.billed);
      if (table === 'contact_interactions') return mkCount(counts.interactions);
      return del; // contacts
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from,
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof createAdminClient>);
    return { from, del };
  }

  it('deletes a fresh orphan (no guest ref, no billing/outreach history)', async () => {
    const { from, del } = mockPrune({ guests: 0, billed: 0, interactions: 0 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(true);
    expect(from).toHaveBeenCalledWith('contacts');
    expect(del.delete).toHaveBeenCalled();
  });

  it('KEEPS a contact still referenced by another guest (no delete)', async () => {
    const { del } = mockPrune({ guests: 1, billed: 0, interactions: 0 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(false);
    expect(del.delete).not.toHaveBeenCalled();
  });

  it('KEEPS an orphan that has billing history (audit trail)', async () => {
    const { del } = mockPrune({ guests: 0, billed: 1, interactions: 0 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(false);
    expect(del.delete).not.toHaveBeenCalled();
  });

  it('KEEPS an orphan that has outreach interactions (audit trail)', async () => {
    const { del } = mockPrune({ guests: 0, billed: 0, interactions: 1 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(false);
    expect(del.delete).not.toHaveBeenCalled();
  });
});

describe('recordWhatsAppConsent', () => {
  it('stamps whatsapp_consent_at scoped by id + event', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await recordWhatsAppConsent('e1', 'c1');

    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.whatsapp_consent_at).toBeTruthy();
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
  });
});

describe('listSendableContacts', () => {
  it('returns non-removed, consented contacts for the event', async () => {
    const { client, builder } = createMockSupabase<
      Array<{ id: string; normalized_phone: string }>
    >({
      data: [{ id: 'c1', normalized_phone: '+972501234567' }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const r = await listSendableContacts('e1');

    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(builder.eq).toHaveBeenCalledWith('removal_requested', false);
    expect(builder.not).toHaveBeenCalledWith('whatsapp_consent_at', 'is', null);
    expect(r).toEqual([{ id: 'c1', normalized_phone: '+972501234567' }]);
  });

  it('binds to the campaign authorized SET (INNER JOIN) when a campaignId is given', async () => {
    const { client, builder } = createMockSupabase<
      Array<{ id: string; normalized_phone: string }>
    >({
      data: [{ id: 'c1', normalized_phone: '+972501234567' }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const r = await listSendableContacts('e1', 'camp1');

    // INNER JOIN the frozen set → reached ⊆ authorized.
    expect(builder.select).toHaveBeenCalledWith(
      'id, normalized_phone, campaign_authorized_contacts!inner(campaign_id)',
    );
    expect(builder.eq).toHaveBeenCalledWith(
      'campaign_authorized_contacts.campaign_id',
      'camp1',
    );
    // Still gated on event scope + consent + not-removed.
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(builder.eq).toHaveBeenCalledWith('removal_requested', false);
    expect(builder.not).toHaveBeenCalledWith('whatsapp_consent_at', 'is', null);
    // The embedded join column is stripped from the returned shape.
    expect(r).toEqual([{ id: 'c1', normalized_phone: '+972501234567' }]);
  });
});

describe('computeCoveredContacts', () => {
  it('caps coverage at the reasonable-coverage threshold when full exceeds it', () => {
    expect(computeCoveredContacts(350, 300)).toBe(300);
  });

  it('covers all contacts when full is within the threshold', () => {
    expect(computeCoveredContacts(120, 300)).toBe(120);
    expect(computeCoveredContacts(300, 300)).toBe(300);
  });

  it('handles an empty event (full = 0)', () => {
    expect(computeCoveredContacts(0, 300)).toBe(0);
  });
});

describe('snapshotAuthorizedSet', () => {
  // The snapshot makes 3 distinct table calls (contacts SELECT → set upsert →
  // set COUNT) that must resolve to DIFFERENT results, so the shared
  // createMockSupabase (one result for all awaits) won't do — build per-call
  // thenable builders (mirrors the pruneOrphanContact pattern).
  function thenable(result: Record<string, unknown>) {
    const b: Record<string, unknown> = {};
    for (const m of [
      'select',
      'upsert',
      'delete',
      'eq',
      'not',
      'order',
      'limit',
    ]) {
      b[m] = vi.fn(() => b);
    }
    (b as { then: unknown }).then = (f: (v: unknown) => unknown) => f(result);
    return b as Record<string, ReturnType<typeof vi.fn>> & {
      then: (f: (v: unknown) => unknown) => unknown;
    };
  }

  function mockSnapshot(
    eligible: Array<{ id: string }>,
    setCount: number,
  ) {
    const contactsB = thenable({ data: eligible, error: null });
    // REPLACE order on campaign_authorized_contacts: 1=prune DELETE, 2=upsert, 3=count.
    const deleteB = thenable({ data: null, error: null });
    const upsertB = thenable({ data: null, error: null });
    const countB = thenable({ data: null, error: null, count: setCount });
    let cacCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === 'contacts') return contactsB;
      if (table === 'campaign_authorized_contacts') {
        cacCalls += 1;
        if (cacCalls === 1) return deleteB;
        if (cacCalls === 2) return upsertB;
        return countB;
      }
      return thenable({ data: null, error: null });
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from,
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof createAdminClient>);
    return { from, contactsB, deleteB, upsertB, countB };
  }

  it('sources ONLY current-guest contacts (guests!inner), respects coverage + deterministic order', async () => {
    const { from, contactsB } = mockSnapshot(
      [{ id: 'c1' }, { id: 'c2' }],
      2,
    );

    const size = await snapshotAuthorizedSet('e1', 'camp1', 2);

    // The EXISTS(current guest) is the inner join on guests.contact_id; orphaned
    // contacts (no guest row) are excluded by !inner.
    expect(from).toHaveBeenCalledWith('contacts');
    expect(contactsB.select).toHaveBeenCalledWith('id, guests!inner(id)');
    expect(contactsB.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(contactsB.eq).toHaveBeenCalledWith('removal_requested', false);
    // Deterministic order (created_at, id).
    expect(contactsB.order).toHaveBeenCalledWith('created_at', {
      ascending: true,
    });
    expect(contactsB.order).toHaveBeenCalledWith('id', { ascending: true });
    // Capped at coverage.
    expect(contactsB.limit).toHaveBeenCalledWith(2);
    expect(size).toBe(2);
  });

  it('inserts ON CONFLICT (campaign_id, contact_id) DO NOTHING — idempotent upsert', async () => {
    const { from, upsertB } = mockSnapshot([{ id: 'c1' }, { id: 'c2' }], 2);

    await snapshotAuthorizedSet('e1', 'camp1', 2);

    expect(from).toHaveBeenCalledWith('campaign_authorized_contacts');
    expect(upsertB.upsert).toHaveBeenCalledWith(
      [
        { event_id: 'e1', campaign_id: 'camp1', contact_id: 'c1' },
        { event_id: 'e1', campaign_id: 'camp1', contact_id: 'c2' },
      ],
      { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true },
    );
  });

  it('REPLACE semantics: prunes set rows whose contact is NOT in the fresh set', async () => {
    const { deleteB } = mockSnapshot([{ id: 'c1' }, { id: 'c2' }], 2);

    await snapshotAuthorizedSet('e1', 'camp1', 2);

    // The prune removes any existing member not in the fresh current-guest set,
    // so a stale/orphaned member can never linger across a re-snapshot.
    expect(deleteB.delete).toHaveBeenCalled();
    expect(deleteB.eq).toHaveBeenCalledWith('campaign_id', 'camp1');
    expect(deleteB.not).toHaveBeenCalledWith('contact_id', 'in', '(c1,c2)');
  });

  it('returns the resulting SET size from the count query, not the inserted-row count', async () => {
    // 1 newly-eligible contact but the campaign set already holds 5 → returns 5
    // (a no-op re-run yields the same frozen size).
    const { countB } = mockSnapshot([{ id: 'c1' }], 5);

    const size = await snapshotAuthorizedSet('e1', 'camp1', 300);

    expect(countB.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(countB.eq).toHaveBeenCalledWith('campaign_id', 'camp1');
    expect(size).toBe(5);
  });

  it('skips the insert when there are no current-guest contacts (empty set)', async () => {
    const { from, upsertB } = mockSnapshot([], 0);

    const size = await snapshotAuthorizedSet('e1', 'camp1', 300);

    // No rows → no upsert call against the set table; still returns 0.
    expect(upsertB.upsert).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('campaign_authorized_contacts'); // count only
    expect(size).toBe(0);
  });
});
