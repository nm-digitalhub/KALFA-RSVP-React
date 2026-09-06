import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/storage/legal-docs', () => ({ downloadLegalDoc: vi.fn() }));
vi.mock('@/lib/microsoft/graph-client', () => ({
  graphClient: vi.fn(),
  graphConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { downloadLegalDoc } from '@/lib/storage/legal-docs';
import { graphClient, graphConfigured } from '@/lib/microsoft/graph-client';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  archiveFields,
  archiveFileName,
  decodeInternalName,
  israelDateOnly,
  retentionUntil,
  runAgreementArchiveSweep,
  translateFields,
  type ArchiveRow,
} from '@/lib/data/agreement-archive';

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

const NOW_MS = Date.parse('2026-09-06T09:00:00+00:00');

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('israelDateOnly', () => {
  it('pins the calendar day to Israel, not UTC', () => {
    // 22:30 UTC on 15 March is already 16 March (00:30 IST) in Israel.
    expect(israelDateOnly('2026-03-15T22:30:00Z')).toBe('2026-03-16');
    // Summer (UTC+3): 21:30 UTC on 20 Aug is 21 Aug in Israel.
    expect(israelDateOnly('2026-08-20T21:30:00Z')).toBe('2026-08-21');
  });

  it('returns null for an unparsable value instead of a bogus date', () => {
    expect(israelDateOnly('not-a-date')).toBeNull();
  });
});

describe('retentionUntil', () => {
  it('is 31 December of the anchor year + 7 (plan §5)', () => {
    expect(retentionUntil('2026-08-20T18:00:00Z')).toBe('2033-12-31');
  });

  it('uses the Israel year at a year boundary', () => {
    // 31 Dec 22:30 UTC = 1 Jan 00:30 in Israel → the NEXT tax year.
    expect(retentionUntil('2026-12-31T22:30:00Z')).toBe('2034-12-31');
  });
});

describe('archiveFileName', () => {
  it('follows YYYY-MM-DD_CA_<campaign8>_v<version>_<hash8>.pdf with ids only', () => {
    expect(
      archiveFileName({
        signedAt: '2026-07-15T10:00:00Z',
        campaignId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        agreementVersion: '2026-07-01 v3',
        contentHash: '0123456789abcdef'.repeat(4),
      }),
    ).toBe('2026-07-15_CA_a1b2c3d4_v2026-07-01-v3_01234567.pdf');
  });

  it('never emits non-ASCII from the version string', () => {
    const name = archiveFileName({
      signedAt: '2026-07-15T10:00:00Z',
      campaignId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      agreementVersion: 'גרסה 4',
      contentHash: 'ff'.repeat(32),
    });
    expect(name).toBe('2026-07-15_CA_a1b2c3d4_v4_ffffffff.pdf');
    expect(name).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe('decodeInternalName / translateFields', () => {
  it('decodes SharePoint _xHHHH_ escapes back to the logical name', () => {
    expect(decodeInternalName('_x0053_HA256')).toBe('SHA256');
    expect(decodeInternalName('Counterparty')).toBe('Counterparty');
    expect(decodeInternalName('_x05d0__x05d1_')).toBe('אב');
  });

  it('writes under the library internal name and passes unknown keys through', () => {
    const names = new Map([
      ['SHA256', '_x0053_HA256'],
      ['_x0053_HA256', '_x0053_HA256'],
      ['Title', 'Title'],
    ]);
    expect(translateFields({ SHA256: 'abc', Title: 't', Other: 'x' }, names)).toEqual({
      _x0053_HA256: 'abc',
      Title: 't',
      Other: 'x',
    });
  });
});

const ROW: ArchiveRow = {
  id: '11111111-1111-4111-8111-111111111111',
  campaign_id: 'c0ffee00-1111-4111-8111-111111111111',
  event_id: 'e0e0e0e0-1111-4111-8111-111111111111',
  signer_user_id: 'u0u0u0u0-1111-4111-8111-111111111111',
  agreement_version: 'v3',
  content_hash: 'ab'.repeat(32),
  pdf_ref: 'e0e0/c0ff/agreement-x.pdf',
  signed_at: '2026-07-15T10:00:00Z',
  verified_phone: '+972501234567',
  otp_verified_at: '2026-07-15T09:59:00Z',
  ip: '203.0.113.5',
  user_agent: 'Mozilla/5.0 (iPhone) Safari',
  signature_ref: 'e0e0/c0ff/signature-x.png',
  id_document_ref: null,
};

const CTX_FULL = {
  eventName: 'החתונה של דנה ויוסי',
  eventDate: '2026-08-20T16:00:00Z',
  eventVenue: 'אולמי הגן, ראשון לציון',
  signerName: 'דנה כהן',
  signerEmail: 'dana@example.com',
  signerPhone: '+972501234567',
  nowMs: NOW_MS,
};

describe('archiveFields', () => {
  it('maps the Contract content type: dates, retention, evidence and the customer details', () => {
    const fields = archiveFields(ROW, CTX_FULL);
    expect(fields.Title).toBe('הסכם לקוח c0ffee00 · דנה כהן');
    expect(fields.Counterparty).toBe('דנה כהן');
    expect(fields.ContractType).toBe('Customer-Agreement');
    expect(fields.EffectiveDate).toBe('2026-07-15T00:00:00Z');
    expect(fields.ExpiryDate).toBe('2026-08-20T00:00:00Z');
    expect(fields.RetentionUntil).toBe('2033-12-31T00:00:00Z');
    // Event on 20 Aug, "now" is 6 Sep → the agreement's event is over.
    expect(fields.Status).toBe('Expired');
    expect(fields.ExternalRef).toBe(ROW.campaign_id);
    expect(fields.SHA256).toBe(ROW.content_hash);
    expect(fields.DataClass).toBe('Personal-Data');
    // Owner ruling 2026-09-06: the COMPLETE evidence pack travels with the copy —
    // nothing omitted, PII included. Every key is present even when empty.
    const notes = fields.ArchiveNotes.split('\n');
    const expectKey = (k: string, v: string) => expect(notes).toContain(`${k}=${v}`);
    expectKey('signed_agreements.id', ROW.id);
    expectKey('agreement_version', 'v3');
    expectKey('signed_at', ROW.signed_at);
    expectKey('content_hash', ROW.content_hash);
    expectKey('pdf_ref', 'e0e0/c0ff/agreement-x.pdf');
    expectKey('signature_ref', 'e0e0/c0ff/signature-x.png');
    expectKey('id_document_ref', '');
    expectKey('campaign_id', ROW.campaign_id);
    expectKey('event_id', ROW.event_id);
    expectKey('event_name', 'החתונה של דנה ויוסי');
    expectKey('event_date', '2026-08-20T16:00:00Z');
    expectKey('event_venue', 'אולמי הגן, ראשון לציון');
    expectKey('signer_user_id', ROW.signer_user_id);
    expectKey('signer_name', 'דנה כהן');
    expectKey('signer_email', 'dana@example.com');
    expectKey('signer_profile_phone', '+972501234567');
    expectKey('verified_phone', '+972501234567');
    expectKey('otp_verified_at', '2026-07-15T09:59:00Z');
    expectKey('ip', '203.0.113.5');
    expectKey('user_agent', 'Mozilla/5.0 (iPhone) Safari');
    expect(notes).toHaveLength(20);
  });

  it('falls back to the signing date for retention and stays Active when the event is ahead', () => {
    const fields = archiveFields(ROW, {
      eventName: null,
      eventDate: null,
      eventVenue: null,
      signerName: null,
      signerEmail: null,
      signerPhone: null,
      nowMs: NOW_MS,
    });
    expect(fields.Title).toBe('הסכם לקוח c0ffee00');
    expect(fields.Counterparty).toBe('');
    expect(fields.ExpiryDate).toBeUndefined();
    expect(fields.RetentionUntil).toBe('2033-12-31T00:00:00Z');
    expect(fields.Status).toBe('Active');
  });
});

// ── The sweep ───────────────────────────────────────────────────────────────

const PDF = new Uint8Array(Buffer.from('%PDF-1.7 signed agreement bytes'));
const PDF_HASH = createHash('sha256').update(PDF).digest('hex');
const DRIVE = 'drive-1';

type GraphCall = { method: string; path: string; body?: unknown };

// A tiny Graph double: records every call and answers from a route table
// (path prefix → response or thrown error with statusCode).
function mockGraph(routes: Array<[method: string, match: string | RegExp, reply: unknown]>) {
  const calls: GraphCall[] = [];
  const answer = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    for (const [m, match, reply] of routes) {
      const hit = typeof match === 'string' ? path.startsWith(match) : match.test(path);
      if (m === method && hit) {
        if (reply instanceof Error) throw reply;
        return reply;
      }
    }
    throw Object.assign(new Error(`unrouted ${method} ${path}`), { statusCode: 500 });
  };
  const api = (path: string) => ({
    get: async () => answer('GET', path),
    put: async (b: unknown) => answer('PUT', path, b),
    patch: async (b: unknown) => answer('PATCH', path, b),
    post: async (b: unknown) => answer('POST', path, b),
  });
  vi.mocked(graphClient).mockReturnValue({ api } as unknown as ReturnType<typeof graphClient>);
  return calls;
}

const graphErr = (statusCode: number) => Object.assign(new Error(`graph ${statusCode}`), { statusCode });

// The library's REAL internal names (verified 2026-09-06): SharePoint escaped
// the site column SHA256 to _x0053_HA256 on the list.
const LIST_COLUMNS = [
  'Title',
  'Counterparty',
  'ContractType',
  'EffectiveDate',
  'ExpiryDate',
  'Status',
  'RetentionUntil',
  'ExternalRef',
  '_x0053_HA256',
  'DataClass',
  'ArchiveNotes',
].map((name) => ({ name, readOnly: false }));

const SITE_ROUTES: Array<[string, string | RegExp, unknown]> = [
  ['GET', '/sites/kalfarsvp.sharepoint.com:/sites/KALFARSVP', { id: 'site-1' }],
  ['GET', '/sites/site-1/lists?', { value: [{ id: 'list-1', displayName: 'Customer-Agreements' }] }],
  ['GET', '/sites/site-1/lists/list-1/drive', { id: DRIVE }],
  ['GET', '/sites/site-1/lists/list-1/columns', { value: [...LIST_COLUMNS, { name: 'ID', readOnly: true }] }],
  ['GET', `/drives/${DRIVE}/root:/2026?`, { id: 'folder-2026' }],
];

function dbRow(overrides: Partial<ArchiveRow> = {}): Row {
  return { ...ROW, content_hash: PDF_HASH, ...overrides };
}

// Sequence of awaited chains inside one sweep: (1) signed_agreements select,
// (2) events, (3) profiles, then one update per exported row.
function sequence(builder: MockQueryBuilder<Row>, rows: Row[], updateResults: Array<{ error: null | { message: string } }> = []) {
  let spy = vi
    .spyOn(builder, 'then')
    .mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: rows, error: null }))
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({
        data: [{ id: ROW.event_id, name: 'אירוע', event_date: '2026-08-20T16:00:00Z', venue_name: 'אולם' }],
        error: null,
      }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({
        data: [{ id: ROW.signer_user_id, full_name: 'דנה כהן', phone: '0501234567', phone_verified_e164: '+972501234567' }],
        error: null,
      }),
    );
  for (const r of updateResults) {
    spy = spy.mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: null, ...r }));
  }
  return spy;
}

