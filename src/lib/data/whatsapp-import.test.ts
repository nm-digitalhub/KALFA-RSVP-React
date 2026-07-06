import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppText: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://beta.kalfa.me${p}`) }));

import { contactsToStagedRows, parseCsvToStagedRows, stageWhatsAppImport } from './whatsapp-import';

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

describe('stageWhatsAppImport', () => {
  it('ignores non-import message types without touching the DB', async () => {
    expect(await stageWhatsAppImport({ payload: { type: 'text', from: '972501111111' } as never })).toBe(false);
  });
});
