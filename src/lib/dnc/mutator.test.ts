import { gunzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { queryPhones, verifyPhoneList } from './generated/api';
import { DncError, dncFetch, dncQueryFetch } from './mutator';

const fetchMock = vi.fn<typeof fetch>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DNC_API_NAME', 'test-name');
  vi.stubEnv('DNC_API_TOKEN', 'test-token');
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Shapes copied from real answers captured 11.10.2026 (openapi/DNC-API/samples/).
describe('dncFetch through the generated verifyPhoneList', () => {
  it('sends the name/token headers from the environment and resolves with the answer', async () => {
    const answer = {
      statusCode: 200,
      message: 'הפעולה הסתיימה בהצלחה',
      transactionId: '871d18ef-7cfe-4cf9-8ce4-9def09668d96',
      data: ['0500000000', { phone: '123', errorCode: 1 }],
    };
    fetchMock.mockResolvedValue(json(200, answer));

    await expect(verifyPhoneList({ data: ['500000000', '123'] })).resolves.toEqual(answer);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pverification.fta.gov.il/restricted/phone-list-verification');
    const headers = new Headers(init?.headers);
    expect(headers.get('name')).toBe('test-name');
    expect(headers.get('token')).toBe('test-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ data: ['500000000', '123'] }));
  });

  it('refuses to call when the credentials are not configured', async () => {
    vi.stubEnv('DNC_API_TOKEN', '');
    await expect(verifyPhoneList({ data: ['500000000'] })).rejects.toMatchObject({ kind: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'קלט לא תקין'],
    [401, 'אינך מורשה לגשת לשירות זה'],
    [500, '.שגיאה פנימית - אנא פנה לתמיכה עם מזהה הבקשה'],
  ])('HTTP %i → DncError carrying the service answer and its transactionId', async (status, message) => {
    const body = { statusCode: status, message, transactionId: 'fc39330c-7cb2-4a02-bfbe-d9f0a2f9b2d9' };
    fetchMock.mockResolvedValue(json(status, body));
    const err = await verifyPhoneList({ data: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DncError);
    expect(err).toMatchObject({ kind: 'http_error', httpStatus: status, answer: body });
  });

  it('a network failure is "unreachable" and never carries the original error (it could echo the token)', async () => {
    fetchMock.mockRejectedValue(new Error('connect failed, headers: token=test-token'));
    const err = await verifyPhoneList({ data: ['500000000'] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'unreachable' });
    expect(String((err as Error).message)).not.toContain('test-token');
    expect((err as Error).cause).toBeUndefined();
  });

  it('a non-JSON success body is "bad_body"', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(verifyPhoneList({ data: ['500000000'] })).rejects.toMatchObject({ kind: 'bad_body' });
  });

  it('a non-string body is refused before any call', async () => {
    await expect(dncFetch('https://example.test', { body: undefined })).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Shapes copied from real Phone-Query answers captured 11.10.2026 (openapi/DNC-API/samples/phone-query.cases.json).
describe('dncQueryFetch through the generated queryPhones', () => {
  it('sends the numbers sorted and gzip-compressed to dnc-api, WITHOUT a Content-Encoding header', async () => {
    const answer = {
      statusCode: 200,
      message: 'הפעולה הסתיימה בהצלחה',
      transactionId: 'dc168d4a-5ff1-4009-9d1d-c778bb38d192',
      data: ['035648888', '0500000000', { phone: '123', errorCode: 1 }],
    };
    fetchMock.mockResolvedValue(json(200, answer));

    await expect(queryPhones({ data: ['500000000', '123', '35648888'] })).resolves.toEqual(answer);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dnc-api.fta.gov.il/restricted/phone-query');
    const headers = new Headers(init?.headers);
    expect(headers.get('name')).toBe('test-name');
    expect(headers.get('token')).toBe('test-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('content-encoding')).toBeNull();
    expect(headers.get('accept-encoding')).toBe('gzip, deflate');
    const sent = JSON.parse(gunzipSync(init?.body as Uint8Array).toString('utf8'));
    expect(sent).toEqual({ data: ['123', '35648888', '500000000'] });
  });

  it('HTTP 400 → DncError carrying the answer, its null transactionId kept as null', async () => {
    const body = { statusCode: 400, message: 'אנא וודא כי סוג הקלט תקין', transactionId: null, data: null };
    fetchMock.mockResolvedValue(json(400, body));
    const err = await queryPhones({ data: ['500000000'] }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      kind: 'http_error',
      httpStatus: 400,
      answer: { statusCode: 400, message: body.message, transactionId: null },
    });
  });

  it('HTTP 500 with an empty body → DncError without an answer', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500, headers: { errortype: 'NullReferenceException' } }));
    await expect(queryPhones({ data: ['500000000'] })).rejects.toMatchObject({ kind: 'http_error', httpStatus: 500, answer: undefined });
  });

  it.each([
    ['not JSON', 'not json'],
    ['no data list', JSON.stringify({ phones: [] })],
    ['a non-string number', JSON.stringify({ data: [538232216] })],
  ])('a body with %s is refused before any call', async (_label, body) => {
    await expect(dncQueryFetch('/restricted/phone-query', { body })).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
