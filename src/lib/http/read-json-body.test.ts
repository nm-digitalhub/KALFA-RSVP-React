import { describe, expect, it } from 'vitest';

import { NO_STORE_HEADERS, noStoreJson } from './no-store-json';
import { readJsonBody } from './read-json-body';

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('https://kalfa.test/api/x', { method: 'POST', body, headers });
}

describe('noStoreJson', () => {
  it('answers JSON with the given status and Cache-Control: no-store', async () => {
    const res = noStoreJson({ error: 'x' }, 409);
    expect(res.status).toBe(409);
    expect(res.headers.get('cache-control')).toBe(NO_STORE_HEADERS['Cache-Control']);
    expect(await res.json()).toEqual({ error: 'x' });
  });
});

describe('readJsonBody', () => {
  it('returns the parsed value of a body within the cap', async () => {
    const read = await readJsonBody(post('{"a":1}'), { maxSize: 16, measure: 'utf8-bytes' });
    expect(read).toEqual({ ok: true, value: { a: 1 } });
  });

  it('refuses a body over the cap with 413 and no-store', async () => {
    const read = await readJsonBody(post(JSON.stringify({ a: 'x'.repeat(40) })), {
      maxSize: 16,
      measure: 'utf8-bytes',
    });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.response.status).toBe(413);
    expect(read.response.headers.get('cache-control')).toBe('no-store');
    expect(await read.response.json()).toEqual({ error: 'בקשה גדולה מדי' });
  });

  // The two measures disagree on non-ASCII text: 6 Hebrew letters are 6 UTF-16 units and 12 UTF-8 bytes.
  it("measures 'utf8-bytes' on the wire size and 'string-length' on the string", async () => {
    const body = '"שלוםשל"'; // 8 string units, 14 bytes
    const asBytes = await readJsonBody(post(body), { maxSize: 10, measure: 'utf8-bytes' });
    const asLength = await readJsonBody(post(body), { maxSize: 10, measure: 'string-length' });
    expect(asBytes.ok).toBe(false);
    expect(asLength).toEqual({ ok: true, value: 'שלוםשל' });
  });

  it('refuses a body that is not JSON with 400', async () => {
    const read = await readJsonBody(post('{not json'), { maxSize: 64, measure: 'utf8-bytes' });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.response.status).toBe(400);
    expect(await read.response.json()).toEqual({ error: 'גוף הבקשה אינו תקין' });
  });

  it('treats an empty body as invalid JSON unless emptyAsObject is set', async () => {
    const strict = await readJsonBody(post(''), { maxSize: 64, measure: 'utf8-bytes' });
    const lenient = await readJsonBody(post(''), {
      maxSize: 64,
      measure: 'utf8-bytes',
      emptyAsObject: true,
    });
    expect(strict.ok).toBe(false);
    expect(lenient).toEqual({ ok: true, value: {} });
  });

  it('checks a declared Content-Length only when asked to', async () => {
    const headers = { 'content-length': '9999' };
    const checked = await readJsonBody(post('{}', headers), {
      maxSize: 64,
      measure: 'utf8-bytes',
      checkDeclaredLength: true,
    });
    const unchecked = await readJsonBody(post('{}', headers), { maxSize: 64, measure: 'utf8-bytes' });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.response.status).toBe(413);
    expect(unchecked).toEqual({ ok: true, value: {} });
  });
});
