import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/microsoft/graph-client', () => ({
  archiveGraphClient: vi.fn(),
  archiveIdentity: vi.fn(() => 'dedicated'),
  graphConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { archiveGraphClient, graphConfigured } from '@/lib/microsoft/graph-client';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { resetArchiveTargetCache } from '@/lib/data/agreement-archive';
import {
  BACKUP_BUCKET,
  listSupabaseObjects,
  manifestPath,
  objectPath,
  runArchiveBackupSweep,
} from '@/lib/data/archive-backup';

const NOW_MS = Date.parse('2026-09-06T09:00:00+00:00');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytes = (s: string) => new Uint8Array(Buffer.from(s));
const toAB = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);

describe('objectPath / manifestPath', () => {
  it('shards objects by the first two hex characters', () => {
    expect(objectPath('abcdef0123')).toBe('objects/ab/abcdef0123');
  });

  it('names one manifest per calendar day', () => {
    expect(manifestPath(NOW_MS)).toBe('manifests/2026-09-06.json');
  });
});

// ── Supabase storage double ─────────────────────────────────────────────────

type StoredFile = { path: string; body: Uint8Array };

/**
 * Minimal storage stub: `list` walks a virtual tree one level at a time (rows
 * without an id are folders, as Supabase returns them), `download` returns the
 * bytes, `upload` records the write.
 */
function mockStorage(source: StoredFile[], existingBackup: string[] = []) {
  const uploads: Array<{ bucket: string; path: string; body: Uint8Array; upsert: boolean }> = [];
  const backup = new Set(existingBackup);

  const listOneLevel = (files: StoredFile[], prefix: string) => {
    const seen = new Map<string, { name: string; id: string | null; metadata: { size: number } | null }>();
    for (const f of files) {
      if (prefix && !f.path.startsWith(prefix + '/')) continue;
      const rest = prefix ? f.path.slice(prefix.length + 1) : f.path;
      const slash = rest.indexOf('/');
      if (slash === -1) seen.set(rest, { name: rest, id: 'id-' + rest, metadata: { size: f.body.byteLength } });
      else {
        const dir = rest.slice(0, slash);
        if (!seen.has(dir)) seen.set(dir, { name: dir, id: null, metadata: null });
      }
    }
    return [...seen.values()];
  };

  const from = (bucket: string) => ({
    list: vi.fn(async (prefix: string, opts: { limit: number; offset?: number; search?: string }) => {
      if (bucket === BACKUP_BUCKET) {
        // Only used as an existence probe: `search` is the object's file name.
        const want = `${prefix}/${opts.search}`;
        return { data: backup.has(want) ? [{ name: opts.search, id: 'x' }] : [], error: null };
      }
      const rows = listOneLevel(source, prefix);
      return { data: rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit), error: null };
    }),
    download: vi.fn(async (path: string) => {
      const f = source.find((x) => x.path === path);
      if (!f) return { data: null, error: { message: 'not found' } };
      return { data: { arrayBuffer: async () => toAB(f.body) }, error: null };
    }),
    upload: vi.fn(async (path: string, body: Uint8Array, opts: { upsert?: boolean }) => {
      if (bucket === BACKUP_BUCKET && backup.has(path) && !opts.upsert) {
        return { error: { message: 'The resource already exists' } };
      }
      backup.add(path);
      uploads.push({ bucket, path, body, upsert: Boolean(opts.upsert) });
      return { error: null };
    }),
  });

  vi.mocked(createAdminClient).mockReturnValue({ storage: { from } } as unknown as ReturnType<typeof createAdminClient>);
  return { uploads, backup };
}

function mockGraph(routes: Array<[method: string, match: string | RegExp, reply: unknown]>) {
  const answer = (method: string, path: string) => {
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
    const req = { responseType: () => req, get: async () => answer('GET', path) };
    return req;
  };
  vi.mocked(archiveGraphClient).mockReturnValue({ api } as unknown as ReturnType<typeof archiveGraphClient>);
}

const CONTRACT = bytes('%PDF supplier contract');
const AGREEMENT = bytes('%PDF signed agreement');
const SIGNATURE = bytes('PNG signature');

