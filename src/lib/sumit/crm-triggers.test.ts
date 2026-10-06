import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  listSumitFolders,
  listSumitViews,
  subscribeSumitTrigger,
  SumitTriggerError,
  unsubscribeSumitTrigger,
} from './crm-triggers';

const creds = { companyId: 123, apiKey: 'k' };
const reply = (body: unknown, status = 200) =>
  vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('SUMIT trigger client', () => {
  it('lists folders and views as { id, name } strings', async () => {
    const f = reply({ Status: 0, Data: { Folders: [{ ID: 1076735289, Name: 'תפיסות מסגרת' }, { ID: null, Name: 'x' }] } });
    vi.stubGlobal('fetch', f);
    await expect(listSumitFolders(creds)).resolves.toEqual([{ id: '1076735289', name: 'תפיסות מסגרת' }]);
    expect(f.mock.calls[0][0]).toBe('https://api.sumit.co.il/crm/schema/listfolders/');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ Credentials: { CompanyID: 123, APIKey: 'k' } });

    const v = reply({ Status: 0, Data: { Views: [{ ID: 1076735405, Name: '' }] } });
    vi.stubGlobal('fetch', v);
    await expect(listSumitViews(creds, '1076735289')).resolves.toEqual([{ id: '1076735405', name: '1076735405' }]);
    expect(JSON.parse(v.mock.calls[0][1].body).FolderID).toBe(1076735289);
  });

  it('subscribe sends Folder as a string and View as a number, as SUMIT declares them', async () => {
    const f = reply({ Status: 0, Data: null });
    vi.stubGlobal('fetch', f);
    await subscribeSumitTrigger(creds, { url: 'https://x/api/workflows/hook/t', folderId: '10', viewId: '20', triggerType: 'Update' });
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ URL: 'https://x/api/workflows/hook/t', Folder: '10', View: 20, TriggerType: 'Update' });
    await unsubscribeSumitTrigger(creds, 'https://x/api/workflows/hook/t');
    expect(f.mock.calls[1][0]).toBe('https://api.sumit.co.il/triggers/triggers/unsubscribe/');
  });

  it('a SUMIT refusal carries its user message and never the URL', async () => {
    vi.stubGlobal('fetch', reply({ Status: 1, UserErrorMessage: 'מודול טריגרים לא מותקן' }));
    const err = await subscribeSumitTrigger(creds, { url: 'https://x/api/workflows/hook/SECRET', folderId: '1', viewId: '2', triggerType: 'Create' }).catch((e) => e);
    expect(err).toBeInstanceOf(SumitTriggerError);
    expect(err.message).toBe('מודול טריגרים לא מותקן');
    expect(err.message).not.toContain('SECRET');
  });

  it('HTTP and network failures become SumitTriggerError', async () => {
    vi.stubGlobal('fetch', reply({}, 500));
    await expect(listSumitFolders(creds)).rejects.toThrow('HTTP 500');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(listSumitFolders(creds)).rejects.toThrow('SUMIT לא ענתה');
  });
});
