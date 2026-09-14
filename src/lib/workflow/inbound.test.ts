import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { armedMock, createRunMock, ownerEventsMock, guestContactMock, contextIdMock, adminMock } =
  vi.hoisted(() => ({
    armedMock: vi.fn(),
    createRunMock: vi.fn(),
    ownerEventsMock: vi.fn(),
    guestContactMock: vi.fn(),
    contextIdMock: vi.fn(),
    adminMock: vi.fn(),
  }));

vi.mock('./store', () => ({ listArmedWorkflows: armedMock, createRunIfNew: createRunMock }));
vi.mock('@/lib/data/whatsapp-import', () => ({ resolveOwnerActiveEvents: ownerEventsMock }));
vi.mock('@/lib/data/interactions', () => ({
  resolveInboundContact: guestContactMock,
  resolveByContextId: contextIdMock,
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));

import { createRunsForInboundMessage } from './inbound';

// The WIRING between the inbound webhook row and a workflow run.
//
// ⚠️ WHY THIS FILE EXISTS. `matchesKind`, `planRuns` and every step handler were
// tested individually while the function that JOINS them — the one rewritten to
// take guest import off the billing classifier — had no test at all. Each piece
// was proven and the chain was not, which is the shape of gap that ships.
//
// Two behaviours it holds:
//
//   1. A GUEST speaking to us resolves to an event AND a contact, exactly as
//      before. Nothing about the existing path may change.
//   2. An OWNER sending a list resolves to their event and NO contact — the
//      shape that lets `action.import_guest_list` run while every guest-touching
//      node refuses.

/** An armed workflow whose trigger accepts `kinds` (absent = the old default). */
const workflow = (kinds?: string[]) => ({
  id: 'wf-1',
  eventId: null,
  definition: {
    name: 'w',
    layoutDirection: 'RIGHT',
    nodes: [
      {
        id: 't',
        type: 'node',
        position: { x: 0, y: 0 },
        data: {
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 't',
            description: 'd',
            ...(kinds ? { messageKinds: kinds } : {}),
          },
        },
      },
    ],
    edges: [],
  },
});

// `as never` at the call boundary, not on the object: `WebhookInboxRow` is the
// full generated table row and spelling all of it here would test the generator,
// not this module. Built as a real object first so the overrides below can be
// applied before the cast — a spread of `never` does not compile.
const row = (payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) =>
  ({
    id: 'inbox-9',
    event_kind: 'message',
    context_message_id: null,
    phone_number_id: 'pn-1',
    payload,
    ...overrides,
  }) as never;

const TEXT = { type: 'text', from: '972501234567', text: { body: 'כן' } };
const DOCUMENT = { type: 'document', from: '972501234567', id: 'wamid.1', document: { id: 'm1' } };
const CONTACTS = { type: 'contacts', from: '972501234567', id: 'wamid.2', contacts: [] };

beforeEach(() => {
  vi.clearAllMocks();
  createRunMock.mockResolvedValue('run-1');
  guestContactMock.mockResolvedValue({ eventId: 'e1', contactId: 'c1' });
  contextIdMock.mockResolvedValue(null);
  ownerEventsMock.mockResolvedValue([{ id: 'e1', name: 'חתונה', event_type: 'wedding' }]);
  // resolveTriggerContext reads guests + events; an empty answer is fine here.
  adminMock.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [] }),
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  });
});