const COLUMNS = [{ name: 'Title', readOnly: false }];
const GRAPH_ROUTES: Array<[string, string | RegExp, unknown]> = [
  ['GET', '/sites/kalfarsvp.sharepoint.com:/sites/KALFARSVP', { id: 'site-1' }],
  ['GET', '/sites/site-1/lists?', { value: [
    { id: 'l-c', displayName: 'Contracts' },
    { id: 'l-w', displayName: 'Contracts-Working' },
    { id: 'l-a', displayName: 'Customer-Agreements' },
  ] }],
  ['GET', '/sites/site-1/lists/l-c/drive', { id: 'd-c' }],
  ['GET', '/sites/site-1/lists/l-w/drive', { id: 'd-w' }],
  ['GET', '/sites/site-1/lists/l-a/drive', { id: 'd-a' }],
  ['GET', /^\/sites\/site-1\/lists\/l-[cwa]\/columns/, { value: COLUMNS }],
  ['GET', '/drives/d-c/root/children', { value: [{ id: 'c1', name: 'C.pdf', file: {}, size: CONTRACT.byteLength, listItem: { fields: {} } }] }],
  ['GET', '/drives/d-w/root/children', { value: [] }],
  ['GET', '/drives/d-a/root/children', { value: [{ id: 'a1', name: 'A.pdf', file: {}, size: AGREEMENT.byteLength, listItem: { fields: {} } }] }],
  ['GET', '/drives/d-c/items/c1/content', () => toAB(CONTRACT)],
  ['GET', '/drives/d-a/items/a1/content', () => toAB(AGREEMENT)],
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

describe('listSupabaseObjects', () => {
  it('walks nested folders and returns leaf objects with their size', async () => {
    mockStorage([
      { path: 'ev1/camp1/agreement-x.pdf', body: AGREEMENT },
      { path: 'ev1/camp1/signature-x.png', body: SIGNATURE },
      { path: 'ev2/camp2/agreement-y.pdf', body: AGREEMENT },
    ]);
    const admin = createAdminClient();
    const objects = await listSupabaseObjects(admin, 'id-documents');
    expect(objects.map((o) => o.path).sort()).toEqual([
      'ev1/camp1/agreement-x.pdf',
      'ev1/camp1/signature-x.png',
      'ev2/camp2/agreement-y.pdf',
    ]);
    expect(objects.every((o) => o.size > 0)).toBe(true);
  });
});

describe('runArchiveBackupSweep', () => {
  it('backs up both SharePoint and the files already in Supabase, and writes one manifest', async () => {
    const { uploads } = mockStorage([
      { path: 'ev1/camp1/agreement-x.pdf', body: AGREEMENT },
      { path: 'ev1/camp1/signature-x.png', body: SIGNATURE },
    ]);
    mockGraph(GRAPH_ROUTES);

    const r = await runArchiveBackupSweep(NOW_MS);

    // 1 contract + 1 agreement from SharePoint, 2 objects from Supabase.
    expect(r.scanned).toBe(4);
    expect(r.errors).toBe(0);
    expect(r.manifestPath).toBe('manifests/2026-09-06.json');

    const objectUploads = uploads.filter((u) => u.path.startsWith('objects/'));
    // AGREEMENT appears twice (SharePoint copy + Supabase original) → stored once.
    expect(objectUploads).toHaveLength(3);
    expect(r.uploaded).toBe(3);
    expect(r.deduped).toBe(1);
    expect(objectUploads.map((u) => u.path)).toContain(objectPath(sha(CONTRACT)));
    expect(objectUploads.map((u) => u.path)).toContain(objectPath(sha(SIGNATURE)));

    const manifest = JSON.parse(
      new TextDecoder().decode(uploads.find((u) => u.path.startsWith('manifests/'))!.body),
    );
    expect(manifest.entries).toHaveLength(4);
    const sources = manifest.entries.map((e: { source: string }) => e.source);
    expect(sources).toContain('sharepoint/Contracts/C.pdf');
    expect(sources).toContain('sharepoint/Customer-Agreements/A.pdf');
    expect(sources).toContain('supabase/id-documents/ev1/camp1/agreement-x.pdf');
    expect(sources).toContain('supabase/id-documents/ev1/camp1/signature-x.png');
    // Sorted, so identical content produces an identical manifest.
    expect(sources).toEqual([...sources].sort());
    expect(manifest.entries.find((e: { source: string }) => e.source === 'sharepoint/Contracts/C.pdf').sha256).toBe(sha(CONTRACT));
  });

  it('re-uploads nothing when every object is already stored', async () => {
    const already = [CONTRACT, AGREEMENT, SIGNATURE].map((b) => objectPath(sha(b)));
    const { uploads } = mockStorage(
      [{ path: 'ev1/camp1/signature-x.png', body: SIGNATURE }],
      already,
    );
    mockGraph(GRAPH_ROUTES);

    const r = await runArchiveBackupSweep(NOW_MS);

    expect(r.uploaded).toBe(0);
    expect(r.deduped).toBe(3);
    expect(r.bytesUploaded).toBe(0);
    expect(uploads.filter((u) => u.path.startsWith('objects/'))).toHaveLength(0);
    // The snapshot is still written — it records what existed at this point.
    expect(r.manifestPath).toBe('manifests/2026-09-06.json');
    expect(vi.mocked(sendSlackAlert).mock.calls[0]?.[0].level).toBe('info');
  });

  it('still backs up Supabase when SharePoint is not configured', async () => {
    process.env.SHAREPOINT_ARCHIVE_SITE = '';
    const { uploads } = mockStorage([{ path: 'ev1/camp1/agreement-x.pdf', body: AGREEMENT }]);
    mockGraph([]);

    const r = await runArchiveBackupSweep(NOW_MS);

    expect(r.scanned).toBe(1);
    expect(r.uploaded).toBe(1);
    expect(r.errors).toBe(0);
    expect(uploads.some((u) => u.path === objectPath(sha(AGREEMENT)))).toBe(true);
  });

  it('counts a failed source read as an error and still writes the rest', async () => {
    const { uploads } = mockStorage([{ path: 'ev1/camp1/agreement-x.pdf', body: AGREEMENT }]);
    mockGraph([
      ...GRAPH_ROUTES.filter(([, m]) => String(m) !== '/drives/d-c/items/c1/content'),
      ['GET', '/drives/d-c/items/c1/content', Object.assign(new Error('graph 503'), { statusCode: 503 })],
    ]);

    const r = await runArchiveBackupSweep(NOW_MS);

    expect(r.errors).toBe(1);
    expect(r.scanned).toBe(3);
    // The agreement (SharePoint) and the Supabase original are the same bytes.
    expect(r.uploaded).toBe(1);
    expect(r.manifestPath).toBe('manifests/2026-09-06.json');
    expect(uploads.some((u) => u.path === objectPath(sha(CONTRACT)))).toBe(false);
    expect(vi.mocked(sendSlackAlert).mock.calls[0]?.[0].level).toBe('error');
  });
});
