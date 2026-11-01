import { afterEach, describe, expect, it, vi } from 'vitest';

// contacts.ts begins with `import 'server-only'` (and pulls in server-only deps);
// that throws outside Next's RSC context. deriveContacts is tested in derive-contacts.test.ts.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// linkGuestContact verifies access server-side; stub gates as no-ops so the
// unit tests exercise only the contact upsert/link logic.
vi.mock('@/lib/data/events', () => ({
  requireEventAccess: vi.fn(),
}));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  linkGuestContact,
  listSendableContacts,
  pruneOrphanContact,
} from '@/lib/data/contacts';

// Env stubs must not leak into the next test: vi.stubEnv is reverted by
// vi.unstubAllEnvs(), which restores the value captured before the first stub.
afterEach(() => vi.unstubAllEnvs());

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
  // contact_interactions/campaign_authorized_contacts) resolves to a DIFFERENT
  // count, and contacts.delete is observable. (The shared createMockSupabase
  // returns one count for all awaits.)
  //
  // campaign_authorized_contacts is queried ONLY when
  // RECONCILE_AUTHORIZED_SET_ENABLED is on (P0-1/A6 guard). It is stubbed
  // regardless: without a count builder for that table the fall-through returned
  // the delete builder, which has no `.select`, so the suite failed with
  // "admin.from(...).select is not a function" whenever the flag was on.
  // Defaulting it to 0 keeps every existing case meaning what it says under
  // BOTH flag states.
  //
  // The flag itself is NEVER read from the ambient environment. Vitest does not
  // load .env files into process.env unless the config opts in with Vite's
  // loadEnv (VERIFIED 2026-08-26 against the Vitest docs and by running the file
  // with and without the variable exported). vitest.config.mts deliberately does
  // NOT opt in, so a suite cannot depend on one machine's .env.local. Each test
  // below therefore declares the flag state it is testing with vi.stubEnv —
  // which is also why both states are covered instead of only the deployed one.
  function mockPrune(counts: {
    guests: number;
    billed: number;
    interactions: number;
    authorizedSet?: number;
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
      // The set read returns the member rows; the campaigns read counts how many of those have a package quota.
      if (table === 'campaign_authorized_contacts')
        return mkResult({ data: Array.from({ length: counts.authorizedSet ?? 0 }, () => ({ campaign_id: 'camp1' })) });
      if (table === 'campaigns') return mkCount(counts.packageCampaigns ?? 0);
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

  it('KEEPS a member of a frozen authorized set (P0-1/A6 guard, flag ON)', async () => {
    // The whole point of the reconcile guard: hard-deleting a contact that sits
    // in a campaign's frozen authorized set would let the FK's ON DELETE evict
    // it silently — the root of the repoint/orphan mis-charge bug.
    vi.stubEnv('RECONCILE_AUTHORIZED_SET_ENABLED', 'true');
    const { del } = mockPrune({
      guests: 0,
      billed: 0,
      interactions: 0,
      authorizedSet: 1,
    });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(false);
    expect(del.delete).not.toHaveBeenCalled();
  });

  // The mirror case. isReconcileEnabled() is a kill-switch, so the OFF state is
  // real production behaviour (it is the documented default), not a hypothetical
  // — with the switch off the set-member guard is inert by design and the orphan
  // is pruned. Asserting only the ON state would let a change that silently
  // disabled the switch pass every test.
  it('PRUNES the same set member when the reconcile flag is OFF and its campaign has no package quota', async () => {
    vi.stubEnv('RECONCILE_AUTHORIZED_SET_ENABLED', 'false');
    const { del } = mockPrune({
      guests: 0,
      billed: 0,
      interactions: 0,
      authorizedSet: 1,
      packageCampaigns: 0,
    });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(true);
    expect(del.delete).toHaveBeenCalled();
  });

  // package-outreach-admission-safety D3: with the flag OFF, a member of a campaign with a package quota is kept.
  it('KEEPS a member of a package campaign even when the reconcile flag is OFF', async () => {
    vi.stubEnv('RECONCILE_AUTHORIZED_SET_ENABLED', 'false');
    const { del } = mockPrune({
      guests: 0,
      billed: 0,
      interactions: 0,
      authorizedSet: 1,
      packageCampaigns: 1,
    });
    const deleted = await pruneOrphanContact('e1', 'c1');
    expect(deleted).toBe(false);
    expect(del.delete).not.toHaveBeenCalled();
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

describe('listSendableContacts', () => {
  it('returns the non-removed contacts for the event — no consent record is required', async () => {
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
    expect(builder.not).not.toHaveBeenCalled();
    expect(r).toEqual([{ id: 'c1', normalized_phone: '+972501234567' }]);
  });

  it('binds to the campaign authorized SET (INNER JOIN) when a campaignId is given', async () => {
    const { client, builder } = createMockSupabase<
      Array<{ id: string; normalized_phone: string }>
    >({
      data: [{ id: 'c1', normalized_phone: '+972501234567' }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const r = await listSendableContacts('e1', 'camp1');

    // INNER JOIN the frozen set → reached ⊆ authorized.
    expect(builder.select).toHaveBeenCalledWith(
      'id, normalized_phone, campaign_authorized_contacts!inner(campaign_id)',
    );
    expect(builder.eq).toHaveBeenCalledWith(
      'campaign_authorized_contacts.campaign_id',
      'camp1',
    );
    // Still gated on event scope + not-removed.
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(builder.eq).toHaveBeenCalledWith('removal_requested', false);
    expect(builder.not).not.toHaveBeenCalled();
    // The embedded join column is stripped from the returned shape.
    expect(r).toEqual([{ id: 'c1', normalized_phone: '+972501234567' }]);
  });
});
