import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => {
  const existing: { data: Array<{ full_name: string; phone: string }> | null } = { data: [] };
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    not: () => Promise.resolve(existing),
  };
  return {
    createAdminClient: () => chain,
    __setExistingGuests: (rows: Array<{ full_name: string; phone: string }>) => {
      existing.data = rows;
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/guests', () => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  bulkInsertGuests: vi.fn(),
}));
vi.mock('@/lib/data/contacts', () => ({ buildContactsForEvent: vi.fn() }));

import { bulkInsertGuests, createGroup, listGroups } from '@/lib/data/guests';
import { importGuestsAction } from './import-actions';
import { buildTemplateCsv } from './template-content';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});
// Real notFound() digest format (verified against node_modules/next/dist/
// client/components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

function csvFile(): File {
  return new File(['name,phone\nדנה,0501234567\n'], 'guests.csv', {
    type: 'text/csv',
  });
}

function fd(file: File): FormData {
  const f = new FormData();
  f.set('file', file);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('importGuestsAction — Next.js control-flow signals from the ownership gate (listGroups)', () => {
  it('propagates a NEXT_REDIRECT from listGroups instead of returning { error }', async () => {
    vi.mocked(listGroups).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      importGuestsAction('e-1', null, fd(csvFile())),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('propagates a NEXT_NOT_FOUND from listGroups instead of returning { error }', async () => {
    vi.mocked(listGroups).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      importGuestsAction('e-1', null, fd(csvFile())),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(listGroups).mockRejectedValue(new Error('db down'));

    const result = await importGuestsAction('e-1', null, fd(csvFile()));

    expect(result).toEqual({ error: 'טעינת הקבוצות נכשלה.' });
  });
});

// --- Excel traps: encoding fallback, binary uploads, phone repair, count ---

const ascii = (s: string) => new TextEncoder().encode(s);

function fileOf(parts: BlobPart[], name = 'guests.csv'): File {
  return new File(parts, name, { type: 'text/csv' });
}

describe('importGuestsAction — Excel traps', () => {
  beforeEach(() => {
    vi.mocked(listGroups).mockResolvedValue([]);
    vi.mocked(bulkInsertGuests).mockImplementation(
      async (_eventId, rows) => rows.length,
    );
  });

  it('imports a Hebrew windows-1255 (ANSI Excel) file with names intact', async () => {
    // 'דנה' in windows-1255 is E3 F0 E4 — invalid as UTF-8, so the decoder
    // must fall back instead of importing mojibake.
    const bytes = new Uint8Array([
      ...ascii('name,phone\n'),
      0xe3, 0xf0, 0xe4,
      ...ascii(',0501234567\n'),
    ]);

    const result = await importGuestsAction('e-1', null, fd(fileOf([bytes])));

    expect(result).toMatchObject({ done: true, imported: 1, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith('e-1', [
      expect.objectContaining({ full_name: 'דנה', phone: '0501234567' }),
    ]);
  });

  it('rejects an .xlsx upload with a specific save-as-CSV instruction', async () => {
    const xlsxMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    const result = await importGuestsAction(
      'e-1',
      null,
      fd(fileOf([xlsxMagic], 'guests.xlsx')),
    );

    expect(result?.error).toContain('CSV UTF-8');
    expect(bulkInsertGuests).not.toHaveBeenCalled();
  });

  it('repairs a phone that lost its leading zero in Excel', async () => {
    const result = await importGuestsAction(
      'e-1',
      null,
      fd(fileOf(['שם,טלפון\nדנה,501234567\n'])),
    );

    expect(result).toMatchObject({ done: true, imported: 1, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith('e-1', [
      expect.objectContaining({ phone: '0501234567' }),
    ]);
  });

  it('still reports a truly invalid phone per-row (repair must not mask errors)', async () => {
    const result = await importGuestsAction(
      'e-1',
      null,
      fd(fileOf(['שם,טלפון\nדנה,12345\n'])),
    );

    expect(result?.imported).toBe(0);
    expect(result?.failed).toHaveLength(1);
    expect(bulkInsertGuests).not.toHaveBeenCalled();
  });

  it('maps the כמות column, and an EMPTY count stays null — never 0', async () => {
    const result = await importGuestsAction(
      'e-1',
      null,
      fd(fileOf(['שם מלא,טלפון,כמות\nמשפחת כהן,0501234567,4\nסבתא רחל,,\n'])),
    );

    expect(result).toMatchObject({ done: true, imported: 2, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith('e-1', [
      expect.objectContaining({ full_name: 'משפחת כהן', expected_count: 4 }),
      expect.objectContaining({ full_name: 'סבתא רחל', expected_count: null }),
    ]);
  });
});

describe('the downloadable template round-trips through the import', () => {
  it('imports every sample row with zero failures', async () => {
    vi.mocked(listGroups).mockResolvedValue([]);
    vi.mocked(createGroup).mockImplementation(
      async (_eventId, input) =>
        ({ id: `g-${input.name}`, name: input.name }) as Awaited<
          ReturnType<typeof createGroup>
        >,
    );
    vi.mocked(bulkInsertGuests).mockImplementation(
      async (_eventId, rows) => rows.length,
    );

    const result = await importGuestsAction(
      'e-1',
      null,
      fd(fileOf([buildTemplateCsv()], 'template.csv')),
    );

    expect(result).toMatchObject({ done: true, imported: 3, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith('e-1', [
      expect.objectContaining({
        full_name: 'משפחת כהן',
        phone: '0501234567',
        expected_count: 4,
      }),
      expect.objectContaining({ full_name: 'דנה לוי', expected_count: 2 }),
      expect.objectContaining({
        full_name: 'סבתא רחל',
        phone: null,
        expected_count: 1,
      }),
    ]);
  });
});


describe('importGuestsAction — one guest per phone', () => {
  beforeEach(() => {
    vi.mocked(listGroups).mockResolvedValue([]);
    vi.mocked(bulkInsertGuests).mockImplementation(async (_e, rows) => rows.length);
  });

  it('a duplicate inside the file becomes a row error naming the first row', async () => {
    const result = await importGuestsAction(
      'e-1',
      null,
      fd(fileOf(['שם,טלפון\nדנה,0501234567\nיוסי,+972501234567\n'])),
    );

    expect(result).toMatchObject({ done: true, imported: 1 });
    expect(result?.failed?.[0]?.row).toBe(2);
    expect(result?.failed?.[0]?.message).toContain('כפול בקובץ');
  });

  it('a phone already on an existing guest becomes a row error naming them', async () => {
    const adminMock = (await import('@/lib/supabase/admin')) as unknown as {
      __setExistingGuests: (rows: Array<{ full_name: string; phone: string }>) => void;
    };
    adminMock.__setExistingGuests([{ full_name: 'משפחת כהן', phone: '0501234567' }]);

    const result = await importGuestsAction(
      'e-1',
      null,
      fd(fileOf(['שם,טלפון\nדנה,050-123-4567\n'])),
    );
    adminMock.__setExistingGuests([]);

    expect(result?.imported).toBe(0);
    expect(result?.failed?.[0]?.message).toContain('משפחת כהן');
  });
});
