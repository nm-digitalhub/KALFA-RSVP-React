import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permissionMock, adminMock } = vi.hoisted(() => ({
  permissionMock: vi.fn(),
  adminMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permissionMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));

import {
  listActiveMicrosoftWorkflowConnections,
  listMicrosoftWorkflowConnectionsForAdmin,
} from './workflow-connections';

/**
 * A PostgREST builder that chains in any order and awaits to `result`.
 *
 * ⚠️ DELIBERATELY BLIND TO THE QUERY'S SHAPE, and that is a lesson paid for.
 * The previous version hard-coded `select → eq → eq → contains → order → order`
 * AND asserted `contains('scopes', ['Mail.Send'])` — so the mock and the
 * assertion together PINNED THE BUG: a Postgres array match on a literal the
 * provider never answers with. Fixing the query broke five tests that had
 * nothing to say about behaviour.
 *
 * A mock should encode what the caller means — which table, which columns,
 * which filters — never the order the builder was called in.
 */
function harness(result: { data: unknown[] | null; error: unknown }) {
  const select = vi.fn();
  const eq = vi.fn();
  // Captured for ONE assertion only — that no scope filter runs in SQL. That is
  // a contract, not a call order: the whole bug was a Postgres array match on a
  // literal the provider never answers with, and a chain-agnostic mock cannot
  // simulate array containment, so re-adding the filter would otherwise pass.
  // Caught by fault injection.
  const contains = vi.fn();

  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => void) => resolve(result);
        }
        if (prop === 'select') return (...args: unknown[]) => (select(...args), proxy);
        if (prop === 'eq') return (...args: unknown[]) => (eq(...args), proxy);
        if (prop === 'contains') return (...args: unknown[]) => (contains(...args), proxy);
        return () => proxy;
      },
    },
  );

  const from = vi.fn(() => proxy);
  adminMock.mockReturnValue({ from });

  return { from, select, eqProvider: eq, eqStatus: eq, contains };
}

beforeEach(() => {
  vi.clearAllMocks();
  permissionMock.mockResolvedValue({ id: 'staff-1' });
});

describe('listActiveMicrosoftWorkflowConnections', () => {
  it('reads only active Microsoft connections that grant Mail.Send', async () => {
    const h = harness({
      data: [{ id: 'connection-1', label: 'תיבת מכירות', scopes: ['Mail.Send'] }],
      error: null,
    });

    await expect(listActiveMicrosoftWorkflowConnections()).resolves.toEqual([
      { value: 'connection-1', label: 'תיבת מכירות' },
    ]);
    expect(permissionMock).toHaveBeenCalledWith('integrations.read');
    expect(h.from).toHaveBeenCalledWith('integration_connections');
    // ⚠️ `scopes` IS SELECTED NOW, and the Mail.Send filter is gone from SQL.
    // It ran as `contains('scopes', ['Mail.Send'])` — a literal the provider
    // never answers with — and this line used to assert it, which is how a
    // green suite shipped a picker that hid working connections.
    expect(h.select).toHaveBeenCalledWith('id, label, scopes');
    expect(h.eqProvider).toHaveBeenCalledWith('provider', 'microsoft');
    expect(h.eqStatus).toHaveBeenCalledWith('status', 'active');
    // ⚠️ AND NOT IN SQL. `contains('scopes', ['Mail.Send'])` is the bug itself:
    // Postgres array containment against a spelling Microsoft never returns,
    // which hid working connections from the picker entirely.
    expect(h.contains).not.toHaveBeenCalled();
  });

  it('never returns secrets, provider metadata, labels as values, or full rows', async () => {
    harness({
      data: [
        {
          id: 'connection-1',
          label: 'תיבת מכירות',
          // Qualified on purpose: the leak check must run on a row that
          // actually SURVIVES the filter, or it proves nothing.
          scopes: ['https://graph.microsoft.com/mail.send'],
          vault_secret_id: 'must-not-leak',
          metadata: { tenant: 'must-not-leak' },
        },
      ],
      error: null,
    });

    const result = await listActiveMicrosoftWorkflowConnections();
    expect(result).toEqual([{ value: 'connection-1', label: 'תיבת מכירות' }]);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(result[0]?.value).not.toBe(result[0]?.label);
    // ⚠️ `scopes` is SELECTED now, so the promise in this module's header —
    // that scopes never cross the RSC boundary — needs asserting, not assuming.
    expect(JSON.stringify(result)).not.toContain('graph.microsoft.com');
  });

  it('⚠️ a row with NO scopes is excluded, not a crash', async () => {
    // In SQL a null array simply failed to match. In JS it reaches `.map` and
    // would take the whole picker down — a worse failure than the bug this
    // filter replaced.
    harness({ data: [{ id: 'c1', label: 'ריק', scopes: null }], error: null });

    await expect(listActiveMicrosoftWorkflowConnections()).resolves.toEqual([]);
  });

  it('⚠️ the PICKER lists a connection whose grant arrived fully qualified', async () => {
    // The third site of the same bug, and the worst of the three: this used to
    // be `.contains('scopes', ['Mail.Send'])` — a Postgres array match on a
    // hard-coded literal — so a connection Microsoft reported in its own
    // spelling matched nothing and NEVER APPEARED IN THE EDITOR'S PICKER. The
    // author saw an empty list with a working connection in the database.
    adminHarness({
      data: [
        {
          id: '11111111-2222-4333-8444-555555555555',
          label: 'תיבת מכירות',
          scopes: ['https://graph.microsoft.com/mail.send', 'openid'],
        },
      ],
      error: null,
    });

    await expect(listActiveMicrosoftWorkflowConnections()).resolves.toEqual([
      { label: 'תיבת מכירות', value: '11111111-2222-4333-8444-555555555555' },
    ]);
  });

  it('⚠️ and still hides one that never granted mail.send', async () => {
    // Filtering moved from SQL into JS, so the exclusion has to be re-proven
    // here — a filter that lists everything would pass the case above.
    adminHarness({
      data: [
        { id: '11111111-2222-4333-8444-555555555555', label: 'ללא דואר', scopes: ['openid'] },
        { id: '22222222-3333-4444-8555-666666666666', label: 'משאב זר', scopes: ['api://x/Mail.Send'] },
      ],
      error: null,
    });

    await expect(listActiveMicrosoftWorkflowConnections()).resolves.toEqual([]);
  });

  it('throws instead of presenting a database failure as an empty list', async () => {
    harness({ data: null, error: { message: 'boom' } });

    await expect(listActiveMicrosoftWorkflowConnections()).rejects.toThrow(
      'טעינת חיבורי Microsoft הפעילים נכשלה',
    );
  });
});

