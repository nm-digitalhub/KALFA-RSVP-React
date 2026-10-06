import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchTemplateHealth } from './template-health';

vi.mock('server-only', () => ({}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTemplateHealth', () => {
  it('follows Graph cursor paging and asks for every mirrored field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: '1', name: 'a', language: 'he' }], paging: { cursors: { after: 'C1' }, next: 'https://x' } }))
      .mockResolvedValueOnce(json({ data: [{ id: '2', name: 'b', language: 'he' }], paging: { cursors: { after: 'C2' } } }));
    vi.stubGlobal('fetch', fetchMock);

    const templates = await fetchTemplateHealth({ wabaId: '123', accessToken: 'token' });

    expect(templates.map((t) => t.id)).toEqual(['1', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL((fetchMock.mock.calls[0]![0] as Request).url);
    expect(first.pathname).toMatch(/^\/v\d+\.\d+\/123\/message_templates$/);
    expect(first.searchParams.get('limit')).toBe('100');
    expect(first.searchParams.get('fields')).toContain('quality_score');
    expect(first.searchParams.get('fields')).toContain('disable_ios_autofill');
    expect(first.searchParams.has('after')).toBe(false);
    expect(new URL((fetchMock.mock.calls[1]![0] as Request).url).searchParams.get('after')).toBe('C1');
  });

  it('throws on a Graph error instead of reading it as "no templates"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'bad', type: 'OAuthException', code: 190 } }, 401)));
    await expect(fetchTemplateHealth({ wabaId: '123', accessToken: 'token' })).rejects.toThrow('HTTP 401');
  });
});
