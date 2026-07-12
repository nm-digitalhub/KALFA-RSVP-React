import { afterEach, describe, expect, it, vi } from 'vitest';

// contacts.ts starts with `import 'server-only'`; stub it and the gates so the
// unit tests exercise only the reconcile helper + the prune guard.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
// The P0-1 kill-switch — mocked so each test drives the flag explicitly.
vi.mock('@/lib/data/reconcile-config', () => ({ isReconcileEnabled: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { isReconcileEnabled } from '@/lib/data/reconcile-config';
import {
  reconcileCampaignSetForContact,
  pruneOrphanContact,
} from '@/lib/data/contacts';

const enable = (on: boolean) => vi.mocked(isReconcileEnabled).mockReturnValue(on);

afterEach(() => vi.restoreAllMocks());

describe('reconcileCampaignSetForContact (kill-switch gated)', () => {
  it('is a no-op when the flag is OFF — never touches the DB', async () => {
    enable(false);
    await reconcileCampaignSetForContact('e1', 'add', 'ct1');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('flag ON + an operational campaign → calls the reconcile RPC with the op args', async () => {
    enable(true);
    const { client } = createMockSupabase<{ id: string }[]>({
      data: [{ id: 'camp1' }],
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'added', error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await reconcileCampaignSetForContact('e1', 'repoint', 'newC', 'oldC');

    expect(client.rpc).toHaveBeenCalledWith(
      'reconcile_authorized_set',
      expect.objectContaining({
        p_event: 'e1',
        p_campaign: 'camp1',
        p_op: 'repoint',
        p_contact: 'newC',
        p_prev_contact: 'oldC',
      }),
    );
  });

  it('flag ON but NO operational campaign → resolves campaigns, never calls the RPC', async () => {
    enable(true);
    const { client } = createMockSupabase<{ id: string }[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await reconcileCampaignSetForContact('e1', 'add', 'ct1');

    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('surfaces ceiling_full / not_eligible via a warning (best-effort, never throws)', async () => {
    enable(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = createMockSupabase<{ id: string }[]>({
      data: [{ id: 'camp1' }],
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'ceiling_full', error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(
      reconcileCampaignSetForContact('e1', 'add', 'ct1'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('an RPC error is logged, not thrown (the guest mutation is already committed)', async () => {
    enable(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = createMockSupabase<{ id: string }[]>({
      data: [{ id: 'camp1' }],
      error: null,
    });
    client.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(
      reconcileCampaignSetForContact('e1', 'delete', 'ct1'),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });
});

describe('pruneOrphanContact — authorized-set member guard (kill-switch gated)', () => {
  // Per-table count builders so the guests/billed/interactions/set queries each
  // resolve to a distinct count and contacts.delete is observable.
  function mockPrune(counts: {
    guests: number;
    billed: number;
    interactions: number;
    setMember: number;
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
      if (table === 'campaign_authorized_contacts') return mkCount(counts.setMember);
      return del; // contacts
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from,
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof createAdminClient>);
    return { from, del };
  }

  it('flag ON + a set member → KEEPS it (no delete → no silent FK eviction)', async () => {
    enable(true);
    const { del } = mockPrune({ guests: 0, billed: 0, interactions: 0, setMember: 1 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(false);
    expect(del.delete).not.toHaveBeenCalled();
  });

  it('flag ON + not a set member → deletes the fresh orphan', async () => {
    enable(true);
    const { from, del } = mockPrune({ guests: 0, billed: 0, interactions: 0, setMember: 0 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(true);
    expect(from).toHaveBeenCalledWith('campaign_authorized_contacts');
    expect(del.delete).toHaveBeenCalled();
  });

  it('flag OFF → the set guard is skipped entirely (legacy behavior, deletes)', async () => {
    enable(false);
    const { from, del } = mockPrune({ guests: 0, billed: 0, interactions: 0, setMember: 5 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(true);
    expect(from).not.toHaveBeenCalledWith('campaign_authorized_contacts');
    expect(del.delete).toHaveBeenCalled();
  });
});
