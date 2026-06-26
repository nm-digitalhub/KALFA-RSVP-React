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
import { deriveContacts, linkGuestContact } from '@/lib/data/contacts';

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
