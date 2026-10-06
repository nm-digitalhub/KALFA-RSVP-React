import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));

const {
  ownerMock,
  revalidateMock,
  enabledMock,
  numberMock,
  capMock,
  addMock,
  toggleMock,
  relabelMock,
  removeMock,
  approveMock,
  revokeMock,
  externalMock,
} = vi.hoisted(() => ({
  ownerMock: vi.fn(),
  revalidateMock: vi.fn(),
  enabledMock: vi.fn(),
  numberMock: vi.fn(),
  capMock: vi.fn(),
  addMock: vi.fn(),
  toggleMock: vi.fn(),
  relabelMock: vi.fn(),
  removeMock: vi.fn(),
  approveMock: vi.fn(),
  revokeMock: vi.fn(),
  externalMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: ownerMock }));
vi.mock('@/lib/data/admin/owner-agent', () => ({
  setOwnerAgentEnabled: enabledMock,
  setOwnerAgentPhoneNumber: numberMock,
  setOwnerAgentDailyCap: capMock,
  addOwnerAgentAllowlistEntry: addMock,
  setOwnerAgentAllowlistEnabled: toggleMock,
  relabelOwnerAgentAllowlistEntry: relabelMock,
  removeOwnerAgentAllowlistEntry: removeMock,
  approveOwnerAgentUnverifiedStaff: approveMock,
  revokeOwnerAgentManualApproval: revokeMock,
  addOwnerAgentExternalEntry: externalMock,
}));

import {
  addAllowlistEntryAction,
  addExternalAllowlistEntryAction,
  approveUnverifiedStaffAction,
  relabelAllowlistEntryAction,
  removeAllowlistEntryAction,
  revokeManualApprovalAction,
  setAllowlistEntryEnabledAction,
  setOwnerAgentDailyCapAction,
  setOwnerAgentEnabledAction,
  setOwnerAgentNumberAction,
} from './actions';

const STAFF_ID = '0b7e1f2a-3c4d-4e5f-9a6b-7c8d9e0f1a2b';
const ENTRY_ID = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';
const WABA_REF = '1234567890123456';

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const DAL_MOCKS = [
  enabledMock,
  numberMock,
  capMock,
  addMock,
  toggleMock,
  relabelMock,
  removeMock,
  approveMock,
  revokeMock,
  externalMock,
];

beforeEach(() => {
  vi.clearAllMocks();
  ownerMock.mockResolvedValue({ id: 'owner' });
  for (const m of DAL_MOCKS) m.mockResolvedValue(undefined);
});

// Each action with a VALID form — what a non-owner could post directly, with no page
// rendered at all.
const VALID: Array<[string, () => Promise<unknown>]> = [
  ['setOwnerAgentEnabledAction', () => setOwnerAgentEnabledAction(null, form({ owner_agent_enabled: 'on' }))],
  ['setOwnerAgentNumberAction', () => setOwnerAgentNumberAction(null, form({ phoneNumberId: WABA_REF }))],
  ['setOwnerAgentDailyCapAction', () => setOwnerAgentDailyCapAction(null, form({ dailyCap: '20' }))],
  [
    'addAllowlistEntryAction',
    () =>
      addAllowlistEntryAction(
        null,
        form({ e164: '0501234567', staffUserId: STAFF_ID, label: '' }),
      ),
  ],
  [
    'setAllowlistEntryEnabledAction',
    () => setAllowlistEntryEnabledAction(null, form({ id: ENTRY_ID, enabled: 'false' })),
  ],
  [
    'relabelAllowlistEntryAction',
    () => relabelAllowlistEntryAction(null, form({ id: ENTRY_ID, label: 'נייד' })),
  ],
  ['removeAllowlistEntryAction', () => removeAllowlistEntryAction(null, form({ id: ENTRY_ID }))],
  [
    'approveUnverifiedStaffAction',
    () => approveUnverifiedStaffAction(null, form({ id: ENTRY_ID, note: 'אושר בטלפון' })),
  ],
  ['revokeManualApprovalAction', () => revokeManualApprovalAction(null, form({ id: ENTRY_ID }))],
  [
    'addExternalAllowlistEntryAction',
    () => addExternalAllowlistEntryAction(null, form({ e164: '0501234567', name: 'דנה', note: 'רו"ח' })),
  ],
];

