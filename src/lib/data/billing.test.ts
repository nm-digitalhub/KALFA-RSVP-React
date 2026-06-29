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
  function mockCredits(result: { data: unknown; error: unknown }) {
    const eq = vi.fn(async () => result);
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn(),
      from,
    } as unknown as ReturnType<typeof createAdminClient>);
    return { from, select, eq };
  }

  it('sums the campaign-scoped credit amounts', async () => {
    const { from, select } = mockCredits({
      data: [{ amount: 5 }, { amount: 2.5 }],
      error: null,
    });
    await expect(getCampaignCreditTotal('c1')).resolves.toBe(7.5);
    expect(from).toHaveBeenCalledWith('billing_credits');
    expect(select).toHaveBeenCalledWith('amount');
  });

  it('returns 0 when there are no credits', async () => {
    mockCredits({ data: [], error: null });
    await expect(getCampaignCreditTotal('c1')).resolves.toBe(0);
  });

  it('THROWS on a real error (routes close-charge to review)', async () => {
    mockCredits({ data: null, error: { message: 'x' } });
    await expect(getCampaignCreditTotal('c1')).rejects.toThrow();
  });
});
