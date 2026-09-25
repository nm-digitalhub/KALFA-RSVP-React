import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn().mockResolvedValue({ id: 'user-1' }) }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/data/payments', () => ({ getSumitServerConfig: vi.fn().mockResolvedValue({ companyId: 1, apiKey: 'k' }) }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn().mockResolvedValue('https://kalfa.me') }));

const sumit = vi.hoisted(() => ({
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/sumit/crm-triggers', async (orig) => ({
  ...(await orig<typeof import('@/lib/sumit/crm-triggers')>()),
  subscribeSumitTrigger: sumit.subscribe,
  unsubscribeSumitTrigger: sumit.unsubscribe,
}));

// A minimal admin client: one workflow row, a list of connection rows, the two RPCs.
type Conn = { id: string; metadata: Record<string, unknown>; status: string; secret: string };
const db = vi.hoisted(() => ({
  workflow: null as null | { is_active: boolean; definition: unknown },
  conns: [] as Conn[],
  written: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === 'workflows') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.workflow, error: null }) }) }) };
      }
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq(col: string, val: unknown) {
          filters[col] = val;
          return q;
        },
        then(resolve: (v: unknown) => void) {
          const rows = db.conns.filter(
            (c) => c.status === filters.status && c.metadata.workflowId === filters['metadata->>workflowId'],
          );
          resolve({ data: rows.map((c) => ({ id: c.id, metadata: structuredClone(c.metadata) })), error: null });
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              const c = db.conns.find((x) => x.id === id)!;
              if (patch.metadata) c.metadata = patch.metadata as Record<string, unknown>;
              if (patch.status) c.status = patch.status as string;
              return { error: null };
            },
          };
        },
      };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === 'integrations_read_credential') {
        return { data: db.conns.find((c) => c.id === args.p_connection_id && c.status === 'active')?.secret ?? null, error: null };
      }
      db.written.push(args);
      const id = `conn-${db.conns.length + 1}`;
      db.conns.push({ id, metadata: args.p_metadata as Record<string, unknown>, status: 'active', secret: args.p_secret as string });
      return { data: id, error: null };
    },
  }),
}));

import { hashWebhookToken } from '@/lib/workflow/webhook-token';

import { registerSumitTrigger, retireSumitTriggers, syncSumitTriggers } from './sumit-trigger-subscriptions';

const WF = '0b2c6e1a-4c3d-4e5f-8a9b-1c2d3e4f5a6b';
const TOKEN = 'abcDEF123_-token';
const URL_OK = `https://kalfa.me/api/workflows/hook/${TOKEN}`;

async function diagram(props: Record<string, unknown>) {
  return {
    nodes: [
      {
        id: 'sumit-1',
        position: { x: 0, y: 0 },
        data: { type: 'trigger.sumit_card', properties: { tokenHash: await hashWebhookToken(TOKEN), ...props } },
      },
    ],
    edges: [],
  };
}
const CHOICE = { folderId: '1076735289', viewId: '1076735405', changeType: 'Update' };

beforeEach(() => {
  db.workflow = null;
  db.conns = [];
  db.written = [];
  sumit.subscribe.mockClear();
  sumit.unsubscribe.mockClear();
});

