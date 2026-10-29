import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';

// Admission (package-outreach-admission-safety, task 1.1): confirming a WhatsApp-staged list inserts the guests through the
// same bulk insert as the screen import, rebuilds the event's contacts, and puts every contact up for a running package's
// outreach list (op add). reconcileCampaignSetForContact resolves on every answer, a full package (quota_full) included
// (src/lib/data/reconcile.test.ts), so the guests stay imported.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/guests', () => ({
  applyGuestMerge: vi.fn(),
  bulkInsertGuests: vi.fn(),
  createGroup: vi.fn(),
  findImportMatches: vi.fn(),
  listGroups: vi.fn(),
}));
vi.mock('@/lib/data/contacts', () => ({
  buildContactsForEvent: vi.fn(),
  reconcileCampaignSetForContact: vi.fn(),
}));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { requireEventAccess } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { bulkInsertGuests, findImportMatches, listGroups } from '@/lib/data/guests';
import { buildContactsForEvent, reconcileCampaignSetForContact } from '@/lib/data/contacts';
import type { StagedRow } from '@/lib/data/whatsapp-import';
import { confirmWhatsappImportAction } from './actions';

const ROWS: StagedRow[] = [
  { full_name: 'דנה', phone: '+972501111111', expected_count: 2, group: '' },
  { full_name: 'יוסי', phone: '+972502222222', expected_count: null, group: '' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEventAccess).mockResolvedValue(undefined as never);
  const staging = createMockSupabase({ data: { id: 's-1', rows: ROWS, status: 'pending' }, error: null });
  vi.mocked(createClient).mockResolvedValue(staging.client as unknown as Awaited<ReturnType<typeof createClient>>);
  const admin = createMockSupabase({ data: null, error: null });
  vi.mocked(createAdminClient).mockReturnValue(admin.client as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(listGroups).mockResolvedValue([]);
  vi.mocked(findImportMatches).mockResolvedValue([]);
  vi.mocked(bulkInsertGuests).mockImplementation(async (_eventId, rows) => rows.length);
  vi.mocked(buildContactsForEvent).mockResolvedValue({
    guests: 2,
    withValidPhone: 2,
    uniqueContacts: 2,
    invalid: 0,
    contactIds: ['c1', 'c2'],
  });
});

describe('confirmWhatsappImportAction — outreach list admission', () => {
  it('asks to admit every contact of the event after the import (op add)', async () => {
    const result = await confirmWhatsappImportAction('e-1', 's-1', null, new FormData());

    expect(result).toEqual({ notice: 'יובאו 2 מוזמנים.' });
    expect(reconcileCampaignSetForContact).toHaveBeenCalledTimes(2);
    expect(reconcileCampaignSetForContact).toHaveBeenNthCalledWith(1, 'e-1', 'add', 'c1');
    expect(reconcileCampaignSetForContact).toHaveBeenNthCalledWith(2, 'e-1', 'add', 'c2');
  });

  it('still reports the guests as imported when the package is full (the admission resolves)', async () => {
    vi.mocked(reconcileCampaignSetForContact).mockResolvedValue(undefined);

    const result = await confirmWhatsappImportAction('e-1', 's-1', null, new FormData());

    expect(result).toEqual({ notice: 'יובאו 2 מוזמנים.' });
    expect(bulkInsertGuests).toHaveBeenCalledTimes(1);
  });
});
