import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const isDncListed = vi.fn<(phone: string) => Promise<boolean>>();
vi.mock('@/lib/data/outreach-engine', () => ({ isDncListed: (phone: string) => isDncListed(phone) }));

import { checkRegistry, toRegistryDigits } from './registry-check';

const fetchMock = vi.fn<typeof fetch>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// Real answers captured 11.10.2026.
const sample = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'openapi/DNC-API/samples', name), 'utf8')) as {
    body: unknown;
  };

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DNC_API_NAME', 'test-name');
  vi.stubEnv('DNC_API_TOKEN', 'test-token');
  fetchMock.mockReset();
  isDncListed.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('toRegistryDigits', () => {
  it.each([
    ['+972501111111', '501111111'],
    ['+97235648888', '35648888'],
    ['+33756982370', null],
    ['+9720501111111', null],
  ])('%s → %s', (input, expected) => {
    expect(toRegistryDigits(input)).toBe(expected);
  });
});

describe('checkRegistry', () => {
  it('sends the number without its leading 0 and reads a returned string as clear', async () => {
    // From phone-list-verification.formats.json: "35648888" came back as "035648888".
    fetchMock.mockResolvedValue(json(200, sample('phone-list-verification.formats.json').body));
    const r = await checkRegistry('03-5648888');
    expect(r).toMatchObject({
      result: 'registry_clear',
      source: 'national_registry',
      transactionId: '5a482afe-d832-4d6b-a0d8-5aaf73439c66',
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { data: string[] };
    expect(body).toEqual({ data: ['35648888'] });
  });

  it('a number absent from a valid answer is listed', async () => {
    fetchMock.mockResolvedValue(
      json(200, { statusCode: 200, message: 'ok', transactionId: '871d18ef-7cfe-4cf9-8ce4-9def09668d96', data: [] }),
    );
    expect(await checkRegistry('0501234567')).toMatchObject({ result: 'registry_listed', source: 'national_registry' });
  });

  it('an error object for the number is unchecked, with its errorCode', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        statusCode: 200,
        message: 'ok',
        transactionId: '871d18ef-7cfe-4cf9-8ce4-9def09668d96',
        data: [{ phone: '501234567', errorCode: 1 }],
      }),
    );
    expect(await checkRegistry('0501234567')).toMatchObject({ result: 'registry_unchecked', errorCode: 1 });
  });

  it.each([
    ['statusCode is not 200', { statusCode: 201, message: 'x', transactionId: '871d18ef-7cfe-4cf9-8ce4-9def09668d96', data: [] }],
    ['transactionId missing', { statusCode: 200, message: 'x', data: [] }],
    ['data is not a list', { statusCode: 200, message: 'x', transactionId: '871d18ef-7cfe-4cf9-8ce4-9def09668d96', data: null }],
    ['an item of the wrong shape', { statusCode: 200, message: 'x', transactionId: '871d18ef-7cfe-4cf9-8ce4-9def09668d96', data: [5] }],
  ])('a malformed answer (%s) is unavailable, never listed', async (_label, body) => {
    fetchMock.mockResolvedValue(json(200, body));
    expect(await checkRegistry('0501234567')).toMatchObject({ result: 'registry_unavailable', failure: 'bad_answer' });
  });

  it.each([
    [400, { statusCode: 400, message: 'קלט לא תקין', transactionId: 'fc39330c-7cb2-4a02-bfbe-d9f0a2f9b2d9' }],
    [401, { statusCode: 401, message: 'אינך מורשה לגשת לשירות זה', transactionId: 'f7c936cc-a081-4a24-8609-f1dbca9aa9a4' }],
    [500, { statusCode: 500, message: 'שגיאה פנימית', transactionId: '045a5e0e-4443-4396-b5df-1530c9afc8fe' }],
  ])('HTTP %i is unavailable, carrying the status and transaction id', async (status, body) => {
    fetchMock.mockResolvedValue(json(status, body));
    expect(await checkRegistry('0501234567')).toMatchObject({
      result: 'registry_unavailable',
      failure: 'http_error',
      errorCode: status,
      transactionId: body.transactionId,
    });
  });

  it('an unreachable service is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('connect failed'));
    expect(await checkRegistry('0501234567')).toMatchObject({ result: 'registry_unavailable', failure: 'unreachable' });
  });

  it('missing credentials are unavailable, and no call is made', async () => {
    vi.stubEnv('DNC_API_TOKEN', '');
    expect(await checkRegistry('0501234567')).toMatchObject({ result: 'registry_unavailable', failure: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a foreign number is not covered, and the registry is not called', async () => {
    expect(await checkRegistry('+33756982370')).toMatchObject({ result: 'not_covered', source: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a locally blocked number never reaches the registry', async () => {
    isDncListed.mockResolvedValue(true);
    expect(await checkRegistry('0501234567')).toMatchObject({ result: 'local_blocked', source: 'local_list' });
    expect(isDncListed).toHaveBeenCalledWith('+972501234567');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unparseable number is unavailable, and nothing is called', async () => {
    expect(await checkRegistry('not a phone')).toMatchObject({ result: 'registry_unavailable', failure: 'invalid_request' });
    expect(isDncListed).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
