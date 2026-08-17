import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExchangeConnectionConfig } from './types';

// graph-impl.ts caches its Graph SDK client in a module-level singleton
// (`cachedClient`), built once from `Client.initWithMiddleware(...)`. To swap
// in a fresh fake client per test, the mocked `initWithMiddleware` reads a
// mutable `currentClient` that each test sets BEFORE resetting the module
// registry and re-importing — so the module under test re-evaluates with a
// clean cache and picks up that test's fake on its first call.
let currentClient: unknown;

vi.mock('server-only', () => ({}));
vi.mock('@azure/identity', () => ({
  ClientCertificateCredential: class {},
}));
vi.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials', () => ({
  TokenCredentialAuthenticationProvider: class {},
}));
vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: { initWithMiddleware: () => currentClient },
}));

type FakeCall = { path: string; headers: Record<string, string> };

/**
 * Minimal stand-in for the Graph SDK's fluent request builder — only the
 * methods listAppointments/followPages actually use (`.headers()`, `.get()`).
 * Records every call's path + accumulated headers so a test can assert on
 * them, and returns queued responses in call order.
 */
function makeFakeClient(responses: ReadonlyArray<unknown>) {
  const calls: FakeCall[] = [];
  let i = 0;
  function builder(path: string) {
    let hdrs: Record<string, string> = {};
    const b = {
      headers(h: Record<string, string>) {
        hdrs = { ...hdrs, ...h };
        return b;
      },
      async get() {
        calls.push({ path, headers: { ...hdrs } });
        const res = responses[i++];
        if (res instanceof Error) throw res;
        return res;
      },
    };
    return b;
  }
  return { client: { api: (path: string) => builder(path) }, calls };
}

async function freshGraphProvider(client: unknown) {
  currentClient = client;
  vi.resetModules();
  const mod = await import('./graph-impl');
  return mod.graphProvider;
}

const cfg: ExchangeConnectionConfig = {
  mailboxEmail: 'owner@kalfa.me',
  password: '',
  authMethod: 'ntlm',
};

function graphEvent(id: string) {
  return {
    id,
    subject: `event ${id}`,
    start: { dateTime: '2026-08-20T09:00:00', timeZone: 'UTC' },
    end: { dateTime: '2026-08-20T09:15:00', timeZone: 'UTC' },
    isAllDay: false,
    showAs: 'busy',
    type: 'singleInstance',
  };
}

// Regression coverage for two live-measured (17.08) bugs in listAppointments/
// followPages that together let 553 duplicate calendar appointments pile up
// and starve real customer callback requests (`no_slot_within_horizon`):
//
//   1. Pagination followed `@odata.nextLink` via `url.pathname + url.search`,
//      which strips the host but leaves the API version segment ("/v1.0/…")
//      in the path — client.api() prepends its own version on top, so every
//      page past the first 404'd as "/v1.0/v1.0/…". Any calendarView query
//      returning more than $top=300 events failed outright.
//   2. listAppointments never sent Prefer: IdType="ImmutableId", so listed
//      ids came back in the DEFAULT (mutable) format while createAppointment
//      (which DOES send that header) stores the IMMUTABLE format —
//      reconcileCallbacksWithCalendar's `liveIds.has(storedId)` check could
//      never match, so every scheduled callback looked "gone" on the next
//      sweep and got released + re-created.
describe('graph-impl listAppointments pagination + id format', () => {
  beforeEach(() => {
    process.env.MS_GRAPH_TENANT_ID = 'tenant';
    process.env.MS_GRAPH_CLIENT_ID = 'client';
    process.env.MS_GRAPH_CERT_PATH = '/tmp/does-not-need-to-exist.pem';
  });

  afterEach(() => {
    delete process.env.MS_GRAPH_TENANT_ID;
    delete process.env.MS_GRAPH_CLIENT_ID;
    delete process.env.MS_GRAPH_CERT_PATH;
    vi.restoreAllMocks();
  });

  it('follows @odata.nextLink using the full absolute URL, not pathname+search', async () => {
    const nextLink =
      'https://graph.microsoft.com/v1.0/users/owner%40kalfa.me/calendar/calendarView' +
      '?%24select=id&%24top=300&%24skip=300';
    const page1 = { value: [graphEvent('a')], '@odata.nextLink': nextLink };
    const page2 = { value: [graphEvent('b')] };
    const { client, calls } = makeFakeClient([page1, page2]);

    const graphProvider = await freshGraphProvider(client);
    const result = await graphProvider.listAppointments(cfg, {
      start: new Date('2026-08-17T00:00:00Z'),
      end: new Date('2026-09-01T00:00:00Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both pages' items came back — pagination did not silently truncate.
    expect(result.data.map((e) => e.id)).toEqual(['a', 'b']);

    // The regression check: the second request's path is EXACTLY the
    // absolute nextLink Graph handed back — never a hand-built
    // `url.pathname + url.search`, which is what produced the doubled
    // "/v1.0/v1.0/…" path Graph rejected with 400 live.
    expect(calls).toHaveLength(2);
    expect(calls[1].path).toBe(nextLink);
  });

  it('sends Prefer: IdType="ImmutableId" on every page, matching createAppointment', async () => {
    const nextLink = 'https://graph.microsoft.com/v1.0/users/owner%40kalfa.me/calendar/calendarView?%24skip=300';
    const page1 = { value: [graphEvent('a')], '@odata.nextLink': nextLink };
    const page2 = { value: [graphEvent('b')] };
    const { client, calls } = makeFakeClient([page1, page2]);

    const graphProvider = await freshGraphProvider(client);
    await graphProvider.listAppointments(cfg, {
      start: new Date('2026-08-17T00:00:00Z'),
      end: new Date('2026-09-01T00:00:00Z'),
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers.Prefer).toBe('IdType="ImmutableId"');
    }
  });

  it('stops paging and reports provider_error when a later page truly fails', async () => {
    const nextLink = 'https://graph.microsoft.com/v1.0/users/owner%40kalfa.me/calendar/calendarView?%24skip=300';
    const page1 = { value: [graphEvent('a')], '@odata.nextLink': nextLink };
    const graphError = Object.assign(new Error('boom'), { statusCode: 503 });
    const { client } = makeFakeClient([page1, graphError]);

    const graphProvider = await freshGraphProvider(client);
    const result = await graphProvider.listAppointments(cfg, {
      start: new Date('2026-08-17T00:00:00Z'),
      end: new Date('2026-09-01T00:00:00Z'),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unreachable');
  });

  it('does not page past 1000 accumulated events even if nextLink keeps coming', async () => {
    // Two big pages already exceed the 1000 cap on their own — the loop must
    // stop after the second `get()` rather than requesting a third page.
    const nextLink1 = 'https://graph.microsoft.com/v1.0/users/owner%40kalfa.me/calendar/calendarView?%24skip=600';
    const nextLink2 = 'https://graph.microsoft.com/v1.0/users/owner%40kalfa.me/calendar/calendarView?%24skip=1200';
    const bigPage = (link: string) => ({
      value: Array.from({ length: 600 }, (_, i) => graphEvent(String(i))),
      '@odata.nextLink': link,
    });
    const { client, calls } = makeFakeClient([bigPage(nextLink1), bigPage(nextLink2)]);

    const graphProvider = await freshGraphProvider(client);
    const result = await graphProvider.listAppointments(cfg, {
      start: new Date('2026-08-17T00:00:00Z'),
      end: new Date('2026-09-01T00:00:00Z'),
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