describe('registerSumitTrigger — the URL from the browser is not trusted', () => {
  it('refuses another host, a query string, and a path that is not the hook', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    for (const url of [
      `https://evil.example/api/workflows/hook/${TOKEN}`,
      `${URL_OK}?x=1`,
      `https://kalfa.me/api/other/${TOKEN}`,
    ]) {
      await expect(registerSumitTrigger(WF, 'sumit-1', url)).resolves.toMatchObject({ ok: false });
    }
    expect(sumit.subscribe).not.toHaveBeenCalled();
    expect(db.written).toHaveLength(0);
  });

  it('refuses an address whose hash is not the SAVED one (not saved yet)', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    const res = await registerSumitTrigger(WF, 'sumit-1', 'https://kalfa.me/api/workflows/hook/other-token');
    expect(res).toEqual({ ok: false, message: expect.stringContaining('עוד לא נשמרה') });
    expect(db.written).toHaveLength(0);
  });

  it('refuses without a folder and view', async () => {
    db.workflow = { is_active: true, definition: await diagram({}) };
    await expect(registerSumitTrigger(WF, 'sumit-1', URL_OK)).resolves.toMatchObject({ ok: false });
  });

  it('active workflow: stores the URL in Vault and subscribes with the SAVED choice', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    await expect(registerSumitTrigger(WF, 'sumit-1', URL_OK)).resolves.toMatchObject({ ok: true });
    expect(db.written[0]).toMatchObject({ p_provider: 'sumit', p_credential_kind: 'trigger_url', p_secret: URL_OK, p_created_by: 'user-1' });
    expect(sumit.subscribe).toHaveBeenCalledWith(expect.anything(), { url: URL_OK, folderId: '1076735289', viewId: '1076735405', triggerType: 'Update' });
    expect(db.conns[0].metadata.subscribed).toEqual(CHOICE);
  });

  it('inactive workflow: stores it, subscribes only when armed', async () => {
    db.workflow = { is_active: false, definition: await diagram(CHOICE) };
    await expect(registerSumitTrigger(WF, 'sumit-1', URL_OK)).resolves.toMatchObject({ ok: true });
    expect(sumit.subscribe).not.toHaveBeenCalled();
    db.workflow.is_active = true;
    await expect(syncSumitTriggers(WF)).resolves.toEqual([]);
    expect(sumit.subscribe).toHaveBeenCalledTimes(1);
  });

  it('a second registration for the node takes the old address out of SUMIT first', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    await registerSumitTrigger(WF, 'sumit-1', URL_OK);
    await registerSumitTrigger(WF, 'sumit-1', URL_OK);
    expect(sumit.unsubscribe).toHaveBeenCalledWith(expect.anything(), URL_OK);
    expect(db.conns.map((c) => c.status)).toEqual(['revoked', 'active']);
  });
});

describe('syncSumitTriggers — SUMIT follows the saved diagram and the arm switch', () => {
  it('disarming unsubscribes; nothing to do twice', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    await registerSumitTrigger(WF, 'sumit-1', URL_OK);
    db.workflow.is_active = false;
    await syncSumitTriggers(WF);
    expect(sumit.unsubscribe).toHaveBeenCalledTimes(1);
    await syncSumitTriggers(WF);
    expect(sumit.unsubscribe).toHaveBeenCalledTimes(1);
    expect(db.conns[0].metadata.subscribed).toBeNull();
  });

  it('a changed view on an active workflow re-registers', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    await registerSumitTrigger(WF, 'sumit-1', URL_OK);
    db.workflow.definition = await diagram({ ...CHOICE, viewId: '999' });
    await syncSumitTriggers(WF);
    expect(sumit.unsubscribe).toHaveBeenCalledTimes(1);
    expect(sumit.subscribe).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ viewId: '999' }));
  });

  it('a deleted node is taken out of SUMIT and its row retired', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    await registerSumitTrigger(WF, 'sumit-1', URL_OK);
    db.workflow.definition = { nodes: [], edges: [] };
    await syncSumitTriggers(WF);
    expect(sumit.unsubscribe).toHaveBeenCalledTimes(1);
    expect(db.conns[0].status).toBe('revoked');
  });

  it('a SUMIT failure is reported, not thrown, and retried next time', async () => {
    db.workflow = { is_active: false, definition: await diagram(CHOICE) };
    await registerSumitTrigger(WF, 'sumit-1', URL_OK);
    db.workflow.is_active = true;
    const { SumitTriggerError } = await import('@/lib/sumit/crm-triggers');
    sumit.subscribe.mockRejectedValueOnce(new SumitTriggerError('מודול טריגרים לא מותקן'));
    await expect(syncSumitTriggers(WF)).resolves.toEqual(['רישום הטריגר ב-SUMIT: מודול טריגרים לא מותקן']);
    await expect(syncSumitTriggers(WF)).resolves.toEqual([]);
    expect(sumit.subscribe).toHaveBeenCalledTimes(2);
  });

  it('retire before delete unsubscribes and revokes', async () => {
    db.workflow = { is_active: true, definition: await diagram(CHOICE) };
    await registerSumitTrigger(WF, 'sumit-1', URL_OK);
    await expect(retireSumitTriggers(WF)).resolves.toEqual([]);
    expect(sumit.unsubscribe).toHaveBeenCalledWith(expect.anything(), URL_OK);
    expect(db.conns[0].status).toBe('revoked');
  });
});
