import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { listSumitHolds } from './crm-holds';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('listSumitHolds', () => {
  it('maps SUMIT\'s array-wrapped fields into a flat entity', async () => {
    mockFetch(200, {
      Data: {
        Entities: [
          {
            ID: 2127278035,
            Billing_OrderDocument: [{ ID: 2308912892 }],
            Billing_Status: [3],
            Billing_Amount: [152],
            Billing_Date: ['2026-07-07T13:18:50+03:00'],
          },
        ],
      },
    });

    const holds = await listSumitHolds({ companyId: 1, apiKey: 'k' });

    expect(holds).toEqual([
      {
        entityId: 2127278035,
        orderDocumentId: 2308912892,
        billingStatus: 3,
        amount: 152,
        date: '2026-07-07T13:18:50+03:00',
      },
    ]);
  });

  it('maps a hold with no linked order document to null, not a throw', async () => {
    mockFetch(200, {
      Data: { Entities: [{ ID: 1, Billing_Status: [1], Billing_Amount: [200] }] },
    });

    const holds = await listSumitHolds({ companyId: 1, apiKey: 'k' });

    expect(holds[0].orderDocumentId).toBeNull();
  });

  it('returns an empty list when SUMIT returns no entities', async () => {
    mockFetch(200, { Data: {} });

    const holds = await listSumitHolds({ companyId: 1, apiKey: 'k' });

    expect(holds).toEqual([]);
  });

  it('throws on a non-2xx response', async () => {
    mockFetch(500, {});

    await expect(listSumitHolds({ companyId: 1, apiKey: 'k' })).rejects.toThrow('HTTP 500');
  });

  it('sends the folder id, ordering, and default page size', async () => {
    mockFetch(200, { Data: { Entities: [] } });

    await listSumitHolds({ companyId: 42, apiKey: 'secret' });

    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(sent.Credentials).toEqual({ CompanyID: 42, APIKey: 'secret' });
    expect(sent.Folder).toBe('1076735289');
    expect(sent.Order).toEqual({ Property: 'Billing_Date', Descending: true });
    expect(sent.Paging).toEqual({ StartIndex: 0, PageSize: 100 });
    expect(sent.LoadProperties).toBe(true);
  });
});
