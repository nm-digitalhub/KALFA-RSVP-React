import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';

// Admission (package-outreach-admission-safety, task 1.1): confirming a WhatsApp-staged list inserts the guests through the
// same bulk insert as the screen import, rebuilds the event's contacts, and puts every contact up for a running package's
// outreach list (op add). reconcileCampaignSetForContact resolves on every answer, a full package (quota_full) included
// (src/lib/data/reconcile.test.ts), so the guests stay imported.

// safe-action.ts (the actions' client) imports the server-only guard, which throws outside a server bundle.
vi.mock('server-only', () => ({}));
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
import { applyGuestMerge, bulkInsertGuests, findImportMatches, listGroups } from '@/lib/data/guests';
import { buildContactsForEvent, reconcileCampaignSetForContact } from '@/lib/data/contacts';
import type { StagedRow } from '@/lib/data/whatsapp-import';
import { GENERIC_ACTION_ERROR } from '@/lib/safe-action';
import { confirmWhatsappImportAction, discardWhatsappImportAction } from './actions';

// The bound event and staging ids are validated (bindArgsSchemas: z.uuid()).
const E1 = '11111111-1111-4111-8111-111111111111';
const S1 = '55555555-5555-4555-8555-555555555555';

const ROWS: StagedRow[] = [
  { full_name: 'דנה', phone: '+972501111111', expected_count: 2, group: '' },
  { full_name: 'יוסי', phone: '+972502222222', expected_count: null, group: '' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEventAccess).mockResolvedValue(undefined as never);
  const staging = createMockSupabase({ data: { id: S1, rows: ROWS, status: 'pending' }, error: null });
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
    const result = await confirmWhatsappImportAction(E1, S1, {}, new FormData());

    expect(result).toEqual({ data: { notice: 'יובאו 2 מוזמנים.' } });
    expect(reconcileCampaignSetForContact).toHaveBeenCalledTimes(2);
    expect(reconcileCampaignSetForContact).toHaveBeenNthCalledWith(1, E1, 'add', 'c1');
    expect(reconcileCampaignSetForContact).toHaveBeenNthCalledWith(2, E1, 'add', 'c2');
  });

  it('still reports the guests as imported when the package is full (the admission resolves)', async () => {
    vi.mocked(reconcileCampaignSetForContact).mockResolvedValue(undefined);

    const result = await confirmWhatsappImportAction(E1, S1, {}, new FormData());

    expect(result).toEqual({ data: { notice: 'יובאו 2 מוזמנים.' } });
    expect(bulkInsertGuests).toHaveBeenCalledTimes(1);
  });
});

// The actions are built from the shared next-safe-action client (src/lib/safe-action.ts). The confirm form's merge
// checkboxes are named by guest id, so they must still reach the body; and a list that is no longer pending still gets
// its own message, not the generic failure of the step around it.
describe('the next-safe-action results keep the old behavior', () => {
  const GUEST = '77777777-7777-4777-8777-777777777777';

  it('reads the owner’s merge choice from the confirm form', async () => {
    vi.mocked(findImportMatches).mockResolvedValue([
      { direction: 'name', rowIndex: 0, existingGuestId: GUEST, incomingName: 'דנה', existingName: 'דנה', addsPhone: '+972501111111', fields: [] },
    ]);
    const form = new FormData();
    form.set(`merge_${GUEST}`, 'on');

    const result = await confirmWhatsappImportAction(E1, S1, {}, form);

    expect(applyGuestMerge).toHaveBeenCalledWith(E1, GUEST, { phone: '+972501111111' });
    expect(result).toEqual({ data: { notice: 'יובאו 1 מוזמנים · אוחדו 1 לפי שם.' } });
  });

  it('a list that is no longer pending is answered with its own message (confirm and discard)', async () => {
    const gone = createMockSupabase({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(gone.client as unknown as Awaited<ReturnType<typeof createClient>>);

    expect(await confirmWhatsappImportAction(E1, S1, {}, new FormData())).toEqual({
      serverError: 'הרשימה כבר טופלה או שאינה זמינה.',
    });
    expect(await discardWhatsappImportAction(E1, S1, {}, new FormData())).toEqual({ serverError: 'הרשימה כבר טופלה.' });
    expect(bulkInsertGuests).not.toHaveBeenCalled();
  });

  it('checks access before anything sent is validated (confirm and discard)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await confirmWhatsappImportAction(E1, 'not-an-id', {}, new FormData())).toEqual({
      serverError: GENERIC_ACTION_ERROR,
    });
    expect(await discardWhatsappImportAction(E1, 'not-an-id', {}, new FormData())).toEqual({
      serverError: GENERIC_ACTION_ERROR,
    });
    expect(requireEventAccess).toHaveBeenCalledTimes(2);
    expect(requireEventAccess).toHaveBeenNthCalledWith(1, E1, 'guests', 'create');
    expect(requireEventAccess).toHaveBeenNthCalledWith(2, E1, 'guests', 'create');
    expect(createClient).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('a discard whose access check fails (not a redirect / not-found) keeps its fixed message', async () => {
    vi.mocked(requireEventAccess).mockRejectedValue(new Error('db down'));

    expect(await discardWhatsappImportAction(E1, S1, {}, new FormData())).toEqual({ serverError: 'המחיקה נכשלה.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('discards a pending list', async () => {
    expect(await discardWhatsappImportAction(E1, S1, {}, new FormData())).toEqual({ data: { notice: 'הרשימה נמחקה.' } });
    expect(requireEventAccess).toHaveBeenCalledWith(E1, 'guests', 'create');
  });
});
