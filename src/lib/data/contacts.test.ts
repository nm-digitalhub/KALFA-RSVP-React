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
});
