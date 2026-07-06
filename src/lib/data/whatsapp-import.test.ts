import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppText: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://beta.kalfa.me${p}`) }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import {
  buildAmbiguousEventReply,
  buildSingleEventReply,
  contactsToStagedRows,
  eventImportLabel,
  parseCsvToStagedRows,
  stageWhatsAppImport,
} from './whatsapp-import';

describe('contactsToStagedRows', () => {
  it('maps the REAL Cloud API contacts payload shape (name + first phone)', () => {
    const rows = contactsToStagedRows({
      contacts: [
        {
          name: { first_name: 'Jane', formatted_name: 'Jane Doe', last_name: 'Doe' },
          phones: [{ phone: '+972 50-123-4567', type: 'MOBILE', wa_id: '972501234567' }],
          vcard: '...',
        },
        { name: { formatted_name: 'בלי טלפון' }, phones: [] },
        { phones: [{ phone: '0521111111' }] }, // no name → skipped
      ],
    } as never);

    expect(rows).toEqual([
      { full_name: 'Jane Doe', phone: '0501234567', expected_count: null, group: '' },
      { full_name: 'בלי טלפון', phone: null, expected_count: null, group: '' },
    ]);
  });
});

describe('parseCsvToStagedRows', () => {
  it('parses with the shared header aliases, phone repair and per-row errors', () => {
    const csv = 'שם מלא,טלפון,כמות\nמשפחת כהן,501234567,4\nריק,12345,\n';
    const out = parseCsvToStagedRows(new TextEncoder().encode(csv));
    if ('error' in out) throw new Error('unexpected');
    expect(out.rows).toEqual([
      { full_name: 'משפחת כהן', phone: '0501234567', expected_count: 4, group: '' },
    ]);
    expect(out.errors).toHaveLength(1);
  });

  it('rejects an xlsx binary with a Hebrew instruction', () => {
    const out = parseCsvToStagedRows(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect('error' in out && out.error).toContain('CSV UTF-8');
  });
});

describe('eventImportLabel', () => {
  it('prefers the owner title, falls back to the Hebrew type label', () => {
    expect(eventImportLabel({ id: 'e1', name: 'החתונה שלנו', event_type: 'wedding' })).toBe('החתונה שלנו');
    expect(eventImportLabel({ id: 'e1', name: '   ', event_type: 'brit' })).toBe('ברית');
    expect(eventImportLabel({ id: 'e1', name: null, event_type: 'wedding' })).toBe('חתונה');
  });
});

describe('buildSingleEventReply', () => {
  it('names the target event and links to its review screen', () => {
    const body = buildSingleEventReply(
      { id: 'abc', name: 'ברית של נועם', event_type: 'brit' },
      40,
      2,
      'https://beta.kalfa.me',
    );
    expect(body).toContain('ברית של נועם');
    expect(body).toContain('40');
    expect(body).toContain('2 עם שגיאות');
    expect(body).toContain('https://beta.kalfa.me/app/events/abc/guests/import/whatsapp');
  });

  it('omits the error clause when there are no row errors', () => {
    const body = buildSingleEventReply({ id: 'abc', name: 'x', event_type: 'brit' }, 5, 0, 'https://beta.kalfa.me');
    expect(body).not.toMatch(/שגיא/);
  });
});

describe('buildAmbiguousEventReply', () => {
  it('lists EVERY active event with its own import link and picks none', () => {
    const body = buildAmbiguousEventReply(
      [
        { id: 'a', name: 'ברית', event_type: 'brit' },
        { id: 'b', name: null, event_type: 'wedding' },
      ],
      'https://beta.kalfa.me',
    );
    // both events named (second via the type-label fallback)
    expect(body).toContain('ברית');
    expect(body).toContain('חתונה');
    // one distinct import link per event, and NOT a whatsapp review link
    expect(body).toContain('https://beta.kalfa.me/app/events/a/guests/import');
    expect(body).toContain('https://beta.kalfa.me/app/events/b/guests/import');
    expect(body).not.toContain('/guests/import/whatsapp');
  });
});

describe('stageWhatsAppImport', () => {
  it('ignores non-import message types without touching the DB', async () => {
    expect(await stageWhatsAppImport({ payload: { type: 'text', from: '972501111111' } as never })).toBe(false);
  });

  it('ignores an import from an UNKNOWN sender (no matching owner profile)', async () => {
    // Every query resolves to [] → no profile matches → not an import.
    const { client } = createMockSupabase<never[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await stageWhatsAppImport({
      payload: { type: 'document', from: '972500000000', document: { id: 'm1', filename: 'x.csv' } } as never,
    });
    expect(res).toBe(false);
  });
});
