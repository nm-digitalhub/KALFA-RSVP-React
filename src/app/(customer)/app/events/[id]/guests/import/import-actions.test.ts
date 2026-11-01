import { beforeEach, describe, expect, it, vi } from 'vitest';

// safe-action.ts (the action's client) imports the server-only guard, which throws outside a server bundle.
vi.mock('server-only', () => ({}));
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
vi.mock('@/lib/data/contacts', () => ({
  buildContactsForEvent: vi.fn(),
  reconcileCampaignSetForContact: vi.fn(),
}));
// The action's OWN authorization gate. Mocked as a pass-through
// by default; the dedicated describe below flips it to prove it runs first.
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));

import { bulkInsertGuests, createGroup, listGroups } from '@/lib/data/guests';
import { requireEventAccess } from '@/lib/data/events';
import { buildContactsForEvent, reconcileCampaignSetForContact } from '@/lib/data/contacts';
import { GENERIC_ACTION_ERROR } from '@/lib/safe-action';
import { importGuestsAction } from './import-actions';
import { buildTemplateCsv } from '@/lib/guests/import-template';

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

// The bound event id is validated (bindArgsSchemas: z.uuid()).
const E1 = '11111111-1111-4111-8111-111111111111';

function fd(file: File): FormData {
  const f = new FormData();
  f.set('file', file);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations: re-arm the gate as a pass-through so a
  // rejecting gate in one test never leaks into the next.
  vi.mocked(requireEventAccess).mockResolvedValue(undefined as never);
  // Default shape matching the real return; individual tests override when
  // they care about it.
  vi.mocked(buildContactsForEvent).mockResolvedValue({
    guests: 0,
    withValidPhone: 0,
    uniqueContacts: 0,
    invalid: 0,
    contactIds: [],
  });
});

