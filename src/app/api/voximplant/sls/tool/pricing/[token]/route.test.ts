import { beforeEach, describe, expect, it, vi } from 'vitest';

// `get_pricing` returns the fixed-price package catalogue — the packages the
// purchase flow sells (listPackageOffers) — and recognises a package by its
// price and quota, never by a per-reached rate. The token guard and the
// catalogue reader are mocked: this file pins the route's own contract.

vi.mock('server-only', () => ({}));

vi.mock('@/lib/voximplant/agent-tool-guard', () => ({
  guardSalesToolRequest: vi.fn(),
}));
vi.mock('@/lib/data/campaigns', () => ({
  listPackageOffers: vi.fn(),
}));

import { POST } from './route';
import { listPackageOffers, type PackageOffer } from '@/lib/data/campaigns';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';

const TOKEN = '0123456789abcdef0123456789abcdef';

const OFFER_100: PackageOffer = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'חבילה קטנה',
  price: 100,
  contact_quota: 100,
  description: null,
  includes: ['הודעות וואטסאפ', 'שיחות AI'],
  channels: ['whatsapp', 'call'],
  outreach_schedule: [],
};
const OFFER_200: PackageOffer = {
  ...OFFER_100,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'חבילה גדולה',
  price: 200,
  contact_quota: 200,
  includes: [],
};

function call() {
  const req = new Request(`https://beta.kalfa.me/api/voximplant/sls/tool/pricing/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return POST(req, { params: Promise.resolve({ token: TOKEN }) });
}

beforeEach(() => {
  vi.mocked(guardSalesToolRequest).mockReset();
  vi.mocked(listPackageOffers).mockReset();
  vi.mocked(guardSalesToolRequest).mockResolvedValue({ ok: true, attemptId: 'attempt-1', raw: '{}' });
});

describe('sls tool pricing POST', () => {
  it('returns every sellable package with its fixed price and quota', async () => {
    vi.mocked(listPackageOffers).mockResolvedValue([OFFER_100, OFFER_200]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      available: true,
      packages: [
        {
          package_name: 'חבילה קטנה',
          price: 100,
          contact_quota: 100,
          channels: ['whatsapp', 'call'],
          includes: ['הודעות וואטסאפ', 'שיחות AI'],
        },
        {
          package_name: 'חבילה גדולה',
          price: 200,
          contact_quota: 200,
          channels: ['whatsapp', 'call'],
          includes: [],
        },
      ],
    });
  });

  it('carries no per-reached field the agent could quote', async () => {
    vi.mocked(listPackageOffers).mockResolvedValue([OFFER_100]);

    const text = JSON.stringify(await (await call()).json());

    for (const retired of ['price_per_reached', 'base_price', 'included_reached', 'price_with_vat']) {
      expect(text).not.toContain(retired);
    }
  });

  it('answers "not available" when there is no sellable package', async () => {
    vi.mocked(listPackageOffers).mockResolvedValue([]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });

  it('answers "not available" without leaking the error when the catalogue cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(listPackageOffers).mockRejectedValue(new Error('connection to db-host-7 refused'));

    const res = await call();
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ available: false });
    expect(body).not.toContain('db-host-7');
    // The log carries the fixed message only, never the thrown error.
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('db-host-7');
    log.mockRestore();
  });

  it('refuses a request the token guard rejects, without reading the catalogue', async () => {
    vi.mocked(guardSalesToolRequest).mockResolvedValue({ ok: false, status: 404 });

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
    expect(listPackageOffers).not.toHaveBeenCalled();
  });
});
