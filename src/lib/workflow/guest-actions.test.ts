import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminMock, guestsMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  guestsMock: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/data/interactions', () => ({
  getGuestsForContact: guestsMock,
  recordRsvpFromWhatsapp: vi.fn(),
}));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/data/rsvp', () => ({ submitRsvp: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppText: vi.fn() }));
vi.mock('./voice-agent-actions', () => ({ dispatchWorkflowRsvpAiCallback: vi.fn() }));

import { createGuestActions } from './guest-actions';

// The REAL implementations — the ones the handler tests mock away.
//
// ⚠️ WHY THIS FILE EXISTS. A fault injection on 2026-09-13 removed the callback
// dedupe from this module and all 224 workflow tests still passed: every one of
// them mocks the port. The single line that stops a guest being telephoned twice
// had no test at all. That is the gap this closes.

type Row = Record<string, unknown>;

/**
 * A Supabase double that answers per TABLE and records the insert/update.
 *
 * `openCallback` is what the dedupe probe finds.
 */
function mockDb(opts: {
  guest?: Row | null;
  openCallback?: Row | null;
  insertError?: boolean;
  updateError?: boolean;
}) {
  const calls = {
    inserted: null as Row | null,
    updated: null as Row | null,
    dedupeFilters: [] as Array<[string, unknown]>,
  };

  adminMock.mockReturnValue({
    from: (table: string) => {
      if (table === 'guests') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: opts.guest ?? null, error: null }),
          update: (values: Row) => {
            calls.updated = values;
            return {
              eq: () => ({
                eq: async () => ({ error: opts.updateError ? { message: 'x' } : null }),
              }),
            };
          },
        };
        return chain;
      }
      // callback_requests
      const probe: Record<string, unknown> = {
        select: () => probe,
        eq: (col: string, val: unknown) => {
          calls.dedupeFilters.push([col, val]);
          return probe;
        },
        in: (col: string, val: unknown) => {
          calls.dedupeFilters.push([col, val]);
          return probe;
        },
        gte: (col: string, val: unknown) => {
          calls.dedupeFilters.push([col, val]);
          return probe;
        },
        limit: () => probe,
        maybeSingle: async () => ({ data: opts.openCallback ?? null, error: null }),
        insert: async (values: Row) => {
          calls.inserted = values;
          return { error: opts.insertError ? { message: 'x' } : null };
        },
      };
      return probe;
    },
  });

  return calls;
}

const ONE_GUEST = [{ id: 'g1', rsvp_token: 't1' }];
const INPUT = { eventId: 'e1', contactId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  guestsMock.mockResolvedValue(ONE_GUEST);
});

describe('setGuestField', () => {
  it('writes the named column, and only that column', async () => {
    const calls = mockDb({});
    const r = await createGuestActions().setGuestField!({
      ...INPUT,
      field: 'meal_pref',
      value: 'בלי גלוטן',
    });
    expect(r).toEqual({ ok: true, guestId: 'g1' });
    expect(calls.updated).toEqual({ meal_pref: 'בלי גלוטן' });
  });

  it('note and rsvp_note are DIFFERENT columns', async () => {
    // The privacy distinction: rsvp_note is rendered on the public RSVP page,
    // note is the owner's private annotation. Writing one into the other either
    // hides the guest's words from them or shows them the owner's private note.
    const a = mockDb({});
    await createGuestActions().setGuestField!({ ...INPUT, field: 'note', value: 'פנימי' });
    expect(a.updated).toEqual({ note: 'פנימי' });

    const b = mockDb({});
    await createGuestActions().setGuestField!({ ...INPUT, field: 'rsvp_note', value: 'ציבורי' });
    expect(b.updated).toEqual({ rsvp_note: 'ציבורי' });
  });

  it('an empty value clears the column to NULL, not to an empty string', async () => {
    // "no meal preference" is NULL everywhere else in this codebase; a workflow
    // must not invent a second spelling of absent.
    const calls = mockDb({});
    await createGuestActions().setGuestField!({ ...INPUT, field: 'meal_pref', value: '' });
    expect(calls.updated).toEqual({ meal_pref: null });
  });

  it('refuses when the phone backs more than one guest', async () => {
    guestsMock.mockResolvedValue([
      { id: 'g1', rsvp_token: 't1' },
      { id: 'g2', rsvp_token: 't2' },
    ]);
    const calls = mockDb({});
    const r = await createGuestActions().setGuestField!({ ...INPUT, field: 'note', value: 'x' });
    expect(r).toMatchObject({ ok: false, reason: 'multiple_guests_for_contact' });
    expect(calls.updated).toBeNull();
  });

  it('refuses when the contact has no guest at all', async () => {
    guestsMock.mockResolvedValue([]);
    const r = await createGuestActions().setGuestField!({ ...INPUT, field: 'note', value: 'x' });
    expect(r).toMatchObject({ ok: false, reason: 'no_guest_for_contact' });
  });

  it('reports a write failure rather than claiming success', async () => {
    mockDb({ updateError: true });
    const r = await createGuestActions().setGuestField!({ ...INPUT, field: 'note', value: 'x' });
    expect(r).toMatchObject({ ok: false, reason: 'update_failed' });
  });
});

