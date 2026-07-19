import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/interactions', () => ({ setContactOpStatus: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { setContactOpStatus } from '@/lib/data/interactions';
import {
  recordReached,
  getCampaignBillingSummary,
  getCampaignCreditTotal,
} from '@/lib/data/billing';

type RpcResult = { data: unknown; error: { message: string } | null };

function mockRpc(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  vi.mocked(createAdminClient).mockReturnValue({
    rpc,
    from: vi.fn(),
  } as unknown as ReturnType<typeof createAdminClient>);
  return rpc;
}

const args = {
  eventId: 'e1',
  campaignId: 'c1',
  contactId: 'k1',
  channel: 'whatsapp' as const,
  attemptId: 'a1',
  evidence: 'inbound_message',
  providerRef: 'wamid.1',
};

beforeEach(() => vi.clearAllMocks());

describe('recordReached', () => {
  it('calls the RPC with the locked-txn params and moves the contact to reached_billed on billed', async () => {
    const rpc = mockRpc({ data: 'billed', error: null });

    const outcome = await recordReached(args);

    expect(outcome).toBe('billed');
    expect(rpc).toHaveBeenCalledWith('try_record_billed_result', {
      p_event: 'e1',
      p_campaign: 'c1',
      p_contact: 'k1',
      p_channel: 'whatsapp',
      p_attempt: 'a1',
      p_evidence: 'inbound_message',
      p_provider_ref: 'wamid.1',
    });
    expect(setContactOpStatus).toHaveBeenCalledWith('k1', 'reached_billed');
  });

  it('does NOT change op_status when the cap is already reached', async () => {
    mockRpc({ data: 'ceiling_reached', error: null });
    const outcome = await recordReached(args);
    expect(outcome).toBe('ceiling_reached');
    expect(setContactOpStatus).not.toHaveBeenCalled();
  });

  it('does NOT change op_status when the contact was already billed (dedup)', async () => {
    mockRpc({ data: 'already_billed', error: null });
    const outcome = await recordReached(args);
    expect(outcome).toBe('already_billed');
    expect(setContactOpStatus).not.toHaveBeenCalled();
  });

  it('throws when the RPC errors', async () => {
    mockRpc({ data: null, error: { message: 'boom' } });
    await expect(recordReached(args)).rejects.toThrow();
  });
});

describe('getCampaignBillingSummary', () => {
  it('maps the RPC row to the summary B4 consumes', async () => {
    mockRpc({
      data: [{ reached_count: 3, accrued: 12, ceiling: 88, max_contacts: 22 }],
      error: null,
    });
    await expect(getCampaignBillingSummary('c1')).resolves.toEqual({
      reachedCount: 3,
      accrued: 12,
      ceiling: 88,
      maxContacts: 22,
    });
  });

  it('THROWS on a real RPC error (so close-charge routes to review, never zero-bills)', async () => {
    mockRpc({ data: null, error: { message: 'x' } });
    await expect(getCampaignBillingSummary('c1')).rejects.toThrow();
  });

  it('returns null on an empty result (nonexistent campaign — benign)', async () => {
    mockRpc({ data: null, error: null });
    await expect(getCampaignBillingSummary('c1')).resolves.toBeNull();
  });
});

describe('getCampaignCreditTotal', () => {
  type QueryResult = { data: unknown; error: unknown };
  const ok = (rows: unknown[]): QueryResult => ({ data: rows, error: null });
  const empty = ok([]);

  // Three parallel queries: campaign-scoped credits (billing_credits.eq),
  // event-level credits (billing_credits.is(null).eq), and sibling campaigns'
  // credit_applied (campaigns.eq.neq).
  function mockCredits({
    own = empty,
    eventLevel = empty,
    siblings = empty,
  }: {
    own?: QueryResult;
    eventLevel?: QueryResult;
    siblings?: QueryResult;
  }) {
    const from = vi.fn((table: string) => {
      if (table === 'campaigns') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ neq: vi.fn(async () => siblings) })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => own),
          is: vi.fn(() => ({ eq: vi.fn(async () => eventLevel) })),
        })),
      };
    });
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn(),
      from,
    } as unknown as ReturnType<typeof createAdminClient>);
    return { from };
  }

  it('sums the campaign-scoped credit amounts (regression)', async () => {
    const { from } = mockCredits({ own: ok([{ amount: 5 }, { amount: 2.5 }]) });
    await expect(getCampaignCreditTotal('c1', 'e1')).resolves.toBe(7.5);
    expect(from).toHaveBeenCalledWith('billing_credits');
    expect(from).toHaveBeenCalledWith('campaigns');
  });

  it('includes EVENT-level credits (campaign_id null) — the wiring fix', async () => {
    mockCredits({ eventLevel: ok([{ amount: 160 }]) });
    await expect(getCampaignCreditTotal('c1', 'e1')).resolves.toBe(160);
  });

  it('sums campaign-scoped and event-level credits together', async () => {
    mockCredits({
      own: ok([{ amount: 5 }]),
      eventLevel: ok([{ amount: 160 }]),
    });
    await expect(getCampaignCreditTotal('c1', 'e1')).resolves.toBe(165);
  });

  it('subtracts credit already consumed by sibling campaigns, floored at 0', async () => {
    mockCredits({
      eventLevel: ok([{ amount: 100 }]),
      siblings: ok([{ credit_applied: 30 }]),
    });
    await expect(getCampaignCreditTotal('c1', 'e1')).resolves.toBe(70);

    mockCredits({
      eventLevel: ok([{ amount: 100 }]),
      siblings: ok([{ credit_applied: 130 }]),
    });
    await expect(getCampaignCreditTotal('c1', 'e1')).resolves.toBe(0);
  });

  it('returns 0 when there are no credits', async () => {
    mockCredits({});
    await expect(getCampaignCreditTotal('c1', 'e1')).resolves.toBe(0);
  });

  it('THROWS on a credit-query error (routes close-charge to review)', async () => {
    mockCredits({ own: { data: null, error: { message: 'x' } } });
    await expect(getCampaignCreditTotal('c1', 'e1')).rejects.toThrow();
  });

  it('THROWS on a sibling-consumption query error (never silently under-subtracts)', async () => {
    mockCredits({ siblings: { data: null, error: { message: 'x' } } });
    await expect(getCampaignCreditTotal('c1', 'e1')).rejects.toThrow();
  });
});
