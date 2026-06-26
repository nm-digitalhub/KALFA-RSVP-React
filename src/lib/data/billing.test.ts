import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/interactions', () => ({ setContactOpStatus: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { setContactOpStatus } from '@/lib/data/interactions';
import { recordReached, getCampaignBillingSummary } from '@/lib/data/billing';

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

  it('returns null on error', async () => {
    mockRpc({ data: null, error: { message: 'x' } });
    await expect(getCampaignBillingSummary('c1')).resolves.toBeNull();
  });
});
