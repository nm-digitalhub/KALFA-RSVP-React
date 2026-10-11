import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn(async () => ({ name: 'KALFA' })) }));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: vi.fn() }));
vi.mock('@/lib/email/marketing-contacts', () => ({ resendMarketingContacts: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import type { MarketingContact, MarketingContactsClient } from '@/lib/email/marketing-contacts';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

import {
  enqueueMarketingContactSync,
  recordProviderComplaint,
  recordProviderUnsubscribe,
  runMarketingContactReconcile,
  syncMarketingContact,
} from './marketing-contact-sync';

const USER = 'u-1';
const EMAIL = 'dana@example.com';

let db: FakeTableClient;
let resend: Map<string, MarketingContact>;
let contacts: MarketingContactsClient & { calls: string[] };

function fakeContacts(): MarketingContactsClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get: vi.fn(async (email: string) => resend.get(email) ?? null),
    create: vi.fn(async (email: string, unsubscribed: boolean) => {
      calls.push(`create ${email} ${unsubscribed}`);
      resend.set(email, { email, unsubscribed });
    }),
    setUnsubscribed: vi.fn(async (email: string, unsubscribed: boolean) => {
      calls.push(`set ${email} ${unsubscribed}`);
      resend.set(email, { email, unsubscribed });
    }),
  };
}

function setup(opts: { ledger?: TableRow[]; user?: TableRow | null; enabled?: boolean } = {}) {
  db = createFakeTableClient({
    marketing_consent_events: opts.ledger ?? [],
    app_settings: [{ id: true, marketing_consent_enabled: opts.enabled ?? true }],
    'auth.users':
      opts.user === null
        ? []
        : [opts.user ?? { id: USER, email: EMAIL, email_confirmed_at: '2026-10-11T08:00:00Z' }],
  });
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
  resend = new Map();
  contacts = fakeContacts();
}

const deps = () => ({ admin: db.client as never, contacts });
const grant = (at: string, email = EMAIL): TableRow => ({
  id: `g-${at}`, user_id: USER, email, action: 'grant', source: 'settings', occurred_at: at,
});
const withdraw = (at: string): TableRow => ({
  id: `w-${at}`, user_id: USER, email: EMAIL, action: 'withdraw', source: 'settings', occurred_at: at,
});

beforeEach(() => vi.clearAllMocks());

describe('syncMarketingContact', () => {
  it('granted + confirmed → a subscribed contact, email only', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    expect(await syncMarketingContact({ userId: USER }, deps())).toBe('subscribed');
    expect(contacts.calls).toEqual([`create ${EMAIL} false`]);
  });

  it('granted but the address is not confirmed → nothing at Resend', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')], user: { id: USER, email: EMAIL, email_confirmed_at: null } });
    expect(await syncMarketingContact({ userId: USER }, deps())).toBe('unchanged');
    expect(contacts.calls).toEqual([]);
  });

  it('withdrawn → the contact is unsubscribed', async () => {
    setup({ ledger: [grant('2026-10-01T00:00:00Z'), withdraw('2026-10-11T08:00:00Z')] });
    resend.set(EMAIL, { email: EMAIL, unsubscribed: false });
    expect(await syncMarketingContact({ userId: USER }, deps())).toBe('unsubscribed');
    expect(resend.get(EMAIL)?.unsubscribed).toBe(true);
  });

  it('email changed → the old address is unsubscribed and the new one subscribed', async () => {
    setup({
      ledger: [grant('2026-10-01T00:00:00Z', 'old@example.com')],
      user: { id: USER, email: 'new@example.com', email_confirmed_at: '2026-10-11T08:00:00Z' },
    });
    resend.set('old@example.com', { email: 'old@example.com', unsubscribed: false });
    await syncMarketingContact({ userId: USER }, deps());
    expect(resend.get('old@example.com')?.unsubscribed).toBe(true);
    expect(resend.get('new@example.com')?.unsubscribed).toBe(false);
  });

  it('Resend says unsubscribed and nobody just granted → never resubscribed; recorded as a withdrawal', async () => {
    setup({ ledger: [grant('2026-10-01T00:00:00Z')] });
    resend.set(EMAIL, { email: EMAIL, unsubscribed: true });
    expect(await syncMarketingContact({ userId: USER }, deps())).toBe('resend_unsubscribe_recorded');
    expect(resend.get(EMAIL)?.unsubscribed).toBe(true);
    expect(db.rows('marketing_consent_events').at(-1)).toMatchObject({ action: 'withdraw', source: 'provider_unsubscribe' });
  });

  it('a fresh grant (resubscribe) may turn an unsubscribed contact back on', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    resend.set(EMAIL, { email: EMAIL, unsubscribed: true });
    expect(await syncMarketingContact({ userId: USER, resubscribe: true }, deps())).toBe('subscribed');
    expect(resend.get(EMAIL)?.unsubscribed).toBe(false);
  });

  it('a Resend failure is thrown, so pg-boss retries', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    vi.mocked(contacts.get).mockRejectedValueOnce(new Error('resend_contacts_get_failed'));
    await expect(syncMarketingContact({ userId: USER }, deps())).rejects.toThrow();
  });

  it('reads only Auth and the ledger, never guests or contacts', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    await syncMarketingContact({ userId: USER }, deps());
    expect([...new Set(db.ops.map((o) => o.table))].sort()).toEqual(['auth.users', 'marketing_consent_events']);
  });
});

