import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/company', () => ({
  getCompanyLegal: vi.fn(async () => ({ name: 'נתנאל מבורך קלפה - KALFA RSVP' })),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { CONSENT_WORDING_VERSION } from '@/lib/marketing/consent-wording';
import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

import { currentConsent, isMarketingConsentEnabled, recordConsent } from './marketing-consent';

const USER = '0e9cba45-65a6-4df0-9f02-39e56428a981';
const EMAIL = 'dana@example.com';

let db: FakeTableClient;

function setup(rows: TableRow[] = [], settings: TableRow[] = [{ id: true, marketing_consent_enabled: true }]) {
  db = createFakeTableClient(
    { marketing_consent_events: rows, app_settings: settings },
    {},
    { uniqueIndexes: [{ table: 'marketing_consent_events', columns: ['provider_event_id'] }] },
  );
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
}

const row = (action: string, at: string, extra: TableRow = {}): TableRow => ({
  id: `${action}-${at}`,
  user_id: USER,
  email: EMAIL,
  action,
  source: 'settings',
  occurred_at: at,
  provider_event_id: null,
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe('isMarketingConsentEnabled', () => {
  it('is on only for an explicit true', async () => {
    setup([], [{ id: true, marketing_consent_enabled: true }]);
    expect(await isMarketingConsentEnabled()).toBe(true);
    setup([], [{ id: true, marketing_consent_enabled: false }]);
    expect(await isMarketingConsentEnabled()).toBe(false);
    setup([], []);
    expect(await isMarketingConsentEnabled()).toBe(false);
  });

  it('a read error reads as off', async () => {
    setup();
    db.fail('app_settings', '57014');
    expect(await isMarketingConsentEnabled()).toBe(false);
  });
});

describe('currentConsent', () => {
  it('is the latest row', async () => {
    setup([row('grant', '2026-10-01T00:00:00Z'), row('withdraw', '2026-10-05T00:00:00Z')]);
    expect(await currentConsent(USER)).toBe('withdrawn');
  });

  it('is none with no rows', async () => {
    setup();
    expect(await currentConsent(USER)).toBe('none');
  });
});

describe('recordConsent', () => {
  it('a grant records the server wording and version, never a caller value', async () => {
    setup();
    const result = await recordConsent({ userId: USER, email: EMAIL, action: 'grant', source: 'signup', ip: '203.0.113.7' });
    expect(result).toBe('recorded');
    const [written] = db.rows('marketing_consent_events');
    expect(written).toMatchObject({ action: 'grant', source: 'signup', ip: '203.0.113.7', wording_version: CONSENT_WORDING_VERSION });
    expect(written.wording).toContain('נתנאל מבורך קלפה - KALFA RSVP');
  });

  it('a withdrawal records no wording', async () => {
    setup([row('grant', '2026-10-01T00:00:00Z')]);
    expect(await recordConsent({ userId: USER, email: EMAIL, action: 'withdraw', source: 'settings' })).toBe('recorded');
    expect(db.rows('marketing_consent_events').at(-1)).toMatchObject({ action: 'withdraw', wording: null, wording_version: null });
  });

  it('no change, no row', async () => {
    setup([row('grant', '2026-10-01T00:00:00Z')]);
    expect(await recordConsent({ userId: USER, email: EMAIL, action: 'grant', source: 'settings' })).toBe('unchanged');
    setup();
    expect(await recordConsent({ userId: USER, email: EMAIL, action: 'withdraw', source: 'settings' })).toBe('unchanged');
    expect(db.rows('marketing_consent_events')).toHaveLength(0);
  });

  it('a provider event already recorded is a duplicate, not an error', async () => {
    setup([row('grant', '2026-10-01T00:00:00Z'), row('withdraw', '2026-10-02T00:00:00Z', { provider_event_id: 'msg_1' }), row('grant', '2026-10-03T00:00:00Z')]);
    const result = await recordConsent({
      userId: USER,
      email: EMAIL,
      action: 'withdraw',
      source: 'provider_unsubscribe',
      providerEventId: 'msg_1',
    });
    expect(result).toBe('duplicate');
  });

  it('a write failure throws', async () => {
    setup();
    db.fail('marketing_consent_events', '57014', 'insert');
    await expect(recordConsent({ userId: USER, email: EMAIL, action: 'grant', source: 'signup' })).rejects.toThrow();
  });

  it('touches only the ledger and app_settings, never guests or contacts', async () => {
    setup();
    await recordConsent({ userId: USER, email: EMAIL, action: 'grant', source: 'signup' });
    const tables = new Set(db.ops.map((o) => o.table));
    expect([...tables].sort()).toEqual(['marketing_consent_events']);
  });
});
