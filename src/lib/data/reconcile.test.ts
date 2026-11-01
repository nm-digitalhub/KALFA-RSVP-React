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
  it('an add is a no-op when the flag is OFF — never touches the DB (the worker top-up admits it)', async () => {
    enable(false);
    await reconcileCampaignSetForContact('e1', 'add', 'ct1');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  // package-outreach-admission-safety D3: a delete or repoint reaches a campaign with a package quota whatever the
  // switch says, so the list drops the contact with an audit row and the freed seat goes to the next guest.
  it.each(['delete', 'repoint'] as const)('flag OFF + a package campaign → a %s still calls the reconcile RPC', async (op) => {
    enable(false);
    const { client } = createMockSupabase<{ id: string; contact_quota: number | null }[]>({
      data: [{ id: 'camp1', contact_quota: 100 }],
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'removed', error: null });
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    await reconcileCampaignSetForContact('e1', op, 'ct1', op === 'repoint' ? 'old1' : undefined);

    expect(client.rpc).toHaveBeenCalledWith(
      'reconcile_authorized_set',
      expect.objectContaining({ p_event: 'e1', p_campaign: 'camp1', p_op: op, p_contact: 'ct1' }),
    );
  });

  it('flag OFF + a campaign without a quota → today’s behavior: no RPC for a delete', async () => {
    enable(false);
    const { client } = createMockSupabase<{ id: string; contact_quota: number | null }[]>({
      data: [{ id: 'camp1', contact_quota: null }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    await reconcileCampaignSetForContact('e1', 'delete', 'ct1');

    expect(client.rpc).not.toHaveBeenCalled();
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

  it('surfaces not_eligible via a warning (best-effort, never throws)', async () => {
    enable(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = createMockSupabase<{ id: string }[]>({
      data: [{ id: 'camp1' }],
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'not_eligible', error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(
      reconcileCampaignSetForContact('e1', 'add', 'ct1'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('surfaces quota_full via a warning too — a waiting guest is never silent (best-effort, never throws)', async () => {
    enable(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = createMockSupabase<{ id: string }[]>({
      data: [{ id: 'camp1' }],
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'quota_full', error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(
      reconcileCampaignSetForContact('e1', 'add', 'ct1'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quota_full'));
  });

  it('a normal verdict (added) logs nothing', async () => {
    enable(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = createMockSupabase<{ id: string }[]>({
      data: [{ id: 'camp1' }],
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'added', error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await reconcileCampaignSetForContact('e1', 'add', 'ct1');
    expect(warn).not.toHaveBeenCalled();
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
  // Per-table builders so the guests/billed/interactions queries each resolve to a distinct count, the set read to
  // its member rows, the campaigns read to how many of those campaigns have a package quota, and contacts.delete is
  // observable.
  function mockPrune(counts: {
    guests: number;
    billed: number;
    interactions: number;
    setMember: number;
    packageCampaigns?: number;
  }) {
    const mkResult = (result: Record<string, unknown>) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not', 'delete']) b[m] = vi.fn(() => b);
      (b as { then: unknown }).then = (f: (v: unknown) => unknown) => f({ data: null, error: null, ...result });
      return b;
    };
    const mkCount = (count: number) => mkResult({ count });
    const del: Record<string, unknown> = {};
    for (const m of ['delete', 'eq']) del[m] = vi.fn(() => del);
    (del as { then: unknown }).then = (f: (v: unknown) => unknown) =>
      f({ data: null, error: null });
    const from = vi.fn((table: string) => {
      if (table === 'guests') return mkCount(counts.guests);
      if (table === 'billed_results') return mkCount(counts.billed);
      if (table === 'contact_interactions') return mkCount(counts.interactions);
      if (table === 'campaign_authorized_contacts')
        return mkResult({ data: Array.from({ length: counts.setMember }, (_, i) => ({ campaign_id: `camp${i + 1}` })) });
      if (table === 'campaigns') return mkCount(counts.packageCampaigns ?? 0);
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

  it('flag OFF + a member of campaigns without a quota → today’s behavior: deletes', async () => {
    enable(false);
    const { del } = mockPrune({ guests: 0, billed: 0, interactions: 0, setMember: 2, packageCampaigns: 0 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(true);
    expect(del.delete).toHaveBeenCalled();
  });

  // package-outreach-admission-safety D3: a package list never loses a contact through the cascade, switch or not.
  it('flag OFF + a member of a package campaign → KEEPS it', async () => {
    enable(false);
    const { from, del } = mockPrune({ guests: 0, billed: 0, interactions: 0, setMember: 1, packageCampaigns: 1 });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(false);
    expect(from).toHaveBeenCalledWith('campaigns');
    expect(del.delete).not.toHaveBeenCalled();
  });

  it('a set read that fails KEEPS the contact (an unproven membership is never deleted)', async () => {
    enable(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const del: Record<string, unknown> = {};
    for (const m of ['delete', 'eq']) del[m] = vi.fn(() => del);
    const mk = (result: Record<string, unknown>) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) b[m] = vi.fn(() => b);
      (b as { then: unknown }).then = (f: (v: unknown) => unknown) => f({ data: null, error: null, ...result });
      return b;
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'campaign_authorized_contacts' ? mk({ error: { message: 'down' } }) : table === 'contacts' ? del : mk({ count: 0 }),
      ),
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof createAdminClient>);

    await expect(pruneOrphanContact('e1', 'c1')).resolves.toBe(false);
    expect(del.delete).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('event=e1'));
  });
});
