import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wiring tests for B1: every guest-write action must keep the contacts table
// (billing source-of-truth) in sync, and a sync failure must NOT fail the
// already-committed guest mutation (best-effort contract).

// safe-action.ts (the actions' client) imports the server-only guard, which throws outside a server bundle.
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it.
// Keep the real `unstable_rethrow` (via importOriginal) so it still recognizes
// this fake NEXT_REDIRECT digest exactly as it would a real one.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn(() => {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/x;307;',
      });
    }),
  };
});
vi.mock('@/lib/data/guests', () => ({
  PHONE_TAKEN_ERROR: 'מספר הטלפון כבר קיים אצל מוזמן אחר באירוע',
  GROUP_NAME_TAKEN_ERROR: 'קבוצה בשם זה כבר קיימת באירוע',
  createGuest: vi.fn(),
  updateGuest: vi.fn(),
  deleteGuest: vi.fn(),
  fillMissingExpectedCount: vi.fn(),
  updateContactStatus: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock('@/lib/data/contacts', () => ({ linkGuestContact: vi.fn(), reconcileCampaignSetForContact: vi.fn() }));
// rsvp-links.ts is `server-only`; mock it so importing the action module under
// test doesn't pull the server-only guard into the Node test env.
vi.mock('@/lib/data/rsvp-links', () => ({
  revokeRsvpToken: vi.fn(),
  regenerateRsvpToken: vi.fn(),
}));

import {
  createGuest,
  deleteGuest,
  updateGuest,
  fillMissingExpectedCount,
  updateContactStatus,
  PHONE_TAKEN_ERROR,
} from '@/lib/data/guests';
import { linkGuestContact, reconcileCampaignSetForContact } from '@/lib/data/contacts';
import {
  createGuestAction,
  updateGuestAction,
  deleteGuestAction,
  setContactStatusAction,
  createGroupAction,
  updateGroupAction,
  fillMissingExpectedCountAction,
} from './guests-actions';
import { createGroup, updateGroup } from '@/lib/data/guests';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

// The bound event and guest ids are validated (bindArgsSchemas: z.uuid()).
const E1 = '11111111-1111-4111-8111-111111111111';
const G9 = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createGuestAction → contact sync', () => {
  it('links the newly created guest to its contact, then redirects', async () => {
    vi.mocked(createGuest).mockResolvedValue({
      id: 'g-1',
    } as unknown as Awaited<ReturnType<typeof createGuest>>);

    await expect(
      createGuestAction(E1, {}, fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(createGuest).toHaveBeenCalled();
    expect(linkGuestContact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(linkGuestContact).mock.calls[0].slice(0, 2)).toEqual([
      E1,
      'g-1',
    ]);
  });

  it('still redirects when the contact sync fails (best-effort, no throw)', async () => {
    vi.mocked(createGuest).mockResolvedValue({
      id: 'g-2',
    } as unknown as Awaited<ReturnType<typeof createGuest>>);
    vi.mocked(linkGuestContact).mockRejectedValue(new Error('sync boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      createGuestAction(E1, {}, fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    errSpy.mockRestore();
  });
});

// Admission (package-outreach-admission-safety, task 1.1): a single add puts the guest's contact up for the outreach list
// of a running package through reconcileCampaignSetForContact(…, 'add'). That function resolves on every answer, a full
// package (quota_full) included, and only logs it (src/lib/data/reconcile.test.ts), so the guest stays added.
describe('createGuestAction → outreach list admission', () => {
  it('asks to admit the new guest\'s contact (op add) once it is linked', async () => {
    vi.mocked(createGuest).mockResolvedValue({ id: 'g-3' } as unknown as Awaited<ReturnType<typeof createGuest>>);
    vi.mocked(linkGuestContact).mockResolvedValue({ contactId: 'c-3', prevContactId: null });

    await expect(
      createGuestAction(E1, {}, fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(reconcileCampaignSetForContact).toHaveBeenCalledTimes(1);
    expect(reconcileCampaignSetForContact).toHaveBeenCalledWith(E1, 'add', 'c-3');
  });

  it('keeps the guest when the package is full: the admission resolves, nothing is undone, the owner lands on the list', async () => {
    vi.mocked(createGuest).mockResolvedValue({ id: 'g-4' } as unknown as Awaited<ReturnType<typeof createGuest>>);
    vi.mocked(linkGuestContact).mockResolvedValue({ contactId: 'c-4', prevContactId: null });
    // reconcileCampaignSetForContact's own contract on quota_full: warn and resolve.
    vi.mocked(reconcileCampaignSetForContact).mockResolvedValue(undefined);

    await expect(
      createGuestAction(E1, {}, fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(reconcileCampaignSetForContact).toHaveBeenCalledWith(E1, 'add', 'c-4');
    expect(deleteGuest).not.toHaveBeenCalled();
  });

  it('asks for nothing when the guest has no phone (no contact to admit)', async () => {
    vi.mocked(createGuest).mockResolvedValue({ id: 'g-5' } as unknown as Awaited<ReturnType<typeof createGuest>>);
    vi.mocked(linkGuestContact).mockResolvedValue({ contactId: null, prevContactId: null });

    await expect(
      createGuestAction(E1, {}, fd({ full_name: 'דנה', phone: '', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(reconcileCampaignSetForContact).not.toHaveBeenCalled();
  });
});

describe('updateGuestAction → contact sync', () => {
  it('re-links the contact when the phone is part of the update', async () => {
    vi.mocked(updateGuest).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof updateGuest>>,
    );

    await expect(
      updateGuestAction(
        E1,
        G9,
        {},
        fd({ full_name: 'דנה', phone: '0509999999', group_id: '', note: '' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(linkGuestContact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(linkGuestContact).mock.calls[0].slice(0, 2)).toEqual([
      E1,
      G9,
    ]);
  });
});

// Real notFound() digest format (verified against node_modules/next/dist/
// client/components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

describe('createGuestAction — Next.js control-flow signals from the ownership gate', () => {
  it('propagates a NEXT_NOT_FOUND from createGuest (requireOwnedEvent) instead of returning { error }', async () => {
    vi.mocked(createGuest).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      createGuestAction(
        E1,
        {},
        fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' }),
      ),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(linkGuestContact).not.toHaveBeenCalled();
  });

  it('converts a genuine (non-framework) error from createGuest into the existing friendly message, not a thrown error', async () => {
    vi.mocked(createGuest).mockRejectedValue(new Error('db down'));

    const result = await createGuestAction(
      E1,
      {},
      fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' }),
    );

    expect(result).toEqual({ serverError: 'הוספת המוזמן נכשלה. נסו שוב.' });
    expect(linkGuestContact).not.toHaveBeenCalled();
  });
});

describe('updateGroupAction', () => {
  const EVENT_ID = '7b0c2d64-9f1e-4a7b-8c3d-2e5f6a7b8c9d';
  const GROUP_ID = '3f2a1b0c-8d7e-4f6a-9b5c-1d2e3f4a5b6c';

  function fd(name: string): FormData {
    const data = new FormData();
    data.set('name', name);
    return data;
  }

  it('renames the group and reports success', async () => {
    vi.mocked(updateGroup).mockResolvedValue({
      id: GROUP_ID,
      event_id: EVENT_ID,
      name: 'משפחה',
      color: null,
      created_at: '2026-07-06T00:00:00Z',
    });
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, {}, fd('משפחה'));
    expect(updateGroup).toHaveBeenCalledWith(EVENT_ID, GROUP_ID, { name: 'משפחה' });
    expect(state.data?.notice).toBeDefined();
  });

  it('rejects an empty name with a field error and never hits the data layer', async () => {
    vi.mocked(updateGroup).mockClear();
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, {}, fd('   '));
    expect(state.validationErrors?.fieldErrors?.name).toBeDefined();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it('maps a data-layer failure to a safe Hebrew error', async () => {
    vi.mocked(updateGroup).mockRejectedValue(new Error('boom'));
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, {}, fd('חברים'));
    expect(state.serverError).toBeDefined();
  });
});

describe('createGroupAction', () => {
  const EVENT_ID = '7b0c2d64-9f1e-4a7b-8c3d-2e5f6a7b8c9d';

  it('creates a group from a name-only form (no color field posted)', async () => {
    // Regression: the groups-manager form has no color input, so
    // formData.get('color') is null — the action must not fail validation.
    vi.mocked(createGroup).mockResolvedValue({
      id: '3f2a1b0c-8d7e-4f6a-9b5c-1d2e3f4a5b6c',
      event_id: EVENT_ID,
      name: 'משפחה',
      color: null,
      created_at: '2026-07-06T00:00:00Z',
    });
    const data = new FormData();
    data.set('name', 'משפחה');
    const state = await createGroupAction(EVENT_ID, {}, data);
    expect(state.validationErrors?.fieldErrors).toBeUndefined();
    expect(state.data?.notice).toBeDefined();
    expect(createGroup).toHaveBeenCalledWith(EVENT_ID, { name: 'משפחה', color: null });
  });
});

describe('friendly duplicate errors surface as field errors', () => {
  const EVENT_ID = '7b0c2d64-9f1e-4a7b-8c3d-2e5f6a7b8c9d';
  const GROUP_ID = '3f2a1b0c-8d7e-4f6a-9b5c-1d2e3f4a5b6c';

  it('createGroupAction maps a taken name to fieldErrors.name', async () => {
    vi.mocked(createGroup).mockRejectedValue(
      new Error('קבוצה בשם זה כבר קיימת באירוע'),
    );
    const data = new FormData();
    data.set('name', 'משפחת קלפה');
    const state = await createGroupAction(EVENT_ID, {}, data);
    expect(state.validationErrors?.fieldErrors?.name?.[0]).toContain('כבר קיימת');
    expect(state.serverError).toBeUndefined();
  });

  it('updateGroupAction maps a taken name to fieldErrors.name', async () => {
    vi.mocked(updateGroup).mockRejectedValue(
      new Error('קבוצה בשם זה כבר קיימת באירוע'),
    );
    const data = new FormData();
    data.set('name', 'משפחת קלפה');
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, {}, data);
    expect(state.validationErrors?.fieldErrors?.name?.[0]).toContain('כבר קיימת');
  });

  it('createGuestAction maps a taken phone to fieldErrors.phone', async () => {
    vi.mocked(createGuest).mockRejectedValue(new Error(PHONE_TAKEN_ERROR));
    const state = await createGuestAction(
      EVENT_ID,
      {},
      fd({ full_name: 'סיון קלפה', phone: '0501234567', group_id: '', note: '' }),
    );
    expect(state).toEqual({ validationErrors: { formErrors: [], fieldErrors: { phone: [PHONE_TAKEN_ERROR] } } });
  });
});

// The actions are built from the shared next-safe-action client (src/lib/safe-action.ts). What the forms and rows read
// back must stay what it was: '' on an update still clears, the schemas' Hebrew messages still reach the field, and a
// row action's failure still reaches the row (now as the result's serverError instead of a throw).
describe('the next-safe-action results keep the old behavior', () => {
  it('an update that empties the phone, the group and the note clears them, and the contact leaves the outreach list', async () => {
    vi.mocked(updateGuest).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof updateGuest>>);
    vi.mocked(linkGuestContact).mockResolvedValue({ contactId: null, prevContactId: 'c-old' });

    await expect(
      updateGuestAction(E1, G9, {}, fd({ full_name: 'דנה', phone: '', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(updateGuest).toHaveBeenCalledWith(E1, G9, expect.objectContaining({ phone: null, group_id: null, note: null }));
    expect(linkGuestContact).toHaveBeenCalledWith(E1, G9, null);
    expect(reconcileCampaignSetForContact).toHaveBeenCalledWith(E1, 'delete', 'c-old');
  });

  it('an empty name gets the schema’s Hebrew message on its field and creates nothing', async () => {
    const result = await createGuestAction(E1, {}, fd({ full_name: '', phone: '', group_id: '', note: '' }));

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { full_name: ['נא להזין שם מוזמן'] } } });
    expect(createGuest).not.toHaveBeenCalled();
  });

  it('the count back-fill answers any invalid count with its one Hebrew message, and reports what it filled', async () => {
    const invalid = await fillMissingExpectedCountAction(E1, {}, fd({ expected_count: 'abc' }));
    expect(invalid).toEqual({
      validationErrors: { formErrors: [], fieldErrors: { expected_count: ['נא להזין מספר מוזמנים'] } },
    });
    expect(fillMissingExpectedCount).not.toHaveBeenCalled();

    vi.mocked(fillMissingExpectedCount).mockResolvedValue(2);
    const filled = await fillMissingExpectedCountAction(E1, {}, fd({ expected_count: ' 3 ' }));
    expect(fillMissingExpectedCount).toHaveBeenCalledWith(E1, 3);
    expect(filled).toEqual({ data: { notice: 'הושלמה כמות עבור 2 מוזמנים.' } });
  });

  it('a contact status outside the DB enum is refused with its Hebrew message before the data layer', async () => {
    const result = await setContactStatusAction({ eventId: E1, guestId: G9, value: 'nope' });

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { value: ['סטטוס יצירת קשר לא תקין'] } } });
    expect(updateContactStatus).not.toHaveBeenCalled();
  });

  it('a failed delete comes back as its Hebrew serverError for the row to show', async () => {
    vi.mocked(deleteGuest).mockRejectedValue(new Error('db down'));

    expect(await deleteGuestAction({ eventId: E1, guestId: G9 })).toEqual({ serverError: 'מחיקת המוזמן נכשלה' });
  });
});
