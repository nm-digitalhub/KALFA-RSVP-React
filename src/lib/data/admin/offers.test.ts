import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  OfferFloorError,
  OFFER_COLUMNS,
} from './offers';
import type { OfferInput } from '@/lib/validation/admin';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

type Result = { data: unknown; error: { message: string; code?: string } | null };

// The offers module runs several queries per call (floors read, offer write, package rows), each
// on its own table — a per-table queue of results, with every chained builder recorded so the
// tests can assert what was written where. from(table) pops that table's next configured result;
// an unconfigured table answers empty.
function tableClient(queues: Record<string, Result[]>) {
  const calls: Record<string, Array<Record<string, ReturnType<typeof vi.fn>>>> = {};
  const client = {
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of [
        'select',
        'insert',
        'update',
        'delete',
        'upsert',
        'eq',
        'in',
        'is',
        'order',
        'single',
        'maybeSingle',
      ]) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (onFulfilled: (value: Result) => unknown) => onFulfilled(result);
      (calls[table] ??= []).push(builder as Record<string, ReturnType<typeof vi.fn>>);
      return builder;
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
  return { client, calls };
}

function wire(queues: Record<string, Result[]>) {
  const { client, calls } = tableClient(queues);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, calls };
}

const offerRow = {
  id: 'o-1',
  title: 'הנחה אחרי התנגדות מחיר',
  kind: 'percent',
  value: 5,
  validity_days: 14,
  allow_agent: true,
  allow_staff: true,
  agent_objections: ['price'],
  may_replace: false,
  is_active: true,
  created_at: '2026-10-12T10:00:00.000Z',
  offer_packages: [{ package_id: 'p-1', value_override: null }],
};

const input: OfferInput = {
  title: 'הנחה אחרי התנגדות מחיר',
  kind: 'percent',
  value: 5,
  validity_days: 14,
  allow_agent: true,
  allow_staff: true,
  agent_objections: ['price'],
  may_replace: false,
  is_active: true,
  packages: [{ package_id: 'p-1', value_override: null }],
};

const packagePrices = [{ id: 'p-1', name: 'בסיס', price_with_vat: 100 }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
});

describe('listOffers', () => {
  it('reads the offers with their packages through the admin client, after the gate', async () => {
    const { client, calls } = wire({ offers: [{ data: [offerRow], error: null }] });

    const offers = await listOffers();

    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(client.from).toHaveBeenCalledWith('offers');
    expect(calls.offers[0].select).toHaveBeenCalledWith(OFFER_COLUMNS);
    expect(offers[0].packages).toEqual([{ package_id: 'p-1', value_override: null }]);
  });

  it('does NOT query when the gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = wire({});

    await expect(listOffers()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('getOffer', () => {
  it('404s a missing id', async () => {
    wire({ offers: [{ data: null, error: null }] });

    await expect(getOffer('missing')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('createOffer', () => {
  it('creates the offer and its package rows, and records the audit row', async () => {
    const { calls } = wire({
      packages: [{ data: packagePrices, error: null }],
      offers: [{ data: { id: 'o-new' }, error: null }],
      offer_packages: [{ data: null, error: null }],
    });

    const { id } = await createOffer(input);

    expect(id).toBe('o-new');
    expect(calls.offer_packages[0].insert).toHaveBeenCalledWith([
      { offer_id: 'o-new', package_id: 'p-1', value_override: null },
    ]);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'offer.created',
        meta: expect.objectContaining({ offerId: 'o-new', packageCount: 1 }),
      }),
    );
  });

  it('refuses an offer that floors a package at zero (D14) before writing anything', async () => {
    const { client } = wire({ packages: [{ data: packagePrices, error: null }] });

    await expect(createOffer({ ...input, kind: 'percent', value: 100 })).rejects.toThrow(
      OfferFloorError,
    );
    // Only the price read ran — the offer itself was never inserted.
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('packages');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('a per-package override can floor the price on its own', async () => {
    wire({ packages: [{ data: packagePrices, error: null }] });

    await expect(
      createOffer({
        ...input,
        kind: 'amount',
        value: 10,
        packages: [{ package_id: 'p-1', value_override: 150 }],
      }),
    ).rejects.toThrow(OfferFloorError);
  });

  it('refuses a package id that does not exist instead of dropping it', async () => {
    wire({ packages: [{ data: [], error: null }] });

    await expect(createOffer(input)).rejects.toThrow('אחת החבילות שנבחרו אינה קיימת עוד');
  });

  it('removes the fresh offer row when the package rows fail to insert', async () => {
    const { calls } = wire({
      packages: [{ data: packagePrices, error: null }],
      offers: [
        { data: { id: 'o-new' }, error: null },
        { data: null, error: null }, // the cleanup delete
      ],
      offer_packages: [{ data: null, error: { message: 'boom' } }],
    });

    await expect(createOffer(input)).rejects.toThrow('יצירת ההצעה נכשלה');
    expect(calls.offers[1].delete).toHaveBeenCalled();
    expect(calls.offers[1].eq).toHaveBeenCalledWith('id', 'o-new');
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('updateOffer', () => {
  it('writes only offers and offer_packages — never the frozen assignments (D3)', async () => {
    const { client, calls } = wire({
      packages: [{ data: packagePrices, error: null }],
      offers: [
        { data: offerRow, error: null }, // getOffer (changed-fields diff)
        { data: null, error: null }, // the update
      ],
      offer_packages: [
        { data: null, error: null }, // delete
        { data: null, error: null }, // insert
      ],
    });

    await updateOffer('o-1', { ...input, value: 7 });

    const tables = client.from.mock.calls.map(([t]) => t);
    expect(tables).not.toContain('coupon_assignments');
    expect(tables).not.toContain('coupon_assignment_options');
    expect(calls.offer_packages[0].delete).toHaveBeenCalled();
    expect(calls.offer_packages[1].insert).toHaveBeenCalledWith([
      { offer_id: 'o-1', package_id: 'p-1', value_override: null },
    ]);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'offer.updated',
        meta: expect.objectContaining({ changedFields: ['value'] }),
      }),
    );
  });

  it('applies the floor refusal on update too', async () => {
    wire({ packages: [{ data: packagePrices, error: null }] });

    await expect(updateOffer('o-1', { ...input, kind: 'amount', value: 100 })).rejects.toThrow(
      OfferFloorError,
    );
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('deleteOffer', () => {
  it('maps the RESTRICT violation (assignments exist) to the deactivate-instead message', async () => {
    wire({
      offers: [
        { data: offerRow, error: null }, // getOffer
        { data: null, error: { message: 'fk', code: '23503' } },
      ],
    });

    await expect(deleteOffer('o-1')).rejects.toThrow(
      'לא ניתן למחוק הצעה שכבר הוקצו ממנה הטבות. אפשר לסמן אותה כלא פעילה.',
    );
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('deletes and records the audit row', async () => {
    wire({
      offers: [
        { data: offerRow, error: null },
        { data: null, error: null },
      ],
    });

    await deleteOffer('o-1');

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'offer.deleted' }),
    );
  });
});

describe('permission gate', () => {
  it.each([
    ['listOffers', () => listOffers()],
    ['getOffer', () => getOffer('o-1')],
    ['createOffer', () => createOffer(input)],
    ['updateOffer', () => updateOffer('o-1', input)],
    ['deleteOffer', () => deleteOffer('o-1')],
  ])('%s rejects without manage_billing and runs no query', async (_name, run) => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = wire({});

    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });
});
