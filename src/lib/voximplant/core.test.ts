import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHistoryReports,
  getPhoneNumbers,
  getRules,
  getTransactionHistory,
  type GetHistoryReportsRequest,
  type GetRulesRequest,
  type VoximplantConfig,
} from './core';

// A real RSA key so signManagementJwt (createSign().sign) succeeds; fetch is
// mocked so nothing leaves the process.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const cfg: VoximplantConfig = { accountId: 1, keyId: 'k', privateKey };

// Capture the URLSearchParams body of the last mocked request.
function stubFetch(): { lastBody: () => URLSearchParams } {
  let captured: URLSearchParams = new URLSearchParams();
  vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams }) => {
    captured = init.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: [] }),
    } as unknown as Response;
  });
  return { lastBody: () => captured };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('typed wrappers protect mandatory ids', () => {
  it('getRules always sends the given application_id, even if params try to override', async () => {
    const { lastBody } = stubFetch();
    // Cast: the request type forbids application_id; this proves the runtime guard.
    await getRules(cfg, 111, { application_id: 999 } as unknown as GetRulesRequest);
    expect(lastBody().get('application_id')).toBe('111');
    expect(lastBody().get('with_scenarios')).toBe('true');
  });

  it('getHistoryReports always sends the given history_report_id', async () => {
    const { lastBody } = stubFetch();
    await getHistoryReports(cfg, 318807, {
      history_report_id: 42,
    } as unknown as GetHistoryReportsRequest);
    expect(lastBody().get('history_report_id')).toBe('318807');
  });
});

describe('getPhoneNumbers (read-only)', () => {
  it('calls the GetPhoneNumbers method and returns the typed list', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          result: [
            {
              phone_id: 7,
              phone_number: '+97233763232',
              phone_name: 'rsvp-caller',
              phone_country_code: 'IL',
              deactivated: false,
              can_be_used: true,
              application_id: 111,
              rule_id: 222,
            },
          ],
        }),
      } as unknown as Response;
    });

    const res = await getPhoneNumbers(cfg);

    expect(capturedUrl).toContain('GetPhoneNumbers');
    expect(res.total_count).toBe(1);
    expect(res.result[0].phone_number).toBe('+97233763232');
    expect(res.result[0].phone_id).toBe(7);
    expect(res.result[0].application_id).toBe(111);
    expect(res.result[0].rule_id).toBe(222);
  });

  it('returns an empty list when the account has no numbers', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ total_count: 0, result: [] }),
    } as unknown as Response));

    const res = await getPhoneNumbers(cfg);
    expect(res.total_count).toBe(0);
    expect(res.result).toEqual([]);
  });
});

describe('getTransactionHistory (read-only)', () => {
  it('sends the mandatory date range and returns the typed ledger', async () => {
    let capturedUrl = '';
    let capturedBody = new URLSearchParams();
    vi.stubGlobal(
      'fetch',
      async (url: string, init: { body: URLSearchParams }) => {
        capturedUrl = String(url);
        capturedBody = init.body;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total_count: 2,
            timezone: 'Etc/GMT',
            result: [
              {
                transaction_id: 1,
                performed_at: '2026-07-01 00:00:00',
                transaction_type: 'phone_number_charge',
                amount: -0.85,
                currency: 'USD',
                transaction_description: 'phone number rent',
              },
              {
                transaction_id: 2,
                performed_at: '2026-07-05 10:00:00',
                transaction_type: 'resource_charge',
                amount: -0.12,
                currency: 'USD',
              },
            ],
          }),
        } as unknown as Response;
      },
    );

    const res = await getTransactionHistory(cfg, {
      from_date: '2026-06-01 00:00:00',
      to_date: '2026-07-14 00:00:00',
    });

    expect(capturedUrl).toContain('GetTransactionHistory');
    expect(capturedBody.get('from_date')).toBe('2026-06-01 00:00:00');
    expect(capturedBody.get('to_date')).toBe('2026-07-14 00:00:00');
    expect(res.total_count).toBe(2);
    expect(res.result[0].transaction_type).toBe('phone_number_charge');
    expect(res.result[0].performed_at).toBe('2026-07-01 00:00:00');
    expect(res.result[0].amount).toBeCloseTo(-0.85);
  });
});