describe('importGuestsAction — its own authorization gate runs before any data access', () => {
  it('calls requireEventAccess(eventId, guests, create) before listGroups and before the service-role read', async () => {
    const order: string[] = [];
    vi.mocked(requireEventAccess).mockImplementation(async () => {
      order.push('gate');
      return undefined as never;
    });
    vi.mocked(listGroups).mockImplementation(async () => {
      order.push('listGroups');
      return [];
    });
    vi.mocked(bulkInsertGuests).mockResolvedValue(0);
    await importGuestsAction(E1, {}, fd(csvFile()));
    expect(requireEventAccess).toHaveBeenCalledWith(E1, 'guests', 'create');
    expect(order[0]).toBe('gate');
  });

  it('checks the upload only after the gate: no file is answered with its Hebrew message, gate first', async () => {
    const result = await importGuestsAction(E1, {}, new FormData());

    expect(requireEventAccess).toHaveBeenCalledWith(E1, 'guests', 'create');
    expect(result).toEqual({ serverError: 'נא לבחור קובץ CSV.' });
    expect(listGroups).not.toHaveBeenCalled();
  });

  it('runs before the input is validated: a bound id that fails validation still reaches the gate first', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await importGuestsAction('not-an-id', {}, fd(csvFile()));

    expect(requireEventAccess).toHaveBeenCalledWith('not-an-id', 'guests', 'create');
    expect(result).toEqual({ serverError: GENERIC_ACTION_ERROR });
    expect(listGroups).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('a NEXT_NOT_FOUND from the gate propagates and nothing else runs', async () => {
    vi.mocked(requireEventAccess).mockRejectedValue(NEXT_NOT_FOUND);
    await expect(
      importGuestsAction(E1, {}, fd(csvFile())),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(listGroups).not.toHaveBeenCalled();
  });
});

describe('importGuestsAction — Next.js control-flow signals from the ownership gate (listGroups)', () => {
  it('propagates a NEXT_REDIRECT from listGroups instead of returning { error }', async () => {
    vi.mocked(listGroups).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      importGuestsAction(E1, {}, fd(csvFile())),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('propagates a NEXT_NOT_FOUND from listGroups instead of returning { error }', async () => {
    vi.mocked(listGroups).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      importGuestsAction(E1, {}, fd(csvFile())),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(listGroups).mockRejectedValue(new Error('db down'));

    const result = await importGuestsAction(E1, {}, fd(csvFile()));

    expect(result).toEqual({ serverError: 'טעינת הקבוצות נכשלה.' });
  });
});

// --- Excel traps: encoding fallback, binary uploads, phone repair, count ---

const ascii = (s: string) => new TextEncoder().encode(s);

function fileOf(parts: BlobPart[], name = 'guests.csv'): File {
  return new File(parts, name, { type: 'text/csv' });
}

// Admission (package-outreach-admission-safety, task 1.1): after the rows are inserted and the contacts rebuilt, every
// imported contact is put up for a running package's outreach list (op add). reconcileCampaignSetForContact resolves on
// every answer, a full package (quota_full) included, so the import still reports the guests as imported.
describe('importGuestsAction — outreach list admission', () => {
  beforeEach(() => {
    vi.mocked(listGroups).mockResolvedValue([]);
    vi.mocked(bulkInsertGuests).mockImplementation(async (_eventId, rows) => rows.length);
    vi.mocked(buildContactsForEvent).mockResolvedValue({
      guests: 2,
      withValidPhone: 2,
      uniqueContacts: 2,
      invalid: 0,
      contactIds: ['c1', 'c2'],
    });
  });

  it('asks to admit every contact of the event after the import (op add)', async () => {
    const result = await importGuestsAction(E1, {}, fd(csvFile()));

    expect(result.data).toMatchObject({ done: true, imported: 1, failed: [] });
    expect(reconcileCampaignSetForContact).toHaveBeenCalledTimes(2);
    expect(reconcileCampaignSetForContact).toHaveBeenNthCalledWith(1, E1, 'add', 'c1');
    expect(reconcileCampaignSetForContact).toHaveBeenNthCalledWith(2, E1, 'add', 'c2');
  });

  it('still reports the guests as imported when the package is full (the admission resolves)', async () => {
    vi.mocked(reconcileCampaignSetForContact).mockResolvedValue(undefined);

    const result = await importGuestsAction(E1, {}, fd(csvFile()));

    expect(result.data).toMatchObject({ done: true, imported: 1, failed: [] });
  });
});

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

    const result = await importGuestsAction(E1, {}, fd(fileOf([bytes])));

    expect(result.data).toMatchObject({ done: true, imported: 1, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith(E1, [
      expect.objectContaining({ full_name: 'דנה', phone: '0501234567' }),
    ]);
  });

  it('rejects an .xlsx upload with a specific save-as-CSV instruction', async () => {
    const xlsxMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    const result = await importGuestsAction(
      E1,
      {},
      fd(fileOf([xlsxMagic], 'guests.xlsx')),
    );

    expect(result.serverError).toContain('CSV UTF-8');
    expect(bulkInsertGuests).not.toHaveBeenCalled();
  });

  it('repairs a phone that lost its leading zero in Excel', async () => {
    const result = await importGuestsAction(
      E1,
      {},
      fd(fileOf(['שם,טלפון\nדנה,501234567\n'])),
    );

    expect(result.data).toMatchObject({ done: true, imported: 1, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith(E1, [
      expect.objectContaining({ phone: '0501234567' }),
    ]);
  });

  it('still reports a truly invalid phone per-row (repair must not mask errors)', async () => {
    const result = await importGuestsAction(
      E1,
      {},
      fd(fileOf(['שם,טלפון\nדנה,12345\n'])),
    );

    expect(result.data?.imported).toBe(0);
    expect(result.data?.failed).toHaveLength(1);
    expect(bulkInsertGuests).not.toHaveBeenCalled();
  });

  it('maps the כמות column, and an EMPTY count stays null — never 0', async () => {
    const result = await importGuestsAction(
      E1,
      {},
      fd(fileOf(['שם מלא,טלפון,כמות\nמשפחת כהן,0501234567,4\nסבתא רחל,,\n'])),
    );

    expect(result.data).toMatchObject({ done: true, imported: 2, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith(E1, [
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
      E1,
      {},
      fd(fileOf([buildTemplateCsv()], 'template.csv')),
    );

    expect(result.data).toMatchObject({ done: true, imported: 3, failed: [] });
    expect(bulkInsertGuests).toHaveBeenCalledWith(E1, [
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
      E1,
      {},
      fd(fileOf(['שם,טלפון\nדנה,0501234567\nיוסי,+972501234567\n'])),
    );

    expect(result.data).toMatchObject({ done: true, imported: 1 });
    expect(result.data?.failed[0]?.row).toBe(2);
    expect(result.data?.failed[0]?.message).toContain('כפול בקובץ');
  });

  it('a phone already on an existing guest becomes a row error naming them', async () => {
    const adminMock = (await import('@/lib/supabase/admin')) as unknown as {
      __setExistingGuests: (rows: Array<{ full_name: string; phone: string }>) => void;
    };
    adminMock.__setExistingGuests([{ full_name: 'משפחת כהן', phone: '0501234567' }]);

    const result = await importGuestsAction(
      E1,
      {},
      fd(fileOf(['שם,טלפון\nדנה,050-123-4567\n'])),
    );
    adminMock.__setExistingGuests([]);

    expect(result.data?.imported).toBe(0);
    expect(result.data?.failed[0]?.message).toContain('משפחת כהן');
  });
});

it('returns a fixed error for malformed CSV and inserts no guests', async () => {
  const file = new File(['name,phone\n"unfinished,0501234567'], 'bad.csv', { type: 'text/csv' });
  const result = await importGuestsAction(E1, {}, fd(file));
  expect(result.serverError).toContain('CSV UTF-8');
  expect(bulkInsertGuests).not.toHaveBeenCalled();
});
