import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/data/authorized-fill', () => ({ fillAuthorizedSet: vi.fn() }));
// The switch is mocked OFF for every test: neither step may depend on it (design D2).
vi.mock('@/lib/data/reconcile-config', () => ({ isReconcileEnabled: vi.fn(() => false) }));

import { createAdminClient } from '@/lib/supabase/admin';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import { repairGuestContactLinks, topUpPackageList } from '@/lib/data/authorized-topup';

type Call = { table: string; method: string; args: unknown[] };

// A recording admin client: the guests read answers `guests`, each contacts upsert answers a new id, each guests
// update answers ok (or `updateError`).
function mockAdmin(guests: Array<{ id: string; phone: string | null }>, opts: { readError?: unknown; updateError?: unknown } = {}) {
  const calls: Call[] = [];
  let contactSeq = 0;
  const from = vi.fn((table: string) => {
    let mode: 'read' | 'upsert' | 'update' = 'read';
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'order', 'upsert', 'update', 'single']) {
      b[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        if (method === 'upsert') mode = 'upsert';
        if (method === 'update') mode = 'update';
        return b;
      });
    }
    (b as { then: unknown }).then = (f: (v: unknown) => unknown) => {
      if (mode === 'upsert') return f({ data: { id: `contact${++contactSeq}` }, error: null });
      if (mode === 'update') return f({ data: null, error: opts.updateError ?? null });
      return f({ data: opts.readError ? null : guests, error: opts.readError ?? null });
    };
    return b;
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
  return calls;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('repairGuestContactLinks', () => {
  it('reads only the unlinked guests, in order of addition, and links each valid phone to its contact', async () => {
    const calls = mockAdmin([
      { id: 'g1', phone: '0501234567' },
      { id: 'g2', phone: '050-123-4567' }, // the same number: one contact, one seat
      { id: 'g3', phone: 'not a phone' },
    ]);

    await expect(repairGuestContactLinks('e1')).resolves.toBe(2);

    expect(calls).toContainEqual({ table: 'guests', method: 'is', args: ['contact_id', null] });
    expect(calls).toContainEqual({ table: 'guests', method: 'order', args: ['seq', { ascending: true }] });
    const upserts = calls.filter((c) => c.method === 'upsert');
    expect(upserts).toEqual([
      { table: 'contacts', method: 'upsert', args: [{ event_id: 'e1', normalized_phone: '+972501234567' }, { onConflict: 'event_id,normalized_phone' }] },
    ]);
    const updates = calls.filter((c) => c.method === 'update');
    expect(updates).toEqual([
      { table: 'guests', method: 'update', args: [{ contact_id: 'contact1' }] },
      { table: 'guests', method: 'update', args: [{ contact_id: 'contact1' }] },
    ]);
  });

  it('never clears or replaces a link: every update is guarded by contact_id IS NULL', async () => {
    const calls = mockAdmin([{ id: 'g1', phone: '0501234567' }]);
    await repairGuestContactLinks('e1');
    const afterUpdate = calls.slice(calls.findIndex((c) => c.method === 'update'));
    expect(afterUpdate).toContainEqual({ table: 'guests', method: 'is', args: ['contact_id', null] });
  });

  it('nothing to link → no write at all', async () => {
    const calls = mockAdmin([{ id: 'g1', phone: null }]);
    await expect(repairGuestContactLinks('e1')).resolves.toBe(0);
    expect(calls.some((c) => c.method === 'upsert' || c.method === 'update')).toBe(false);
  });
});

describe('topUpPackageList', () => {
  it('with the switch off: repairs the links, then fills the list (actor arm_topup)', async () => {
    mockAdmin([{ id: 'g1', phone: '0501234567' }]);
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'filled', admitted: 1, size: 1, quota: 100, waiting: 0 });

    await topUpPackageList('e1', 'camp1');

    expect(fillAuthorizedSet).toHaveBeenCalledWith('e1', 'camp1', 'arm_topup');
  });

  it('a failing link repair is logged and the fill still runs', async () => {
    mockAdmin([], { readError: { message: 'down' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'no_quota' });

    await expect(topUpPackageList('e1', 'camp1')).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('[arm-topup] link repair failed (event=e1 campaign=camp1)'));
    expect(fillAuthorizedSet).toHaveBeenCalledTimes(1);
  });

  it('a failing fill is logged and never thrown, so the arm tick goes on', async () => {
    mockAdmin([]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(fillAuthorizedSet).mockRejectedValue(new Error('rpc failed'));

    await expect(topUpPackageList('e1', 'camp1')).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith('[arm-topup] fill failed (event=e1 campaign=camp1): rpc failed');
  });
});

// worker/main.ts starts pg-boss when imported, so handleArm is checked in its source: the top-up runs only for a
// campaign with a quota, and before the list is read to seed the outreach cursors.
describe('handleArm (worker/main.ts)', () => {
  const src = readFileSync(join(process.cwd(), 'worker', 'main.ts'), 'utf8');
  const body = src.slice(src.indexOf('async function handleArm('), src.indexOf('\n}\n', src.indexOf('async function handleArm(')));

  it('tops up a package campaign only, before seedOutreachState', () => {
    const topUp = body.indexOf('if (ctx.contactQuota !== null) await topUpPackageList(camp.event_id, camp.id);');
    expect(topUp).toBeGreaterThan(-1);
    expect(topUp).toBeLessThan(body.indexOf('await seedOutreachState(camp.event_id, camp.id);'));
  });
});
