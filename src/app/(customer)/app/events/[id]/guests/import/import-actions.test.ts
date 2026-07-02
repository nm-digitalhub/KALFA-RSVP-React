import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { listGroups } from '@/lib/data/guests';
import { importGuestsAction } from './import-actions';

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
