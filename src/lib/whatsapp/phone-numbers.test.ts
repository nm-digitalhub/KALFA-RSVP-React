import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GRAPH_API_VERSION } from './graph-version';
import {
  listWabaPhoneNumbers,
  WABA_PHONE_FIELDS_CORE,
  WABA_PHONE_FIELDS_FULL,
} from './phone-numbers';

vi.mock('server-only', () => ({}));

const CREDS = { wabaId: '990921550130385', accessToken: 'EAA-SECRET-TOKEN-VALUE' };

const NUMBER = {
  id: '1018741517998430',
  display_phone_number: '+972 33 301505',
  verified_name: 'KALFA',
  status: 'CONNECTED',
  code_verification_status: 'EXPIRED',
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listWabaPhoneNumbers', () => {
  it('asks the pinned Graph version for the full field list', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [NUMBER] }));
    const result = await listWabaPhoneNumbers(CREDS);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain(`/${GRAPH_API_VERSION}/`);
    expect(url).toContain(encodeURIComponent(CREDS.wabaId));
    expect(url).toContain(`fields=${WABA_PHONE_FIELDS_FULL}`);
    expect(result).toEqual({ numbers: [NUMBER], degraded: false });
  });

  it('sends the token as a Bearer header, never in the URL', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [] }));
    await listWabaPhoneNumbers(CREDS);
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain(CREDS.accessToken);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${CREDS.accessToken}`,
    );
  });

  it('falls back to the core fields when the wide list is rejected', async () => {
    // Graph refuses the WHOLE request over one retired field. One retired field must
    // not take the numbers page down.
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ error: { code: 100 } }, false, 400))
      .mockResolvedValueOnce(jsonResponse({ data: [NUMBER] }));

    const result = await listWabaPhoneNumbers(CREDS);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toContain(`fields=${WABA_PHONE_FIELDS_CORE}`);
    expect(result.numbers).toEqual([NUMBER]);
    expect(result.degraded).toBe(true);
  });

  it('propagates when even the core list fails — that is not a field problem', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: {} }, false, 401));
    await expect(listWabaPhoneNumbers(CREDS)).rejects.toThrow('HTTP 401');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('never puts the response body — or the token — in the error', async () => {
    // Meta's error body echoes request context; this string reaches logs and, via an
    // action, an admin's screen.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { error: { message: `bad token ${CREDS.accessToken}`, fbtrace_id: 'x' } },
        false,
        400,
      ),
    );
    await expect(listWabaPhoneNumbers(CREDS)).rejects.toThrow(
      /^Meta phone_numbers fetch failed: HTTP 400$/,
    );
    await listWabaPhoneNumbers(CREDS).catch((e: unknown) => {
      expect(String(e)).not.toContain(CREDS.accessToken);
      expect(String(e)).not.toContain('fbtrace');
    });
  });

  it('returns an empty list rather than throwing when the WABA has no numbers', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    await expect(listWabaPhoneNumbers(CREDS)).resolves.toEqual({
      numbers: [],
      degraded: false,
    });
  });

  it('carries code_verification_status, which Meta\'s own table does not show', async () => {
    // Measured live 2026-09-10: the configured RSVP sender is EXPIRED while the
    // import number is VERIFIED. This field is the reason the wide read is worth a
    // fallback rather than just using the core list.
    fetchSpy.mockResolvedValue(jsonResponse({ data: [NUMBER] }));
    const { numbers } = await listWabaPhoneNumbers(CREDS);
    expect(numbers[0].code_verification_status).toBe('EXPIRED');
  });
});