describe('createCallbackRequest — the dedupe that stops a second phone call', () => {
  const GUEST = { full_name: 'דנה כהן', phone: '+972500000000' };

  it('inserts when nothing is open', async () => {
    const calls = mockDb({ guest: GUEST });
    const r = await createGuestActions().createCallbackRequest!({
      ...INPUT,
      topic: 'שאלה',
      note: 'הערה',
    });
    expect(r).toEqual({ ok: true, created: true });
    expect(calls.inserted).toMatchObject({
      full_name: 'דנה כהן',
      phone: '+972500000000',
      topic: 'שאלה',
      note: 'הערה',
      requested_at: null,
      requested_rank: 'earliest',
    });
  });

  it('DOES NOT insert when an open request already covers this phone', async () => {
    // THE test this file exists for. Removing the guard it pins would otherwise
    // pass every other suite in the repo.
    const calls = mockDb({ guest: GUEST, openCallback: { id: 'existing' } });
    const r = await createGuestActions().createCallbackRequest!({
      ...INPUT,
      topic: 'שאלה',
      note: '',
    });
    expect(r).toEqual({ ok: true, created: false });
    expect(calls.inserted).toBeNull();
  });

  it('scopes the dedupe to THIS phone and to OPEN statuses only', async () => {
    // Scoped too widely it would suppress a genuinely new request; too narrowly
    // and it stops deduping at all.
    const calls = mockDb({ guest: GUEST });
    await createGuestActions().createCallbackRequest!({ ...INPUT, topic: 't', note: '' });
    expect(calls.dedupeFilters).toContainEqual(['phone', '+972500000000']);
    expect(calls.dedupeFilters).toContainEqual(['status', ['new', 'in_progress']]);
    // And bounded in time — an old request is backlog, not this conversation.
    expect(calls.dedupeFilters.some(([col]) => col === 'created_at')).toBe(true);
  });

  it('refuses when the guest has no phone — there is nothing to call back', async () => {
    const calls = mockDb({ guest: { full_name: 'דנה', phone: null } });
    const r = await createGuestActions().createCallbackRequest!({
      ...INPUT,
      topic: 't',
      note: '',
    });
    expect(r).toMatchObject({ ok: false, created: false, reason: 'no_phone' });
    expect(calls.inserted).toBeNull();
  });

  it('falls back to a name rather than inserting a blank one', async () => {
    // full_name is NOT NULL on the table, and a blank one is what a human sees
    // when they pick the callback up.
    const calls = mockDb({ guest: { full_name: '   ', phone: '+972500000000' } });
    await createGuestActions().createCallbackRequest!({ ...INPUT, topic: 't', note: '' });
    expect(String(calls.inserted?.full_name).trim()).not.toBe('');
  });

  it('reports an insert failure rather than claiming the request exists', async () => {
    mockDb({ guest: GUEST, insertError: true });
    const r = await createGuestActions().createCallbackRequest!({
      ...INPUT,
      topic: 't',
      note: '',
    });
    expect(r).toMatchObject({ ok: false, created: false, reason: 'insert_failed' });
  });
});
