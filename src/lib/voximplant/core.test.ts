import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHistoryReports,
  getRules,
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
