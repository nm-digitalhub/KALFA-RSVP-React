// A health check is only useful if its failures are distinguishable. "לא עובד" sends
// someone to check the token when the real fault is a WABA id from a previous
// business account.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkWhatsAppHealth, HEALTH_FIELDS } from './health';
import { GRAPH_API_VERSION } from './graph-version';

const CREDS = { phoneNumberId: '1018741517998430', wabaId: '990921550130385', accessToken: 'SECRET-TOKEN' };

const NUMBER_OK = {
  id: CREDS.phoneNumberId,
  display_phone_number: '+972 3-721-9347',
  verified_name: 'KALFA',
  quality_rating: 'GREEN',
  status: 'CONNECTED',
  name_status: 'APPROVED',
  throughput: { level: 'STANDARD' },
};

/** `responses` are consumed in call order: [phone number node, WABA list]. */
function mockGraph(responses: Array<{ status?: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const graphError = (code: number) => ({ body: { error: { code, message: 'whatever Meta said' } }, status: 400 });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('checkWhatsAppHealth', () => {
  it('reports the number the way Meta describes it', async () => {
    mockGraph([{ body: NUMBER_OK }, { body: { data: [{ id: CREDS.phoneNumberId }] } }]);

    const health = await checkWhatsAppHealth(CREDS);

    expect(health).toEqual({
      ok: true,
      phoneNumberId: CREDS.phoneNumberId,
      displayPhoneNumber: '+972 3-721-9347',
      verifiedName: 'KALFA',
      qualityRating: 'GREEN',
      status: 'CONNECTED',
      nameStatus: 'APPROVED',
      throughputLevel: 'STANDARD',
    });
  });

  it('asks only for fields proven to exist, on the pinned version', async () => {
    // Graph refuses the WHOLE request over one unavailable field and blames the wrong
    // part, so the field list is not a detail. unified_cert_status is declared by
    // Meta's own v25.0 spec and refused by Meta's own API (measured on v23–v26).
    const fetchMock = mockGraph([{ body: NUMBER_OK }, { body: { data: [{ id: CREDS.phoneNumberId }] } }]);

    await checkWhatsAppHealth(CREDS);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`/${GRAPH_API_VERSION}/`);
    expect(url).not.toContain('unified_cert_status');
    expect(url).not.toContain('last_onboarded_time'); // accepted, but always empty here
    for (const field of HEALTH_FIELDS) expect(url).toContain(field);
  });

  it('SENDS NOTHING — both calls are GETs', async () => {
    const fetchMock = mockGraph([{ body: NUMBER_OK }, { body: { data: [{ id: CREDS.phoneNumberId }] } }]);
    await checkWhatsAppHealth(CREDS);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.body).toBeUndefined();
    }
  });

  describe('tells the failures apart', () => {
    it('190 is the token, and nothing else is attempted', async () => {
      const fetchMock = mockGraph([graphError(190)]);
      const health = await checkWhatsAppHealth(CREDS);
      expect(health).toMatchObject({ ok: false, kind: 'token_invalid' });
      expect(fetchMock).toHaveBeenCalledTimes(1); // no point listing a WABA with a dead token
    });

    it('200 is a missing scope, not a bad id', async () => {
      mockGraph([graphError(200)]);
      expect(await checkWhatsAppHealth(CREDS)).toMatchObject({ kind: 'permission_missing' });
    });

    it('803 on the number is the number', async () => {
      mockGraph([graphError(803)]);
      expect(await checkWhatsAppHealth(CREDS)).toMatchObject({ kind: 'number_unreachable' });
    });

    it('803 on the WABA is the WABA, not the number', async () => {
      mockGraph([{ body: NUMBER_OK }, graphError(803)]);
      expect(await checkWhatsAppHealth(CREDS)).toMatchObject({ kind: 'waba_unreachable' });
    });

    it('throttling is reported as throttling — it says nothing about config', async () => {
      for (const code of [4, 17, 32, 613]) {
        mockGraph([graphError(code)]);
        expect(await checkWhatsAppHealth(CREDS)).toMatchObject({ kind: 'rate_limited' });
        vi.unstubAllGlobals();
      }
    });

    // THE ONE THAT EARNS THE SECOND CALL. Both ids resolve, the token is fine, and
    // the integration is still broken: a stale whatsapp_waba_id after moving between
    // business accounts passes call one and silently breaks template sync, which
    // reads templates from the WABA.
    it('a number that resolves but belongs to ANOTHER WABA is its own diagnosis', async () => {
      mockGraph([{ body: NUMBER_OK }, { body: { data: [{ id: 'some-other-number' }] } }]);
      const health = await checkWhatsAppHealth(CREDS);
      expect(health).toMatchObject({ ok: false, kind: 'number_not_in_waba' });
      expect((health as { message: string }).message).toContain('אינו משויך');
    });

    it('a network failure is not reported as a bad token', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${CREDS.accessToken}`)));
      expect(await checkWhatsAppHealth(CREDS)).toMatchObject({ kind: 'unreachable' });
    });
  });

  it('never lets the token or a raw Graph body into the message', async () => {
    // The thrown fetch error above deliberately contained the token, which is how a
    // careless `err.message` passthrough would leak one.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`boom ${CREDS.accessToken}`)));
    const a = await checkWhatsAppHealth(CREDS);
    vi.unstubAllGlobals();
    mockGraph([graphError(190)]);
    const b = await checkWhatsAppHealth(CREDS);

    for (const health of [a, b]) {
      const text = JSON.stringify(health);
      expect(text).not.toContain(CREDS.accessToken);
      expect(text).not.toContain('whatever Meta said');
    }
  });

  it('skips the WABA check when none is configured rather than inventing a failure', async () => {
    const fetchMock = mockGraph([{ body: NUMBER_OK }]);
    const health = await checkWhatsAppHealth({ ...CREDS, wabaId: null });
    expect(health).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a missing quality rating as unknown, not as healthy-looking text', async () => {
    mockGraph([
      { body: { ...NUMBER_OK, quality_rating: undefined, throughput: undefined } },
      { body: { data: [{ id: CREDS.phoneNumberId }] } },
    ]);
    expect(await checkWhatsAppHealth(CREDS)).toMatchObject({
      ok: true,
      qualityRating: null,
      throughputLevel: null,
    });
  });
});