describe('a guest speaking to us — the path that must not change', () => {
  it('starts a run for a text message', async () => {
    armedMock.mockResolvedValue([workflow()]);
    expect(await createRunsForInboundMessage(row(TEXT))).toEqual(['run-1']);
    expect(createRunMock.mock.calls[0]![0].triggerPayload).toMatchObject({
      eventId: 'e1',
      contactId: 'c1',
    });
  });

  it('⚠️ a FILE does NOT start a workflow that did not ask for one', async () => {
    // THE COMPATIBILITY ASSERTION, end to end. Every armed workflow in
    // production has no `messageKinds`; if this ever returns a run, all of them
    // begin firing on files and photos their owners never chose.
    armedMock.mockResolvedValue([workflow()]);
    expect(await createRunsForInboundMessage(row(DOCUMENT))).toEqual([]);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('resolves who the guest is only AFTER a workflow wants the kind', async () => {
    // The ordering is the cost control: an inbound kind nobody asked for must
    // not pay for two lookups to be told so.
    armedMock.mockResolvedValue([workflow()]);
    await createRunsForInboundMessage(row(DOCUMENT));
    expect(guestContactMock).not.toHaveBeenCalled();
    expect(ownerEventsMock).not.toHaveBeenCalled();
  });
});

describe('an owner sending a list — the path that did not exist', () => {
  const importer = () => [workflow(['document', 'contacts'])];

  it('starts a run for a FILE when the trigger asked for one', async () => {
    armedMock.mockResolvedValue(importer());
    expect(await createRunsForInboundMessage(row(DOCUMENT))).toEqual(['run-1']);
  });

  it('starts a run for CONTACT CARDS too', async () => {
    armedMock.mockResolvedValue(importer());
    expect(await createRunsForInboundMessage(row(CONTACTS))).toEqual(['run-1']);
  });

  it('⚠️ the run carries an event and NO contact', async () => {
    // The property the whole design rests on: `action.import_guest_list` needs
    // the event, and every guest-touching node must refuse because there is no
    // guest. A contactId here would let `send_whatsapp` fire at the owner's own
    // number as though they were a guest.
    armedMock.mockResolvedValue(importer());
    await createRunsForInboundMessage(row(DOCUMENT));
    const payload = createRunMock.mock.calls[0]![0].triggerPayload;
    expect(payload.eventId).toBe('e1');
    expect(payload.contactId).toBeUndefined();
  });

  it('carries the inbox REFERENCE, not the list itself', async () => {
    // The node reads the file through this id. Copying names and phones into
    // `trigger_payload` would be a second permanent copy of a guest list.
    armedMock.mockResolvedValue(importer());
    await createRunsForInboundMessage(row(DOCUMENT));
    const payload = createRunMock.mock.calls[0]![0].triggerPayload;
    expect(payload.inboxRowId).toBe('inbox-9');
    expect(JSON.stringify(payload)).not.toContain('contacts');
  });

  it('⚠️ resolves the OWNER by a NORMALISED phone, never the guest table', async () => {
    // THE BUG THIS PINS, found on a live list 2026-09-13. Meta sends `from`
    // WITHOUT a leading '+' ("972…"), and `resolveOwnerActiveEvents` compares it
    // against `normalizePhone(profile.phone)`, which returns E.164 and DOES
    // carry the '+'. Passing the raw value matched no profile ever, so the
    // function reported "this sender owns no active event" — indistinguishable
    // from a stranger. No run, no error, nothing in any log.
    armedMock.mockResolvedValue(importer());
    await createRunsForInboundMessage(row(DOCUMENT));
    expect(ownerEventsMock).toHaveBeenCalledWith('+972501234567');
    expect(guestContactMock).not.toHaveBeenCalled();
  });

  it('starts nothing when the sender phone is not a real number', async () => {
    // Normalisation returns null rather than guessing, and a run must not be
    // planned against an unidentified sender.
    armedMock.mockResolvedValue(importer());
    expect(
      await createRunsForInboundMessage(row({ ...DOCUMENT, from: 'not-a-phone' })),
    ).toEqual([]);
    expect(ownerEventsMock).not.toHaveBeenCalled();
  });

  it('accepts BOTH stored shapes of messageKinds', async () => {
    // `[{value:'document'}]` is what the control writes now; `['document']` is
    // what the first version wrote and is in the database today. Reading only
    // the new shape would silently stop those workflows matching.
    armedMock.mockResolvedValue([workflow([{ value: 'document' } as never])]);
    expect(await createRunsForInboundMessage(row(DOCUMENT))).toEqual(['run-1']);
  });

  it('⚠️ starts NOTHING when the sender manages more than one active event', async () => {
    // The misroute incident (2026-07-06): a brit guest list landed on a newer
    // active event because "newest wins". The import path refuses to guess and
    // asks the owner to pick; a workflow must not quietly pick either.
    armedMock.mockResolvedValue(importer());
    ownerEventsMock.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    expect(await createRunsForInboundMessage(row(DOCUMENT))).toEqual([]);
  });

  it('starts nothing for a stranger', async () => {
    // Not an owner of any active event. The import path is silent here on
    // purpose — nothing leaks about the system — and so is this.
    armedMock.mockResolvedValue(importer());
    ownerEventsMock.mockResolvedValue([]);
    expect(await createRunsForInboundMessage(row(DOCUMENT))).toEqual([]);
  });

  it('a workflow that asked for FILES does not also fire on text', async () => {
    // Opting in names the kinds; it does not add to the default.
    armedMock.mockResolvedValue(importer());
    expect(await createRunsForInboundMessage(row(TEXT))).toEqual([]);
  });
});

describe('the gates that predate all of this still hold', () => {
  it('a non-message row starts nothing', async () => {
    armedMock.mockResolvedValue([workflow()]);
    expect(
      await createRunsForInboundMessage(row(TEXT, { event_kind: 'status' })),
    ).toEqual([]);
  });

  it('no armed workflow means no lookups at all', async () => {
    armedMock.mockResolvedValue([]);
    expect(await createRunsForInboundMessage(row(TEXT))).toEqual([]);
    expect(guestContactMock).not.toHaveBeenCalled();
  });

  it('a redelivery returns nothing — createRunIfNew deduplicates', async () => {
    armedMock.mockResolvedValue([workflow()]);
    createRunMock.mockResolvedValue(undefined);
    expect(await createRunsForInboundMessage(row(TEXT))).toEqual([]);
  });

  it('a payload with no type starts nothing', async () => {
    armedMock.mockResolvedValue([workflow(), workflow(['document', 'contacts'])]);
    expect(await createRunsForInboundMessage(row({ from: '972501234567' }))).toEqual([]);
  });
});