describe('enqueueMarketingContactSync', () => {
  it('sends the user id only, with a deterministic id and the retry policy', async () => {
    const send = vi.fn();
    vi.mocked(getWebJobSender).mockResolvedValue({ send } as never);
    const at = new Date('2026-10-11T08:00:30Z');
    await enqueueMarketingContactSync({ userId: USER }, at);
    await enqueueMarketingContactSync({ userId: USER }, at);
    expect(send).toHaveBeenCalledTimes(2);
    const [queue, payload, options] = send.mock.calls[0];
    expect(queue).toBe('marketing-contact-sync');
    expect(payload).toEqual({ userId: USER });
    expect(options.id).toBe(send.mock.calls[1][2].id);
    expect(options.retryLimit).toBeGreaterThan(0);
  });
});

describe('runMarketingContactReconcile', () => {
  it('does nothing while the feature is off', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')], enabled: false });
    expect(await runMarketingContactReconcile(deps())).toEqual({ synced: 0, removed: 0, failed: 0 });
    expect(contacts.calls).toEqual([]);
  });

  it('a grant whose account is gone → account_removed withdrawal and unsubscribe', async () => {
    setup({ ledger: [grant('2026-10-01T00:00:00Z')], user: null });
    resend.set(EMAIL, { email: EMAIL, unsubscribed: false });
    expect(await runMarketingContactReconcile(deps())).toMatchObject({ removed: 1 });
    expect(db.rows('marketing_consent_events').at(-1)).toMatchObject({ action: 'withdraw', source: 'account_removed' });
    expect(resend.get(EMAIL)?.unsubscribed).toBe(true);
  });

  it('a current grant is synced again', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    expect(await runMarketingContactReconcile(deps())).toMatchObject({ synced: 1 });
    expect(resend.get(EMAIL)?.unsubscribed).toBe(false);
  });
});

describe('recordProviderUnsubscribe (contact.updated)', () => {
  const event = (over: Partial<Parameters<typeof recordProviderUnsubscribe>[0]> = {}) => ({
    email: EMAIL,
    unsubscribed: true,
    updatedAt: '2026-10-11T09:00:00Z',
    eventId: 'msg_1',
    ...over,
  });

  it('an unsubscribe after the grant → a provider_unsubscribe withdrawal with the event id', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    expect(await recordProviderUnsubscribe(event())).toBe('recorded');
    expect(db.rows('marketing_consent_events').at(-1)).toMatchObject({
      action: 'withdraw',
      source: 'provider_unsubscribe',
      provider_event_id: 'msg_1',
    });
  });

  it('the same event twice → one withdrawal', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    await recordProviderUnsubscribe(event());
    expect(await recordProviderUnsubscribe(event())).toBe('not_granted');
    expect(db.rows('marketing_consent_events').filter((r) => r.action === 'withdraw')).toHaveLength(1);
  });

  it('an event older than the latest grant does not change consent', async () => {
    setup({ ledger: [grant('2026-10-11T10:00:00Z')] });
    expect(await recordProviderUnsubscribe(event())).toBe('stale');
    expect(db.rows('marketing_consent_events')).toHaveLength(1);
  });

  it('the echo of our own unsubscribe changes nothing', async () => {
    setup({ ledger: [grant('2026-10-01T00:00:00Z'), withdraw('2026-10-11T08:00:00Z')] });
    expect(await recordProviderUnsubscribe(event())).toBe('not_granted');
  });

  it('unsubscribed: false never grants', async () => {
    setup({ ledger: [withdraw('2026-10-11T08:00:00Z')] });
    expect(await recordProviderUnsubscribe(event({ unsubscribed: false }))).toBe('ignored');
    expect(db.rows('marketing_consent_events')).toHaveLength(1);
  });

  it('an address no customer consented with is ignored', async () => {
    setup({ ledger: [] });
    expect(await recordProviderUnsubscribe(event({ email: 'guest@example.com' }))).toBe('not_a_customer');
  });
});

describe('recordProviderComplaint (email.complained)', () => {
  it('a customer with a grant → a provider_complaint withdrawal and a sync', async () => {
    setup({ ledger: [grant('2026-10-11T08:00:00Z')] });
    const send = vi.fn();
    vi.mocked(getWebJobSender).mockResolvedValue({ send } as never);
    expect(await recordProviderComplaint({ email: EMAIL, eventId: 'msg_2:dana@example.com' })).toBe('recorded');
    expect(db.rows('marketing_consent_events').at(-1)).toMatchObject({ action: 'withdraw', source: 'provider_complaint' });
    expect(send).toHaveBeenCalledWith('marketing-contact-sync', { userId: USER }, expect.anything());
  });

  it('anyone else writes nothing', async () => {
    setup({ ledger: [] });
    expect(await recordProviderComplaint({ email: 'stranger@example.com', eventId: 'msg_3' })).toBe('not_a_customer');
    expect(db.rows('marketing_consent_events')).toHaveLength(0);
  });
});
