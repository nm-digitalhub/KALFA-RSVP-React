import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildContactsForEvent } from '@/lib/data/contacts';

type GuestRow = { id: string; phone: string | null; seq: number };

// A Supabase double whose `order()` really sorts, so a missing `.order('seq')`
// leaves the rows in the (deliberately scrambled) order the database returned
// them — the exact defect: an unordered SELECT returns heap order, not file order.
function guestsBuilder(rows: GuestRow[]) {
  let data = [...rows];
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: (column: keyof GuestRow, opts?: { ascending?: boolean }) => {
      const dir = opts?.ascending === false ? -1 : 1;
      data = [...data].sort((a, b) => (Number(a[column]) - Number(b[column])) * dir);
      return builder;
    },
    then: (resolve: (v: { data: GuestRow[]; error: null }) => unknown) =>
      resolve({ data, error: null }),
  };
  return builder;
}

describe('buildContactsForEvent — contacts are created in the guests\' order of addition', () => {
  const createdPhones: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    createdPhones.length = 0;
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'contacts') {
          return {
            upsert: (row: { normalized_phone: string }) => ({
              select: () => ({
                single: async () => {
                  createdPhones.push(row.normalized_phone);
                  return { data: { id: `contact-${createdPhones.length}` }, error: null };
                },
              }),
            }),
          };
        }
        // guests.update({ contact_id }).eq().eq()
        return { update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) };
      },
    } as unknown as ReturnType<typeof createAdminClient>);
  });

  it('orders by seq: a scrambled SELECT still yields contacts in file order', async () => {
    // File order is seq 1,2,3 (A,B,C); the database handed them back as C,A,B.
    const rows: GuestRow[] = [
      { id: 'g-c', phone: '0541234567', seq: 3 },
      { id: 'g-a', phone: '0501234567', seq: 1 },
      { id: 'g-b', phone: '0521234567', seq: 2 },
    ];
    vi.mocked(createClient).mockResolvedValue({
      from: () => guestsBuilder(rows),
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await buildContactsForEvent('event-1');

    expect(createdPhones).toEqual(['+972501234567', '+972521234567', '+972541234567']);
    // The caller (import → reconcile loop) walks contactIds in this order, so it is
    // also the order seats are handed out in.
    expect(result.contactIds).toEqual(['contact-1', 'contact-2', 'contact-3']);
  });

  it('a household: two guests on one phone give ONE contact, ranked by the earliest guest', async () => {
    const rows: GuestRow[] = [
      { id: 'g-2', phone: '0521234567', seq: 2 },
      { id: 'g-1', phone: '0501234567', seq: 1 },
      { id: 'g-3', phone: '0521234567', seq: 3 }, // same phone as g-2
    ];
    vi.mocked(createClient).mockResolvedValue({
      from: () => guestsBuilder(rows),
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await buildContactsForEvent('event-1');

    expect(createdPhones).toEqual(['+972501234567', '+972521234567']);
    expect(result.uniqueContacts).toBe(2);
  });
});
