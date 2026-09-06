import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/storage/legal-docs', () => ({ downloadLegalDoc: vi.fn() }));
vi.mock('@/lib/microsoft/graph-client', () => ({
  archiveGraphClient: vi.fn(),
  archiveIdentity: vi.fn(() => 'dedicated'),
  graphConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { archiveGraphClient, graphConfigured } from '@/lib/microsoft/graph-client';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { resetArchiveTargetCache, type ArchiveTarget } from '@/lib/data/agreement-archive';
import {
  decideForFile,
  listArchiveFiles,
  runArchiveMaintenanceSweep,
  EXPIRING_WINDOW_MS,
} from '@/lib/data/archive-maintenance';

const NOW_MS = Date.parse('2026-09-06T09:00:00+00:00');
const DAY = 86_400_000;

// The library's REAL internal names: SharePoint escaped SHA256 on the list.
const TARGET: ArchiveTarget = {
  driveId: 'drive-c',
  fieldNames: new Map([
    ['SHA256', '_x0053_HA256'],
    ['_x0053_HA256', '_x0053_HA256'],
    ['Status', 'Status'],
    ['ExpiryDate', 'ExpiryDate'],
    ['RetentionUntil', 'RetentionUntil'],
    ['LegalHold', 'LegalHold'],
  ]),
};

const iso = (ms: number) => new Date(ms).toISOString();

describe('decideForFile', () => {
  it('fills a missing hash on Contracts, flags it as missing on Customer-Agreements', () => {
    expect(decideForFile({}, TARGET, 'Contracts', NOW_MS)).toMatchObject({ fillHash: true, missingHash: false, verifyHash: false });
    expect(decideForFile({}, TARGET, 'Customer-Agreements', NOW_MS)).toMatchObject({ fillHash: false, missingHash: true, verifyHash: false });
  });

  it('verifies an existing hash read under the escaped internal name', () => {
    expect(decideForFile({ _x0053_HA256: 'ab'.repeat(32) }, TARGET, 'Contracts', NOW_MS)).toMatchObject({ verifyHash: true, fillHash: false });
  });

  it('marks Active → Expired only when the expiry date has passed', () => {
    expect(decideForFile({ Status: 'Active', ExpiryDate: iso(NOW_MS - DAY) }, TARGET, 'Contracts', NOW_MS).markExpired).toBe(true);
    expect(decideForFile({ Status: 'Active', ExpiryDate: iso(NOW_MS + DAY) }, TARGET, 'Contracts', NOW_MS).markExpired).toBe(false);
    expect(decideForFile({ Status: 'Expired', ExpiryDate: iso(NOW_MS - DAY) }, TARGET, 'Contracts', NOW_MS).markExpired).toBe(false);
  });

  it('reports due-for-disposition unless under legal hold', () => {
    expect(decideForFile({ RetentionUntil: iso(NOW_MS - DAY) }, TARGET, 'Contracts', NOW_MS).due).toBe(true);
    expect(decideForFile({ RetentionUntil: iso(NOW_MS - DAY), LegalHold: true }, TARGET, 'Contracts', NOW_MS).due).toBe(false);
    expect(decideForFile({ RetentionUntil: iso(NOW_MS + DAY) }, TARGET, 'Contracts', NOW_MS).due).toBe(false);
  });

  it('reports active contracts expiring within the 90-day window', () => {
    expect(decideForFile({ Status: 'Active', ExpiryDate: iso(NOW_MS + 30 * DAY) }, TARGET, 'Contracts', NOW_MS).expiring).toBe(true);
    expect(decideForFile({ Status: 'Active', ExpiryDate: iso(NOW_MS + EXPIRING_WINDOW_MS + DAY) }, TARGET, 'Contracts', NOW_MS).expiring).toBe(false);
    expect(decideForFile({ Status: 'Terminated', ExpiryDate: iso(NOW_MS + 30 * DAY) }, TARGET, 'Contracts', NOW_MS).expiring).toBe(false);
  });
});

// ── Graph double ────────────────────────────────────────────────────────────

type Call = { method: string; path: string; body?: unknown };

function mockGraph(routes: Array<[method: string, match: string | RegExp, reply: unknown]>) {
  const calls: Call[] = [];
  const answer = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    for (const [m, match, reply] of routes) {
      const hit = typeof match === 'string' ? path.startsWith(match) : match.test(path);
      if (m === method && hit) {
        if (reply instanceof Error) throw reply;
        return typeof reply === 'function' ? (reply as (p: string) => unknown)(path) : reply;
      }
    }
    throw Object.assign(new Error(`unrouted ${method} ${path}`), { statusCode: 500 });
  };
  const api = (path: string) => {
    const req = {
      responseType: () => req,
      get: async () => answer('GET', path),
      patch: async (b: unknown) => answer('PATCH', path, b),
      put: async (b: unknown) => answer('PUT', path, b),
      post: async (b: unknown) => answer('POST', path, b),
    };
    return req;
  };
  vi.mocked(archiveGraphClient).mockReturnValue({ api } as unknown as ReturnType<typeof archiveGraphClient>);
  return calls;
}

const PDF_A = new Uint8Array(Buffer.from('%PDF-1.7 contract A'));
const PDF_B = new Uint8Array(Buffer.from('%PDF-1.7 agreement B'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const toAB = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);

const COLUMNS = ['Title', 'Status', 'ExpiryDate', 'RetentionUntil', 'LegalHold', '_x0053_HA256'].map((name) => ({ name, readOnly: false }));

const SITE_ROUTES: Array<[string, string | RegExp, unknown]> = [
  ['GET', '/sites/kalfarsvp.sharepoint.com:/sites/KALFARSVP', { id: 'site-1' }],
  [
    'GET',
    '/sites/site-1/lists?',
    { value: [{ id: 'list-c', displayName: 'Contracts' }, { id: 'list-a', displayName: 'Customer-Agreements' }] },
  ],
  ['GET', '/sites/site-1/lists/list-c/drive', { id: 'drive-c' }],
  ['GET', '/sites/site-1/lists/list-a/drive', { id: 'drive-a' }],
  ['GET', '/sites/site-1/lists/list-c/columns', { value: COLUMNS }],
  ['GET', '/sites/site-1/lists/list-a/columns', { value: COLUMNS }],
];

beforeEach(() => {
  vi.clearAllMocks();
  resetArchiveTargetCache();
  process.env.SHAREPOINT_ARCHIVE_SITE = 'kalfarsvp.sharepoint.com:/sites/KALFARSVP';
  vi.mocked(graphConfigured).mockReturnValue(true);
});

afterEach(() => {
  delete process.env.SHAREPOINT_ARCHIVE_SITE;
});

describe('listArchiveFiles', () => {
  it('walks folders recursively, keeps list-item fields and skips the _ARCHIVE-RULES note', async () => {
    mockGraph([
      ['GET', '/drives/drive-c/root/children', { value: [
        { id: 'f-vendors', name: '01-Vendors', folder: {} },
        { id: 'note', name: '_ARCHIVE-RULES.md', file: {}, size: 10 },
      ] }],
      ['GET', '/drives/drive-c/root:/01-Vendors:/children', { value: [{ id: 'f-meta', name: 'Meta', folder: {} }] }],
      ['GET', '/drives/drive-c/root:/01-Vendors/Meta:/children', { value: [
        { id: 'doc-1', name: '2026-07-15_Meta_Terms_v1_signed.pdf', file: {}, size: 19, listItem: { fields: { Status: 'Active' } } },
      ] }],
    ]);
    const files = await listArchiveFiles('drive-c');
    expect(files).toEqual([
      { id: 'doc-1', name: '2026-07-15_Meta_Terms_v1_signed.pdf', path: '01-Vendors/Meta/2026-07-15_Meta_Terms_v1_signed.pdf', size: 19, fields: { Status: 'Active' } },
    ]);
  });
});

describe('runArchiveMaintenanceSweep', () => {
  it('is a no-op without the archive site configured', async () => {
    process.env.SHAREPOINT_ARCHIVE_SITE = '';
    const calls = mockGraph([]);
    const r = await runArchiveMaintenanceSweep(NOW_MS);
    expect(r.scanned).toBe(0);
    expect(calls).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('fills a missing hash on a hand-uploaded contract, verifies recorded hashes, marks expired, reports due and expiring', async () => {
    const calls = mockGraph([
      ...SITE_ROUTES,
      // Contracts: A has no hash + expired; C has a WRONG hash + retention passed; D active expiring soon.
      ['GET', '/drives/drive-c/root/children', { value: [
        { id: 'a', name: 'A.pdf', file: {}, size: PDF_A.byteLength, listItem: { fields: { Status: 'Active', ExpiryDate: iso(NOW_MS - DAY) } } },
        { id: 'c', name: 'C.pdf', file: {}, size: PDF_A.byteLength, listItem: { fields: { _x0053_HA256: 'ff'.repeat(32), Status: 'Expired', RetentionUntil: iso(NOW_MS - DAY) } } },
        { id: 'd', name: 'D.pdf', file: {}, size: PDF_A.byteLength, listItem: { fields: { _x0053_HA256: sha(PDF_A), Status: 'Active', ExpiryDate: iso(NOW_MS + 10 * DAY) } } },
      ] }],
      // Customer-Agreements: B hash correct; E missing hash (anomaly).
      ['GET', '/drives/drive-a/root/children', { value: [
        { id: 'b', name: 'B.pdf', file: {}, size: PDF_B.byteLength, listItem: { fields: { _x0053_HA256: sha(PDF_B), Status: 'Expired', RetentionUntil: iso(NOW_MS + 365 * DAY) } } },
        { id: 'e', name: 'E.pdf', file: {}, size: 5, listItem: { fields: { Status: 'Active' } } },
      ] }],
      ['GET', /^\/drives\/drive-c\/items\/(a|c|d)\/content$/, () => toAB(PDF_A)],
      ['GET', /^\/drives\/drive-a\/items\/b\/content$/, () => toAB(PDF_B)],
      ['PATCH', /\/listItem\/fields$/, {}],
    ]);

    const r = await runArchiveMaintenanceSweep(NOW_MS);

    expect(r.scanned).toBe(5);
    expect(r.hashesFilled).toBe(1);
    expect(r.hashesVerified).toBe(3);
    expect(r.mismatches).toEqual(['Contracts/C.pdf']);
    expect(r.missingHashes).toEqual(['Customer-Agreements/E.pdf']);
    expect(r.expiredMarked).toBe(1);
    expect(r.due).toEqual(['Contracts/C.pdf']);
    expect(r.expiring).toEqual(['Contracts/D.pdf']);
    expect(r.errors).toBe(0);

    const patches = calls.filter((c) => c.method === 'PATCH');
    // Hash written under the ESCAPED internal name; status flip separate.
    expect(patches.find((p) => p.path.includes('/items/a/'))?.body).toMatchObject({ _x0053_HA256: sha(PDF_A) });
    expect(patches.some((p) => p.path.includes('/items/a/') && (p.body as Record<string, string>).Status === 'Expired')).toBe(true);
    // A mismatch is REPORTED, never rewritten.
    expect(patches.some((p) => p.path.includes('/items/c/'))).toBe(false);

    const alert = vi.mocked(sendSlackAlert).mock.calls[0]?.[0];
    expect(alert?.level).toBe('error');
    expect(alert?.category).toBe('security');
    expect(alert?.detail).toContain('Contracts/C.pdf');
  });

  it('sends an info summary when everything verifies', async () => {
    mockGraph([
      ...SITE_ROUTES,
      ['GET', '/drives/drive-c/root/children', { value: [
        { id: 'd', name: 'D.pdf', file: {}, size: PDF_A.byteLength, listItem: { fields: { _x0053_HA256: sha(PDF_A), Status: 'Active' } } },
      ] }],
      ['GET', '/drives/drive-a/root/children', { value: [] }],
      ['GET', /\/items\/d\/content$/, () => toAB(PDF_A)],
    ]);
    const r = await runArchiveMaintenanceSweep(NOW_MS);
    expect(r).toMatchObject({ scanned: 1, hashesVerified: 1, mismatches: [], errors: 0 });
    expect(vi.mocked(sendSlackAlert).mock.calls[0]?.[0].level).toBe('info');
  });

  it('counts a Graph failure on one file as an error and continues with the rest', async () => {
    mockGraph([
      ...SITE_ROUTES,
      ['GET', '/drives/drive-c/root/children', { value: [
        { id: 'x', name: 'X.pdf', file: {}, size: 10, listItem: { fields: { _x0053_HA256: sha(PDF_A) } } },
        { id: 'd', name: 'D.pdf', file: {}, size: PDF_A.byteLength, listItem: { fields: { _x0053_HA256: sha(PDF_A) } } },
      ] }],
      ['GET', '/drives/drive-a/root/children', { value: [] }],
      ['GET', /\/items\/x\/content$/, Object.assign(new Error('graph 503'), { statusCode: 503 })],
      ['GET', /\/items\/d\/content$/, () => toAB(PDF_A)],
    ]);
    const r = await runArchiveMaintenanceSweep(NOW_MS);
    expect(r.errors).toBe(1);
    expect(r.hashesVerified).toBe(1);
    expect(vi.mocked(sendSlackAlert).mock.calls[0]?.[0].level).toBe('error');
  });
});
