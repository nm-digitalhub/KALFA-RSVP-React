// The one hazard this client exists to contain: GET /auth/key/ returns the API key
// itself. Every other test here guards a decision that would otherwise send an
// operator to fix the wrong thing.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { daysUntil, getAuthKey, mapSmsErrors } from './extra-client';

const KEY = 'EXTRA-KEY-SECRET';

function mockJson(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

const LIVE_SHAPE = {
  success: true,
  // The spec marks this REQUIRED in the 200 response.
  key: KEY,
  scopes: null,
  times: { created: '2025-10-27', expire: '2027-10-27' },
  user: { id: 'c2yFfPaRcT5', email_address: 'account@example.com' },
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('getAuthKey', () => {
  it('NEVER lets the api key into the result', async () => {
    mockJson(200, LIVE_SHAPE);
    const r = await getAuthKey(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.ok).toBe(true);
  });

  it('never lets the key into a failure message either', async () => {
    // A fetch rejection can echo the request, and the request carries the Bearer.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`failed: Bearer ${KEY}`); }));
    const r = await getAuthKey(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.ok === false && r.kind).toBe('unreachable');
  });

  it('reads the validity window and the account, and computes days to expiry', async () => {
    mockJson(200, LIVE_SHAPE);
    const r = await getAuthKey(KEY, new Date('2026-09-10T12:00:00Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.createdAt).toBe('2025-10-27');
    expect(r.expireAt).toBe('2027-10-27');
    expect(r.daysToExpiry).toBe(412);
    expect(r.accountEmail).toBe('account@example.com');
    // null scopes = a legacy/unscoped key that "may do everything the account may".
    expect(r.scopes).toBeNull();
  });

  it('separates a rejected key from an unreachable service', async () => {
    mockJson(401, { success: false });
    expect((await getAuthKey(KEY)).ok === false && (await getAuthKey(KEY) as { kind: string }).kind)
      .toBe('key_invalid');
    mockJson(503, {});
    const down = await getAuthKey(KEY);
    expect(down.ok === false && down.kind).toBe('unreachable');
  });

  it('refuses to read success out of a body that does not say success', async () => {
    // HTTP 200 is NOT the answer on this API — business failures use it too.
    mockJson(200, { success: false, errors: [{ code: 1010 }] });
    const r = await getAuthKey(KEY);
    expect(r.ok === false && r.kind).toBe('unexpected_response');
  });
});

describe('daysUntil', () => {
  it('is date-only arithmetic, so "expires today" is 0 all day', () => {
    // Subtracting a Y-m-d from Date.now() would floor to -1 for most of the day.
    expect(daysUntil('2026-09-10', new Date('2026-09-10T09:00:00Z'))).toBe(0);
    expect(daysUntil('2026-09-11', new Date('2026-09-10T09:00:00Z'))).toBe(1);
    expect(daysUntil('2026-09-01', new Date('2026-09-10T09:00:00Z'))).toBe(-9);
  });

  it('reads "today" in Asia/Jerusalem, not in the process timezone', () => {
    // 22:30 UTC on the 10th is already 01:30 on the 11th in Israel, so a key
    // expiring on the 11th expires TODAY there — not tomorrow. Using the server's
    // own zone would be right only by luck on a machine set to Israel time, and the
    // worker need not share a timezone with an Israeli provider's calendar dates.
    expect(daysUntil('2026-09-11', new Date('2026-09-10T22:30:00Z'))).toBe(0);
    // …while 20:30 UTC is still the 10th in Israel, so the same date is tomorrow.
    expect(daysUntil('2026-09-11', new Date('2026-09-10T20:30:00Z'))).toBe(1);
  });

  it('returns null for anything unparseable rather than a misleading number', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('soon')).toBeNull();
    expect(daysUntil('27/10/2027')).toBeNull();
  });
});

describe('mapSmsErrors', () => {
  it('maps EVERY error, not just the first', () => {
    // The spec: pre-send validation codes "may arrive several at once". Reading
    // errors[0] would report the billing problem and hide the sender problem.
    const out = mapSmsErrors([{ code: 9404 }, { code: 1215 }]);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.code)).toEqual([9404, 1215]);
  });

  it('puts the two sender faults on the sender field, and nothing else there', () => {
    expect(mapSmsErrors([{ code: 1215 }])[0].field).toBe('extra_sms_sender');
    expect(mapSmsErrors([{ code: 7521 }])[0].field).toBe('extra_sms_sender');
    expect(mapSmsErrors([{ code: 9404 }])[0].field).toBeUndefined();
    expect(mapSmsErrors([{ code: 7462 }])[0].field).toBeUndefined();
  });

  it('surfaces an unknown code with its number instead of swallowing it', () => {
    // 7404 is the spec's own catch-all whose real code hides in a description we do
    // not display, so unrecognised codes are expected, not hypothetical.
    const out = mapSmsErrors([{ code: 8888 }]);
    expect(out[0].message).toContain('8888');
  });

  it('never throws on a shape the provider did not document', () => {
    expect(mapSmsErrors(undefined)).toEqual([]);
    expect(mapSmsErrors('boom')).toEqual([]);
    expect(mapSmsErrors([{ nope: 1 }, null])).toEqual([]);
  });
});
