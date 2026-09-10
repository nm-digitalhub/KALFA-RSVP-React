import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { clientMock, configuredMock, mailboxMock } = vi.hoisted(() => ({
  clientMock: vi.fn(),
  configuredMock: vi.fn(),
  mailboxMock: vi.fn(),
}));

vi.mock('./graph-client', () => ({
  graphClient: clientMock,
  graphConfigured: configuredMock,
  primaryMailbox: mailboxMock,
}));

import { checkMicrosoftHealth } from './health';

const NOW = new Date('2026-09-10T20:00:00Z');

// A tiny Graph SDK double: .api(path) returns a chainable whose .get() resolves to
// whatever the path was registered with. Chain order does not matter, which mirrors
// the real builder.
function graph(routes: Record<string, unknown | Error>) {
  const api = vi.fn((path: string) => {
    const chain = {
      select: () => chain,
      filter: () => chain,
      get: async () => {
        const hit = Object.entries(routes).find(([p]) => path.startsWith(p));
        if (!hit) throw Object.assign(new Error('not mocked'), { statusCode: 404 });
        if (hit[1] instanceof Error) throw hit[1];
        return hit[1];
      },
    };
    return chain;
  });
  clientMock.mockReturnValue({ api } as never);
  return api;
}

const ORG = {
  value: [
    {
      displayName: 'KALFA',
      verifiedDomains: [{ name: 'kalfa.me' }, { name: 'kalfa.onmicrosoft.com' }],
    },
  ],
};

const APP = {
  value: [
    {
      keyCredentials: [
        { displayName: 'CN=KALFA Calendar Service', endDateTime: '2031-08-14T18:00:38Z' },
      ],
      passwordCredentials: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  configuredMock.mockReturnValue(true);
  mailboxMock.mockReturnValue('netanel.kalfa@kalfa.me');
});

describe('checkMicrosoftHealth', () => {
  it('says not_configured without calling Graph at all', async () => {
    configuredMock.mockReturnValue(false);
    const api = graph({});
    const health = await checkMicrosoftHealth(NOW);
    expect(health).toEqual({
      ok: false,
      kind: 'not_configured',
      message: 'זהות האפליקציה מול Microsoft אינה מוגדרת',
    });
    expect(api).not.toHaveBeenCalled();
  });

  it('reads the tenant, the mailbox and the certificate FROM MICROSOFT', async () => {
    // Not from exchange_connections: that table's org-wide reader is owner-gated and
    // its ungated reader returns only the caller's own rows.
    graph({
      '/organization': ORG,
      '/users/': { displayName: 'Netanel' },
      '/applications': APP,
    });

    const health = await checkMicrosoftHealth(NOW);
    expect(health.ok).toBe(true);
    if (!health.ok) return;

    expect(health.organization).toBe('KALFA');
    expect(health.verifiedDomains).toEqual(['kalfa.me', 'kalfa.onmicrosoft.com']);
    expect(health.mailbox).toBe('netanel.kalfa@kalfa.me');
    expect(health.mailboxResolves).toBe(true);
    expect(health.certName).toBe('CN=KALFA Calendar Service');
    expect(health.certExpiresAt).toBe('2031-08-14T18:00:38Z');
    expect(health.certDaysRemaining).toBeGreaterThan(1700);
    expect(health.clientSecretCount).toBe(0);
  });

  it('picks the LAST-expiring credential, not the first one listed', async () => {
    // During a rotation two certificates overlap. The older one is not the deadline.
    graph({
      '/organization': ORG,
      '/users/': {},
      '/applications': {
        value: [
          {
            keyCredentials: [
              { displayName: 'old', endDateTime: '2026-10-01T00:00:00Z' },
              { displayName: 'new', endDateTime: '2031-08-14T18:00:38Z' },
            ],
            passwordCredentials: [],
          },
        ],
      },
    });
    const health = await checkMicrosoftHealth(NOW);
    expect(health.ok && health.certName).toBe('new');
  });

  it('a mailbox that no longer resolves does NOT fail the whole check', async () => {
    // The identity still authenticates; only the reads against that mailbox stop.
    // Reporting auth_failed here would send an admin to look at the certificate.
    graph({
      '/organization': ORG,
      '/users/': Object.assign(new Error('not found'), { statusCode: 404 }),
      '/applications': APP,
    });
    const health = await checkMicrosoftHealth(NOW);
    expect(health.ok).toBe(true);
    expect(health.ok && health.mailboxResolves).toBe(false);
  });

  it('leaves the certificate fields NULL when Application.Read.All is not granted', async () => {
    // "We could not read the expiry" is a different fact from "it expires never",
    // and a tenant without that consent still gets a working card.
    graph({
      '/organization': ORG,
      '/users/': {},
      '/applications': Object.assign(new Error('forbidden'), { statusCode: 403 }),
    });
    const health = await checkMicrosoftHealth(NOW);
    expect(health.ok).toBe(true);
    if (!health.ok) return;
    expect(health.certExpiresAt).toBeNull();
    expect(health.certDaysRemaining).toBeNull();
    expect(health.clientSecretCount).toBeNull();
  });

  it('maps a rejected identity to auth_failed, and a transport fault to unreachable', async () => {
    graph({ '/organization': Object.assign(new Error('nope'), { statusCode: 401 }) });
    expect(await checkMicrosoftHealth(NOW)).toMatchObject({ ok: false, kind: 'auth_failed' });

    graph({ '/organization': Object.assign(new Error('boom'), { statusCode: 503 }) });
    expect(await checkMicrosoftHealth(NOW)).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('an unconfigured mailbox is not an auth problem', async () => {
    mailboxMock.mockImplementation(() => {
      throw new Error('graph_mailbox_missing');
    });
    graph({ '/organization': ORG, '/applications': APP });
    const health = await checkMicrosoftHealth(NOW);
    expect(health.ok).toBe(true);
    if (!health.ok) return;
    expect(health.mailbox).toBeNull();
    expect(health.mailboxResolves).toBe(false);
  });

  it('never renders a raw Graph body in a failure message', async () => {
    const leaky = Object.assign(new Error('token abc123 rejected for tenant xyz'), {
      statusCode: 401,
      body: 'secret',
    });
    graph({ '/organization': leaky });
    const health = await checkMicrosoftHealth(NOW);
    expect(health.ok).toBe(false);
    if (health.ok) return;
    expect(health.message).not.toContain('abc123');
    expect(health.message).not.toContain('secret');
  });
});