/**
 * A PostgREST builder that is chainable in any order and awaits to `result`.
 *
 * ⚠️ DELIBERATELY BLIND TO THE QUERY'S SHAPE. The previous version hard-coded
 * `from().select().eq().order()`, so removing one filter — the `.contains(
 * 'scopes', ['Mail.Send'])` that was the bug — broke five passing tests for a
 * reason that had nothing to do with behaviour. A mock that encodes the shape
 * of a query makes that query expensive to fix, which is the opposite of what
 * a test should do. This one asserts only what the callers actually care
 * about: which table, which columns, which filters.
 */
function adminHarness(result: { data: unknown[] | null; error: unknown }) {
  const select = vi.fn();
  const eqProvider = vi.fn();

  const builder: Record<string, unknown> = {};
  const proxy = new Proxy(builder, {
    get(_target, prop) {
      // Awaiting the builder resolves to the fixture, wherever the chain ends.
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(result);
      }
      if (prop === 'select') return (...args: unknown[]) => (select(...args), proxy);
      if (prop === 'eq') return (...args: unknown[]) => (eqProvider(...args), proxy);
      return () => proxy;
    },
  });

  const from = vi.fn(() => proxy);
  adminMock.mockReturnValue({ from });

  return { from, select, eqProvider };
}

describe('listMicrosoftWorkflowConnectionsForAdmin', () => {
  it('requires integrations.read and reads Microsoft rows only', async () => {
    const h = adminHarness({ data: [], error: null });

    await listMicrosoftWorkflowConnectionsForAdmin();

    expect(permissionMock).toHaveBeenCalledWith('integrations.read');
    expect(h.from).toHaveBeenCalledWith('integration_connections');
    expect(h.select).toHaveBeenCalledWith('label, status, created_at, updated_at, scopes');
    expect(h.eqProvider).toHaveBeenCalledWith('provider', 'microsoft');
  });

  it('returns only safe status metadata and reduces Mail.Send to a boolean', async () => {
    adminHarness({
      data: [
        {
          id: 'must-not-leak',
          label: 'תיבת מכירות',
          status: 'active',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['openid', 'Mail.Send'],
          vault_secret_id: 'vault-must-not-leak',
          metadata: { tenant: 'metadata-must-not-leak' },
          refresh_token: 'token-must-not-leak',
        },
      ],
      error: null,
    });

    const result = await listMicrosoftWorkflowConnectionsForAdmin();

    expect(result).toEqual([
      {
        label: 'תיבת מכירות',
        status: 'active',
        createdAt: '2026-09-16T10:00:00.000Z',
        updatedAt: '2026-09-16T11:00:00.000Z',
        mailSendReady: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|Mail\.Send|openid/);
  });

  it('⚠️ marks a connection ready when the grant arrived FULLY QUALIFIED', async () => {
    // The form Microsoft's protocol reference actually echoes
    // (`https://graph.microsoft.com/mail.send`), against a capability spelled
    // `Mail.Send`. Before scopes.ts this read `row.scopes.includes('Mail.Send')`
    // on a hard-coded literal, so a perfectly good connection showed as not
    // ready in the picker — and the runtime refused the send outright.
    adminHarness({
      data: [
        {
          label: 'תיבת מכירות',
          status: 'active',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['https://graph.microsoft.com/mail.send', 'openid'],
        },
      ],
      error: null,
    });

    await expect(listMicrosoftWorkflowConnectionsForAdmin()).resolves.toEqual([
      expect.objectContaining({ mailSendReady: true }),
    ]);
  });

  it('does not mark disabled or insufficient-scope connections as ready', async () => {
    adminHarness({
      data: [
        {
          label: 'חיבור כבוי',
          status: 'disabled',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['Mail.Send'],
        },
        {
          label: 'ללא הרשאת דואר',
          status: 'active',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['openid'],
        },
      ],
      error: null,
    });

    await expect(listMicrosoftWorkflowConnectionsForAdmin()).resolves.toEqual([
      expect.objectContaining({ label: 'חיבור כבוי', mailSendReady: false }),
      expect.objectContaining({ label: 'ללא הרשאת דואר', mailSendReady: false }),
    ]);
  });

  it('⚠️ a mail.send granted by ANOTHER resource is not ready', async () => {
    // Normalising must not become "strip any prefix": a scope issued for someone
    // else's API names a different permission, whatever it is called.
    adminHarness({
      data: [
        {
          label: 'משאב זר',
          status: 'active',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['api://someone-else/Mail.Send'],
        },
      ],
      error: null,
    });

    await expect(listMicrosoftWorkflowConnectionsForAdmin()).resolves.toEqual([
      expect.objectContaining({ label: 'משאב זר', mailSendReady: false }),
    ]);
  });
});
