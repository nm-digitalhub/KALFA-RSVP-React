// Two hazards drive this file: the API key must never leave in a result, and HTTP 200
// is not the answer — SUMIT reports rejected credentials inside the body.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkSumitHealth } from './health';

const KEY = 'SUMIT-KEY-SECRET';
const CREDS = { companyId: '123456', apiKey: KEY };

function mockJson(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })),
  );
}

const COMPANY = {
  Name: 'KALFA',
  CorporateNumber: '123456789',
  EmailAddress: 'billing@example.com',
  DocumentsEmailAddress: 'docs@example.com',
};

beforeEach(() => vi.unstubAllGlobals());

describe('checkSumitHealth', () => {
  it('NEVER lets the api key into the result', async () => {
    mockJson(200, { Status: 0, Data: { Company: COMPANY } });
    expect(JSON.stringify(await checkSumitHealth(CREDS))).not.toContain(KEY);
  });

  it('never lets the key into a failure message either', async () => {
    // A fetch rejection can echo the request, and the request body carries the key.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`failed: ${KEY}`) }));
    const r = await checkSumitHealth(CREDS);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.ok === false && r.kind).toBe('unreachable');
  });

  it('returns OUR company details — the proof the credential PAIR resolves', async () => {
    mockJson(200, { Status: 0, Data: { Company: COMPANY } });
    const r = await checkSumitHealth(CREDS);
    expect(r).toMatchObject({
      ok: true,
      companyName: 'KALFA',
      corporateNumber: '123456789',
      documentsEmail: 'docs@example.com',
    });
  });

  it('falls back to the account email when no documents email is set', async () => {
    mockJson(200, { Status: 0, Data: { Company: { ...COMPANY, DocumentsEmailAddress: null } } });
    const r = await checkSumitHealth(CREDS);
    expect(r.ok && r.documentsEmail).toBe('billing@example.com');
  });

  it('reads a rejection out of the BODY, not the HTTP status', async () => {
    // The trap: SUMIT answers 200 and puts the refusal in Status.
    for (const status of [1, 'BusinessError (1)']) {
      mockJson(200, { Status: status, UserErrorMessage: 'bad key' });
      const r = await checkSumitHealth(CREDS);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.kind).toBe('credentials_rejected');
    }
  });

  it("separates SUMIT's own fault from ours", async () => {
    // A technical error on their side says nothing about our configuration, and
    // telling someone to re-check their key over it wastes an afternoon.
    mockJson(200, { Status: 2 });
    expect((await checkSumitHealth(CREDS)).ok === false).toBe(true);
    const r = await checkSumitHealth(CREDS);
    expect(r.ok === false && r.kind).toBe('provider_error');
  });

  it('refuses a non-numeric company id before asking SUMIT', async () => {
    // "You typed letters into the company id" and "your key was revoked" send someone
    // to two very different places.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const companyId of ['', 'abc', '0', '-5', '12.5']) {
      const r = await checkSumitHealth({ companyId, apiKey: KEY });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.message).toContain('מספר תקין');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to call success on a shape it does not recognise', async () => {
    mockJson(200, { Status: 0 });                       // success, but no company
    expect((await checkSumitHealth(CREDS)).ok === false).toBe(true);
    mockJson(200, { Status: 0, Data: { Company: null } });
    expect((await checkSumitHealth(CREDS)).ok === false).toBe(true);
    mockJson(200, { Status: 'Weird' });
    const r = await checkSumitHealth(CREDS);
    expect(r.ok === false && r.kind).toBe('unexpected_response');
  });

  it('treats a non-200 as unreachable rather than as a rejection', async () => {
    mockJson(503, {});
    const r = await checkSumitHealth(CREDS);
    expect(r.ok === false && r.kind).toBe('unreachable');
  });
});