describe('every owner-agent action is owner-only', () => {
  for (const [name, call] of VALID) {
    it(`${name}: a non-owner is refused and the DAL is never reached`, async () => {
      // requirePlatformOwner redirects a non-owner, i.e. throws NEXT_REDIRECT. It must
      // propagate — not be caught and flattened into a form error.
      ownerMock.mockRejectedValue(new Error('NEXT_REDIRECT'));
      await expect(call()).rejects.toThrow('NEXT_REDIRECT');
      for (const m of DAL_MOCKS) expect(m).not.toHaveBeenCalled();
      expect(revalidateMock).not.toHaveBeenCalled();
    });

    it(`${name}: the owner gate runs before the DAL`, async () => {
      await call();
      expect(ownerMock).toHaveBeenCalledTimes(1);
      const dal = DAL_MOCKS.find((m) => m.mock.calls.length > 0);
      expect(dal).toBeDefined();
      expect(ownerMock.mock.invocationCallOrder[0]).toBeLessThan(dal!.mock.invocationCallOrder[0]);
    });
  }
});

describe('Zod refuses bad input before the gate or the DAL', () => {
  it.each([
    ['an empty cap (would coerce to 0)', () => setOwnerAgentDailyCapAction(null, form({ dailyCap: '' })), 'dailyCap'],
    ['a cap above 10000', () => setOwnerAgentDailyCapAction(null, form({ dailyCap: '10001' })), 'dailyCap'],
    ['an E.164 where the Meta id belongs', () => setOwnerAgentNumberAction(null, form({ phoneNumberId: '+972501234567' })), 'phoneNumberId'],
    [
      'bare foreign digits',
      () => addAllowlistEntryAction(null, form({ e164: '15417543010', staffUserId: STAFF_ID, label: '' })),
      'e164',
    ],
    [
      'a non-uuid staff id',
      () => addAllowlistEntryAction(null, form({ e164: '0501234567', staffUserId: 'x', label: '' })),
      'staffUserId',
    ],
    [
      'a label over 120 characters',
      () => relabelAllowlistEntryAction(null, form({ id: ENTRY_ID, label: 'א'.repeat(121) })),
      'label',
    ],
  ])('%s', async (_name, call, field) => {
    const state = await call();
    expect(state?.fieldErrors?.[field]?.length).toBeGreaterThan(0);
    expect(ownerMock).not.toHaveBeenCalled();
    for (const m of DAL_MOCKS) expect(m).not.toHaveBeenCalled();
  });

  it('a malformed row id is refused without a field to point at', async () => {
    expect(await removeAllowlistEntryAction(null, form({ id: 'nope' }))).toEqual({
      error: 'בקשה לא תקינה',
    });
    expect(
      await setAllowlistEntryEnabledAction(null, form({ id: ENTRY_ID, enabled: 'maybe' })),
    ).toEqual({ error: 'בקשה לא תקינה' });
    expect(removeMock).not.toHaveBeenCalled();
    expect(toggleMock).not.toHaveBeenCalled();
  });

  it('does not echo a refused phone number back in the response', async () => {
    const state = await addAllowlistEntryAction(
      null,
      form({ e164: '15417543010', staffUserId: STAFF_ID, label: '' }),
    );
    expect(JSON.stringify(state)).not.toContain('15417543010');
  });
});

