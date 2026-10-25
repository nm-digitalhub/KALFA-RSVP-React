import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createServerClient } from '@supabase/ssr';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';

import {
  type AuthUser,
  type Fixture,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

// Finding 4 — what each layer really enforces for packages and webhook_inbox.
//
// Users are REAL local Supabase Auth users (GoTrue admin createUser + password
// sign-in through the local API); no JWT is signed by hand. Platform staff roles are
// fixture rows in platform_staff on the SEEDED roles:
//   auditor       — staff, holds neither manage_billing nor view_webhooks
//   billing_clerk — staff, manage_billing, NOT view_webhooks
//   ops_engineer  — staff, view_webhooks, NOT manage_billing
// Layers:
//   PostgREST/RLS/GRANT — each user's own PostgREST client (anon key + user JWT).
//   DAL / CASL / Server Action — the real modules, with the user's session in the
//     cookie jar @supabase/ssr reads (next/headers.cookies is the only substitution,
//     plus next/cache.revalidatePath — framework boundaries, no authorization logic).
// Nothing printed contains a token, key or payload; payload access is asserted by
// comparing a synthetic marker, never by logging the row.

const jar = vi.hoisted(() => ({ current: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...jar.current].map(([name, value]) => ({ name, value })),
    get: (name: string) => (jar.current.has(name) ? { name, value: jar.current.get(name)! } : undefined),
    has: (name: string) => jar.current.has(name),
    set: (name: string, value: string) => {
      jar.current.set(name, value);
    },
  }),
  headers: async () => new Headers({ 'x-forwarded-for': '127.0.0.1' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;
const MARKER = 'IT synthetic payload marker';

type Outcome = 'ok' | 'grant-denied' | 'rls-denied' | 'rls-filtered' | 'fn-refused' | `error:${string}`;
function outcome(res: { data: unknown; error: PostgrestError | null }): Outcome {
  if (res.error) {
    const m = res.error.message ?? '';
    if (res.error.code === '42501' && /permission denied for (table|function|schema)/i.test(m)) return 'grant-denied';
    if (res.error.code === '42501' && /row-level security/i.test(m)) return 'rls-denied';
    if (res.error.code === '42501') return 'fn-refused';
    return `error:${res.error.code}`;
  }
  return Array.isArray(res.data) && res.data.length === 0 ? 'rls-filtered' : 'ok';
}

const matrix: Record<string, Record<string, string>> = {};
const record = (op: string, who: string, o: string) => ((matrix[op] ??= {})[who] = o);

describe.skipIf(!RUN)('finding 4: permissions across CASL / DAL / Server Action / PostgREST / RLS / GRANT', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let anon: SupabaseClient;
  let service: SupabaseClient;
  let users: Record<'regular' | 'auditor' | 'billing' | 'ops', AuthUser>;
  let f: Fixture;
  let inboxId: string;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ENV!.anonKey ?? '');
    pool = newPool(ENV!, 'permissions', 6);
    scope = new FixtureScope(pool);
    const opts = { auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false } } as const;
    anon = createClient(ENV!.supabaseUrl, ENV!.anonKey!, opts);
    service = createClient(ENV!.supabaseUrl, ENV!.serviceKey, opts);
    users = {
      regular: await scope.createAuthUser(ENV!),
      auditor: await scope.createAuthUser(ENV!, { staffRole: 'auditor' }),
      billing: await scope.createAuthUser(ENV!, { staffRole: 'billing_clerk' }),
      ops: await scope.createAuthUser(ENV!, { staffRole: 'ops_engineer' }),
    };
    f = await scope.create();
    const row = await scope.insertInbox(f, {
      messageId: `wamid.${f.tag}.perm`,
      payload: { type: 'text', from: '972500000000', text: { body: MARKER } },
    });
    inboxId = row.id as string;
  });
  afterAll(async () => {
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
      console.log(`[finding-4 matrix]\n${JSON.stringify(matrix, null, 1)}`);
    }
  });

  const pkg = async (active: boolean) => {
    const id = randomUUID();
    scope.ownRow({ table: 'public.packages', id });
    await scope.track(
      pool.query(`insert into public.packages (id, name, tier, price_with_vat, active) values ($1, $2, 'it', 1, $3)`, [
        id,
        `${f.tag} pkg`,
        active,
      ]),
    );
    return id;
  };
  const clientOf = (who: string): SupabaseClient =>
    who === 'anon' ? anon : who === 'service' ? service : users[who as keyof typeof users].client;
  const WHO = ['anon', 'regular', 'auditor', 'billing', 'ops', 'service'] as const;

  // ═══ GRANT + RLS through PostgREST ═════════════════════════════════════════════
  // Since staff-tables-permission-rls stage S4 (20261025155204): one policy per operation on manage_billing, the key
  // PLATFORM_ACTIONS.Package gives every action, and the public read `packages_public_read` (active rows) kept apart.
  // A session without the key is refused by its mechanism: anon has no write grant; an authenticated session holds
  // the grant (billing_clerk needs it), so its INSERT fails the policy's check and its UPDATE or DELETE matches no row.
  describe('packages through PostgREST', () => {
    it('the public read (packages_public_read, not a Package action): an ACTIVE package reads for anon and every user', async () => {
      const id = await pkg(true);
      for (const who of WHO) {
        const o = outcome(await clientOf(who).from('packages').select('id').eq('id', id));
        record('packages SELECT active', who, o);
        expect(o, who).toBe('ok');
      }
    });

    it('SELECT an INACTIVE package (admin data) — hidden from every session without manage_billing, auditor and ops included', async () => {
      const id = await pkg(false);
      const got: Record<string, Outcome> = {};
      for (const who of WHO) record('packages SELECT inactive', who, (got[who] = outcome(await clientOf(who).from('packages').select('id').eq('id', id))));
      expect(got).toEqual({ anon: 'rls-filtered', regular: 'rls-filtered', auditor: 'rls-filtered', billing: 'ok', ops: 'rls-filtered', service: 'ok' });
    });

    it('INSERT — anon: GRANT; regular, auditor and ops (no manage_billing): RLS; billing_clerk succeeds', async () => {
      const got: Record<string, Outcome> = {};
      for (const who of WHO) {
        const id = randomUUID();
        scope.ownRow({ table: 'public.packages', id });
        const o = outcome(
          await clientOf(who).from('packages').insert({ id, name: `${f.tag} by ${who}`, tier: 'it', price_with_vat: 1, active: false }).select('id'),
        );
        record('packages INSERT', who, (got[who] = o));
      }
      expect(got).toEqual({ anon: 'grant-denied', regular: 'rls-denied', auditor: 'rls-denied', billing: 'ok', ops: 'rls-denied', service: 'ok' });
    });

    it('UPDATE price — regular, auditor and ops (no manage_billing) change no row; billing_clerk changes it', async () => {
      const got: Record<string, Outcome> = {};
      for (const who of WHO) {
        const id = await pkg(true);
        const o = outcome(await clientOf(who).from('packages').update({ price_with_vat: 999 }).eq('id', id).select('id'));
        record('packages UPDATE', who, (got[who] = o));
        const p = (await pool.query(`select price_with_vat::int p from public.packages where id = $1`, [id])).rows[0].p;
        expect(p === 999, `${who} price changed`).toBe(o === 'ok');
      }
      expect(got).toEqual({ anon: 'grant-denied', regular: 'rls-filtered', auditor: 'rls-filtered', billing: 'ok', ops: 'rls-filtered', service: 'ok' });
    });

    it('DELETE — regular, auditor and ops (no manage_billing) delete no row; billing_clerk deletes it', async () => {
      const got: Record<string, Outcome> = {};
      for (const who of WHO) {
        const id = await pkg(false);
        const o = outcome(await clientOf(who).from('packages').delete().eq('id', id).select('id'));
        record('packages DELETE', who, (got[who] = o));
        const n = (await pool.query(`select count(*)::int n from public.packages where id = $1`, [id])).rows[0].n;
        expect(n, `${who} row count`).toBe(o === 'ok' ? 0 : 1);
      }
      expect(got).toEqual({ anon: 'grant-denied', regular: 'rls-filtered', auditor: 'rls-filtered', billing: 'ok', ops: 'rls-filtered', service: 'ok' });
    });
  });

  // Closed by staff-tables-permission-rls stage S1 (20261025141452): no client role holds any privilege, so every
  // session, staff or not, is refused by the GRANT before RLS runs; only the service role reaches the table.
  describe('webhook_inbox through PostgREST (closed: service role only)', () => {
    const SESSIONS = ['anon', 'regular', 'auditor', 'billing', 'ops'] as const;

    it('SELECT the payload — every session is refused by the GRANT; only the service role reads it', async () => {
      const got: Record<string, Outcome> = {};
      const sawPayload: Record<string, boolean> = {};
      for (const who of WHO) {
        const res = await clientOf(who).from('webhook_inbox').select('id, payload').eq('id', inboxId);
        record('webhook_inbox SELECT payload', who, (got[who] = outcome(res)));
        const rows = (res.data ?? []) as Array<{ payload: { text?: { body?: string } } }>;
        sawPayload[who] = rows.some((r) => r.payload?.text?.body === MARKER);
      }
      expect(got).toEqual({ anon: 'grant-denied', regular: 'grant-denied', auditor: 'grant-denied', billing: 'grant-denied', ops: 'grant-denied', service: 'ok' });
      expect(sawPayload).toEqual({ anon: false, regular: false, auditor: false, billing: false, ops: false, service: true });
    });

    it('UPDATE (mark processed) — refused for every session, the row stays unprocessed', async () => {
      const row = await scope.insertInbox(f, { messageId: `wamid.${f.tag}.upd`, payload: { type: 'text', text: { body: MARKER } } });
      const got: Record<string, Outcome> = {};
      for (const who of SESSIONS) {
        const o = outcome(await clientOf(who).from('webhook_inbox').update({ processed_at: new Date().toISOString() }).eq('id', row.id as string).select('id'));
        record('webhook_inbox UPDATE processed_at', who, (got[who] = o));
      }
      expect(got).toEqual({ anon: 'grant-denied', regular: 'grant-denied', auditor: 'grant-denied', billing: 'grant-denied', ops: 'grant-denied' });
      expect((await pool.query(`select processed_at is null p from public.webhook_inbox where id = $1`, [row.id])).rows[0].p).toBe(true);
    });

    it('INSERT a forged inbound event — refused for every session, nothing reaches the worker queue', async () => {
      const got: Record<string, Outcome> = {};
      for (const who of SESSIONS) {
        const o = outcome(
          await clientOf(who)
            .from('webhook_inbox')
            .insert({ dedupe_key: `${f.tag}:forged-${who}`, event_kind: 'message', message_id: `wamid.${f.tag}.forged-${who}`, payload: { type: 'text', text: { body: MARKER } } })
            .select('id'),
        );
        record('webhook_inbox INSERT', who, (got[who] = o));
      }
      expect(got).toEqual({ anon: 'grant-denied', regular: 'grant-denied', auditor: 'grant-denied', billing: 'grant-denied', ops: 'grant-denied' });
      const forged = await pool.query(`select count(*)::int n from public.webhook_inbox where dedupe_key like $1`, [`${f.tag}:forged-%`]);
      expect(forged.rows[0].n).toBe(0);
    });

    it('DELETE — refused for every session, the row is still there', async () => {
      const row = await scope.insertInbox(f, { messageId: `wamid.${f.tag}.del`, payload: { type: 'text', text: { body: MARKER } } });
      const got: Record<string, Outcome> = {};
      for (const who of SESSIONS) {
        record('webhook_inbox DELETE', who, (got[who] = outcome(await clientOf(who).from('webhook_inbox').delete().eq('id', row.id as string).select('id'))));
      }
      expect(got).toEqual({ anon: 'grant-denied', regular: 'grant-denied', auditor: 'grant-denied', billing: 'grant-denied', ops: 'grant-denied' });
      expect((await pool.query(`select count(*)::int n from public.webhook_inbox where id = $1`, [row.id])).rows[0].n).toBe(1);
    });
  });

  describe('RPC EXECUTE (GRANT) and in-function gates', () => {
    it('service-only RPCs are not executable by anon/authenticated/staff (GRANT)', async () => {
      const calls: Array<[string, Record<string, unknown>]> = [
        ['claim_webhook_events', { _limit: 1 }],
        ['try_record_billed_result', { p_event: f.eventId, p_campaign: f.campaignId, p_contact: f.contactId, p_channel: 'whatsapp', p_attempt: 'x', p_evidence: 'x', p_provider_ref: 'x' }],
        ['submit_rsvp', { _token: f.rsvpToken, _status: 'declined', _adults: 0, _kids: 0, _meal: '', _note: '' }],
      ];
      for (const [fn, args] of calls) {
        for (const who of ['anon', 'regular', 'auditor', 'ops'] as const) {
          const o = outcome(await clientOf(who).rpc(fn, args));
          record(`rpc ${fn}`, who, o);
          expect(o, `${fn} as ${who}`).toBe('grant-denied');
        }
      }
      // nothing was billed / answered by the attempts
      const n = await pool.query(
        `select (select count(*)::int from public.billed_results where event_id = $1) b,
                (select count(*)::int from public.rsvp_responses where event_id = $1) r`,
        [f.eventId],
      );
      expect(n.rows[0]).toEqual({ b: 0, r: 0 });
    });

    it('admin_reschedule_event (SECURITY DEFINER, EXECUTE to authenticated) refuses inside the function without manage_billing', async () => {
      for (const who of ['regular', 'auditor', 'ops'] as const) {
        const o = outcome(await clientOf(who).rpc('admin_reschedule_event', { _event_id: f.eventId, _event_date: new Date().toISOString() }));
        record('rpc admin_reschedule_event', who, o);
        expect(o, who).toBe('fn-refused');
      }
    });

    it('has_platform_permission — the DB truth the DAL and CASL are built on', async () => {
      const truth: Record<string, Record<string, boolean | string>> = {};
      for (const who of ['regular', 'auditor', 'billing', 'ops'] as const) {
        truth[who] = {};
        for (const key of ['manage_billing', 'view_webhooks']) {
          const r = await users[who].client.rpc('has_platform_permission', { _key: key });
          truth[who][key] = r.error ? `error:${r.error.code}` : (r.data as boolean);
        }
      }
      expect(truth).toEqual({
        regular: { manage_billing: false, view_webhooks: false },
        auditor: { manage_billing: false, view_webhooks: false },
        billing: { manage_billing: true, view_webhooks: false },
        ops: { manage_billing: false, view_webhooks: true },
      });
      record('rpc has_platform_permission(anon)', 'anon', outcome(await anon.rpc('has_platform_permission', { _key: 'manage_billing' })));
    });
  });

  // ═══ DAL / CASL / Server Action, as the same users (real session cookies) ═════
  describe('DAL, CASL and Server Actions as the same users', () => {
    const asUser = async (u: AuthUser | null) => {
      const next = new Map<string, string>();
      if (u) {
        const ssr = createServerClient(ENV!.supabaseUrl, ENV!.anonKey!, {
          cookies: {
            getAll: () => [...next].map(([name, value]) => ({ name, value })),
            setAll: (cs) => cs.forEach((c) => next.set(c.name, c.value)),
          },
        });
        const { error } = await ssr.auth.setSession({ access_token: u.session.access_token, refresh_token: u.session.refresh_token });
        expect(error).toBeNull();
      }
      jar.current = next;
    };
    const redirectOf = async (p: Promise<unknown>): Promise<string> => {
      try {
        await p;
        return 'allowed';
      } catch (e) {
        const d = (e as { digest?: string }).digest ?? '';
        if (d.startsWith('NEXT_REDIRECT')) return `redirect:${d.split(';')[2]}`;
        throw e;
      }
    };

    it('the session really switches users (React cache does not leak across calls outside RSC)', async () => {
      const dal = await import('@/lib/auth/dal');
      await asUser(users.auditor);
      expect((await dal.getUser())?.id).toBe(users.auditor.id);
      await asUser(users.ops);
      expect((await dal.getUser())?.id).toBe(users.ops.id);
    });

    it('CASL and the DAL agree with has_platform_permission for every Package action', async () => {
      const { getPlatformAbility } = await import('@/lib/auth/platform-ability');
      const dal = await import('@/lib/auth/dal');
      const got: Record<string, unknown> = {};
      for (const who of ['regular', 'auditor', 'billing', 'ops'] as const) {
        await asUser(users[who]);
        const ability = await getPlatformAbility();
        got[who] = {
          read: ability.can('read', 'Package'),
          update: ability.can('update', 'Package'),
          delete: ability.can('delete', 'Package'),
          dalManageBilling: await dal.hasPlatformPermission('manage_billing'),
          dalViewWebhooks: await dal.hasPlatformPermission('view_webhooks'),
        };
        for (const a of ['read', 'update', 'delete']) record(`CASL ${a} Package`, who, String((got[who] as Record<string, boolean>)[a]));
        record('DAL view_webhooks', who, String((got[who] as Record<string, boolean>).dalViewWebhooks));
      }
      const yes = { read: true, update: true, delete: true, dalManageBilling: true, dalViewWebhooks: false };
      const no = { read: false, update: false, delete: false, dalManageBilling: false, dalViewWebhooks: false };
      expect(got).toEqual({ regular: no, auditor: no, billing: yes, ops: { ...no, dalViewWebhooks: true } });
    });

    it('DAL gates: listPackages / getWebhookInboxItem refuse exactly where CASL says no', async () => {
      const { listPackages } = await import('@/lib/data/admin/packages');
      const { getWebhookInboxItem } = await import('@/lib/data/admin/webhook-inbox');
      const got: Record<string, Record<string, string>> = {};
      for (const who of ['regular', 'auditor', 'billing', 'ops'] as const) {
        await asUser(users[who]);
        got[who] = { listPackages: await redirectOf(listPackages()), webhookItem: await redirectOf(getWebhookInboxItem(inboxId)) };
        record('DAL listPackages', who, got[who].listPackages);
        record('DAL getWebhookInboxItem', who, got[who].webhookItem);
      }
      await asUser(null);
      got.anon = { listPackages: await redirectOf(listPackages()), webhookItem: await redirectOf(getWebhookInboxItem(inboxId)) };
      expect(got).toEqual({
        regular: { listPackages: 'redirect:/access-denied', webhookItem: 'redirect:/access-denied' },
        auditor: { listPackages: 'redirect:/access-denied', webhookItem: 'redirect:/access-denied' },
        billing: { listPackages: 'allowed', webhookItem: 'redirect:/access-denied' },
        ops: { listPackages: 'redirect:/access-denied', webhookItem: 'allowed' },
        anon: { listPackages: 'redirect:/auth/login', webhookItem: 'redirect:/auth/login' },
      });
    });

    it('the Server Action and PostgREST both refuse the auditor deleting a package (finding closed by stage S4)', async () => {
      const { deletePackageAction } = await import('@/app/(admin)/admin/packages/actions');
      const id = await pkg(false);
      await asUser(users.auditor);
      const viaAction = await redirectOf(deletePackageAction(id, {} as never, new FormData()));
      record('ServerAction deletePackageAction', 'auditor', viaAction);
      expect(viaAction).toBe('redirect:/access-denied');
      expect((await pool.query(`select count(*)::int n from public.packages where id = $1`, [id])).rows[0].n).toBe(1);
      const direct = outcome(await users.auditor.client.from('packages').delete().eq('id', id).select('id'));
      record('PostgREST packages DELETE', 'auditor', direct);
      expect(direct).toBe('rls-filtered');
      expect((await pool.query(`select count(*)::int n from public.packages where id = $1`, [id])).rows[0].n).toBe(1);
    });

    it('control: the Server Action lets billing_clerk delete (manage_billing)', async () => {
      const { deletePackageAction } = await import('@/app/(admin)/admin/packages/actions');
      const id = await pkg(false);
      await asUser(users.billing);
      const r = await redirectOf(deletePackageAction(id, {} as never, new FormData()));
      record('ServerAction deletePackageAction', 'billing', r);
      expect(r).toBe('redirect:/admin/packages'); // success path redirects to the list
      expect((await pool.query(`select count(*)::int n from public.packages where id = $1`, [id])).rows[0].n).toBe(0);
    });
  });
});