function mockedAdmin(): { builder: MockQueryBuilder<Row> } {
  const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
  // The signer's sign-in email comes from auth.users (admin API), not profiles.
  const withAuth = Object.assign(client, {
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: 'dana@example.com' } }, error: null })),
      },
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(withAuth as unknown as Admin);
  return { builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHAREPOINT_ARCHIVE_SITE = 'kalfarsvp.sharepoint.com:/sites/KALFARSVP';
  vi.mocked(graphConfigured).mockReturnValue(true);
  vi.mocked(downloadLegalDoc).mockResolvedValue(PDF);
});

afterEach(() => {
  delete process.env.SHAREPOINT_ARCHIVE_SITE;
});

describe('runAgreementArchiveSweep', () => {
  it('is a no-op without the archive site configured — no DB read, no Graph call', async () => {
    process.env.SHAREPOINT_ARCHIVE_SITE = '';
    const { builder } = mockedAdmin();
    const calls = mockGraph([]);
    const result = await runAgreementArchiveSweep(NOW_MS);
    expect(result).toEqual({ exported: 0, skipped: 0, failed: 0 });
    expect(builder.select).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('verifies the hash, uploads under the signing year, writes metadata and marks the row', async () => {
    const { builder } = mockedAdmin();
    sequence(builder, [dbRow()], [{ error: null }]);
    const calls = mockGraph([
      ...SITE_ROUTES,
      ['PUT', `/drives/${DRIVE}/root:/2026/`, { id: 'item-1' }],
      ['PATCH', `/drives/${DRIVE}/items/item-1/listItem/fields`, {}],
    ]);

    const result = await runAgreementArchiveSweep(NOW_MS);

    expect(result).toEqual({ exported: 1, skipped: 0, failed: 0 });
    expect(downloadLegalDoc).toHaveBeenCalledWith(ROW.pdf_ref);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe(
      `/drives/${DRIVE}/root:/2026/2026-07-15_CA_c0ffee00_vv3_${PDF_HASH.slice(0, 8)}.pdf:/content?@microsoft.graph.conflictBehavior=fail`,
    );
    const patch = calls.find((c) => c.method === 'PATCH');
    const body = patch?.body as Record<string, string>;
    // Written under the library's escaped internal name, never the logical one.
    expect(body._x0053_HA256).toBe(PDF_HASH);
    expect(body).not.toHaveProperty('SHA256');
    expect(body.Counterparty).toBe('דנה כהן');
    // Full evidence pack, including the auth email and the profile phone.
    expect(body.ArchiveNotes).toContain('signer_email=dana@example.com');
    expect(body.ArchiveNotes).toContain('signer_profile_phone=+972501234567');
    expect(body.ArchiveNotes).toContain('event_venue=אולם');
    expect(body.ArchiveNotes).toContain(`pdf_ref=${ROW.pdf_ref}`);
    // Marked only after upload + metadata, and only if still unexported.
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ sharepoint_item_id: 'item-1', sharepoint_exported_at: new Date(NOW_MS).toISOString() }),
    );
    expect(builder.eq).toHaveBeenCalledWith('id', ROW.id);
    expect(builder.is).toHaveBeenCalledWith('sharepoint_exported_at', null);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('refuses to archive a PDF whose bytes do not match content_hash, alerts with ids only', async () => {
    const { builder } = mockedAdmin();
    sequence(builder, [dbRow({ content_hash: 'ee'.repeat(32) })]);
    const calls = mockGraph(SITE_ROUTES);

    const result = await runAgreementArchiveSweep(NOW_MS);

    expect(result).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(builder.update).not.toHaveBeenCalled();
    const alert = vi.mocked(sendSlackAlert).mock.calls[0]?.[0];
    expect(alert?.level).toBe('error');
    expect(JSON.stringify(alert)).not.toContain('+972501234567');
    expect(JSON.stringify(alert)).toContain(ROW.id);
  });

  it('adopts a file a crashed previous run already uploaded when its recorded hash matches', async () => {
    const { builder } = mockedAdmin();
    sequence(builder, [dbRow()], [{ error: null }]);
    const calls = mockGraph([
      ...SITE_ROUTES,
      ['PUT', `/drives/${DRIVE}/root:/2026/`, graphErr(409)],
      ['GET', new RegExp(`^/drives/${DRIVE}/root:/2026/.*\\.pdf\\?`), {
        id: 'item-old',
        size: PDF.byteLength,
        listItem: { fields: { _x0053_HA256: PDF_HASH } },
      }],
      ['PATCH', `/drives/${DRIVE}/items/item-old/listItem/fields`, {}],
    ]);

    const result = await runAgreementArchiveSweep(NOW_MS);

    expect(result).toEqual({ exported: 1, skipped: 0, failed: 0 });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ sharepoint_item_id: 'item-old' }));
  });

  it('leaves the row unmarked when Graph fails, so the next tick retries', async () => {
    const { builder } = mockedAdmin();
    sequence(builder, [dbRow()]);
    mockGraph([...SITE_ROUTES, ['PUT', `/drives/${DRIVE}/root:/2026/`, graphErr(503)]]);

    const result = await runAgreementArchiveSweep(NOW_MS);

    expect(result).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(builder.update).not.toHaveBeenCalled();
    expect(vi.mocked(sendSlackAlert).mock.calls[0]?.[0].level).toBe('error');
  });

  it('counts a row with no stored PDF as skipped and never marks it', async () => {
    const { builder } = mockedAdmin();
    sequence(builder, [dbRow({ pdf_ref: null })]);
    const calls = mockGraph(SITE_ROUTES);

    const result = await runAgreementArchiveSweep(NOW_MS);

    expect(result).toEqual({ exported: 0, skipped: 1, failed: 0 });
    expect(downloadLegalDoc).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(builder.update).not.toHaveBeenCalled();
  });
});