describe('what reaches the DAL', () => {
  it('the switch: a ticked box is on, an absent one is off', async () => {
    await setOwnerAgentEnabledAction(null, form({ owner_agent_enabled: 'on' }));
    await setOwnerAgentEnabledAction(null, form({}));
    expect(enabledMock.mock.calls).toEqual([[true], [false]]);
  });

  it('the number: "" clears it to null', async () => {
    const state = await setOwnerAgentNumberAction(null, form({ phoneNumberId: '' }));
    expect(numberMock).toHaveBeenCalledWith(null);
    expect(state).toEqual({ notice: 'לא נבחר מספר — אין הסטה לסוכן' });
  });

  it('the cap arrives as a number', async () => {
    await setOwnerAgentDailyCapAction(null, form({ dailyCap: '0' }));
    expect(capMock).toHaveBeenCalledWith(0);
  });

  it('the allow-list entry arrives normalised to E.164', async () => {
    await addAllowlistEntryAction(
      null,
      form({ e164: '050-123-4567', staffUserId: STAFF_ID, label: '  נייד ' }),
    );
    expect(addMock).toHaveBeenCalledWith({
      e164: '+972501234567',
      staffUserId: STAFF_ID,
      label: 'נייד',
    });
  });

  it('the toggle reads the posted target state', async () => {
    await setAllowlistEntryEnabledAction(null, form({ id: ENTRY_ID, enabled: 'true' }));
    expect(toggleMock).toHaveBeenCalledWith(ENTRY_ID, true);
  });

  it('revalidates this page and the index card after a save', async () => {
    await setOwnerAgentDailyCapAction(null, form({ dailyCap: '5' }));
    expect(revalidateMock).toHaveBeenCalledWith('/admin/integrations/owner-agent');
    expect(revalidateMock).toHaveBeenCalledWith('/admin/integrations');
  });
});

describe('errors stay safe', () => {
  it('passes the DAL\'s Hebrew message through (e.g. a number not on the WABA)', async () => {
    numberMock.mockRejectedValue(new Error('המספר שנבחר אינו מספר WhatsApp מחובר'));
    expect(await setOwnerAgentNumberAction(null, form({ phoneNumberId: WABA_REF }))).toEqual({
      error: 'המספר שנבחר אינו מספר WhatsApp מחובר',
    });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('does not let a ZodError through just because its JSON contains Hebrew', async () => {
    // The DAL re-validates its input; a ZodError's message is the JSON of its issues,
    // Hebrew messages included.
    const zodError = z.string().min(5, 'מספר טלפון לא תקין').safeParse('a').error;
    expect(zodError?.message).toMatch(/[\u0590-\u05FF]/);
    addMock.mockRejectedValue(zodError);
    expect(
      await addAllowlistEntryAction(
        null,
        form({ e164: '0501234567', staffUserId: STAFF_ID, label: '' }),
      ),
    ).toEqual({ error: 'הוספת המספר נכשלה' });
  });

  it('does not let an unknown Hebrew sentence through either', async () => {
    toggleMock.mockRejectedValue(new Error('שגיאה פנימית: relation owner_agent_allowlist'));
    expect(
      await setAllowlistEntryEnabledAction(null, form({ id: ENTRY_ID, enabled: 'true' })),
    ).toEqual({ error: 'עדכון הרשומה נכשל' });
  });

  it('replaces anything else with a generic Hebrew message', async () => {
    addMock.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    expect(
      await addAllowlistEntryAction(
        null,
        form({ e164: '0501234567', staffUserId: STAFF_ID, label: '' }),
      ),
    ).toEqual({ error: 'הוספת המספר נכשלה' });
  });
});

describe('manual approval actions', () => {
  it('an approval without a reason is refused before the gate and the DAL', async () => {
    const res = await approveUnverifiedStaffAction(null, form({ id: ENTRY_ID, note: '  ' }));
    expect(res?.fieldErrors?.note).toBeDefined();
    expect(ownerMock).not.toHaveBeenCalled();
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('an external person without a name or reason is refused, and the phone is not echoed', async () => {
    const res = await addExternalAllowlistEntryAction(null, form({ e164: '0501234567', name: '', note: '' }));
    expect(res?.fieldErrors?.name).toBeDefined();
    expect(res?.fieldErrors?.note).toBeDefined();
    expect(JSON.stringify(res)).not.toContain('0501234567');
    expect(externalMock).not.toHaveBeenCalled();
  });

  it('the external entry reaches the DAL normalised to E.164, with the trimmed name and reason', async () => {
    await addExternalAllowlistEntryAction(null, form({ e164: '050-123-4567', name: ' דנה ', note: ' רו"ח ' }));
    expect(externalMock).toHaveBeenCalledWith({ e164: '+972501234567', name: 'דנה', note: 'רו"ח' });
  });
});
