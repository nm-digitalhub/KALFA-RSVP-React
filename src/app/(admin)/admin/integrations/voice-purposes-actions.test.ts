import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createMock, updateMock, listMock, channelConfigMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  listMock: vi.fn(),
  channelConfigMock: vi.fn(),
}));

vi.mock('@/lib/data/admin/voice-purposes', () => ({
  createVoicePurpose: createMock,
  updateVoicePurpose: updateMock,
  listVoicePurposesForAdmin: listMock,
}));
// Both actions now read every rule id already claimed, so a purpose cannot be
// handed a rule another purpose or persona is using (see ruleIdAssignmentError).
// Unstubbed, these reach the real DAL and open a cookie client outside a request
// scope — the failure looks like 'cookies was called outside a request scope',
// nothing about purposes.
vi.mock('@/lib/data/admin/voximplant-channel', () => ({
  getVoximplantChannelConfig: channelConfigMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createVoicePurposeAction, updateVoicePurposeAction } from './actions';

// The registry is what lets a NEW voice agent be used without new code — so
// these two actions are the door to something that telephones real people.
//
// ⚠️ WHY EACH GUARD IS HERE. A purpose row carries a Voximplant rule id, and the
// moment it is enabled a workflow step can dial guests with it. The guards make
// the two cheap mistakes impossible: a malformed key that would not match the
// table's CHECK, and an enabled purpose with no rule — which cannot dial, and
// whose failure would otherwise surface as a run-log line hours later.

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  // A clean account: nothing claimed, so these tests exercise their own subject
  // rather than the claim guard. The guard has its own tests in
  // src/lib/validation/rule-id-assignment.test.ts.
  listMock.mockResolvedValue([]);
  channelConfigMock.mockResolvedValue({
    voximplant_rule_id: '',
    meetingConfirmRuleId: '',
    salesCallRuleId: '',
    voximplant_call_me_now_rule_id: '',
  });
});

// The tests above stub an empty account so each one exercises its own subject.
// These two prove the guard is actually WIRED INTO both actions — without them a
// refactor could drop the readRuleIdClaims call and every other test would still
// pass, while the panel happily pointed two purposes at one rule.
describe('one rule, one purpose — wiring', () => {
  it('refuses to create a purpose on a rule a persona already uses', async () => {
    channelConfigMock.mockResolvedValue({
      voximplant_rule_id: '1520915',
      meetingConfirmRuleId: '1523903',
      salesCallRuleId: '',
      voximplant_call_me_now_rule_id: '',
    });
    const r = await createVoicePurposeAction(
      null,
      form({ key: 'feedback', displayName: 'משוב', ruleId: '1523903' }),
    );
    expect(createMock).not.toHaveBeenCalled();
    expect(r?.fieldErrors?.ruleId?.[0]).toContain('שיחות אישור פגישה');
  });

  it('refuses to update a purpose onto another PURPOSE\'s rule', async () => {
    listMock.mockResolvedValue([
      { key: 'other', displayName: 'ייעוד אחר', ruleId: '1530001', isBuiltin: false },
    ]);
    const r = await updateVoicePurposeAction(
      null,
      form({ key: 'feedback', displayName: 'משוב', ruleId: '1530001', enabled: 'on', active: 'on' }),
    );
    expect(updateMock).not.toHaveBeenCalled();
    expect(r?.fieldErrors?.ruleId?.[0]).toContain('ייעוד אחר');
  });

  it('lets a purpose keep the rule it already holds', async () => {
    // Every save resubmits the current value; treating that as a clash would
    // make the row impossible to edit.
    listMock.mockResolvedValue([
      { key: 'feedback', displayName: 'משוב', ruleId: '1530001', isBuiltin: false },
    ]);
    const r = await updateVoicePurposeAction(
      null,
      form({ key: 'feedback', displayName: 'משוב', ruleId: '1530001', enabled: 'on', active: 'on' }),
    );
    expect(updateMock).toHaveBeenCalled();
    expect(r?.fieldErrors).toBeUndefined();
  });
});

describe('createVoicePurposeAction', () => {
  it('creates a purpose, and says it is OFF', async () => {
    const r = await createVoicePurposeAction(null, form({ key: 'feedback', displayName: 'משוב' }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'feedback', displayName: 'משוב' }),
    );
    expect(r?.notice).toContain('כבוי');
  });

  it('⚠️ refuses a key the table would reject anyway', async () => {
    // The CHECK constraint is `^[a-z][a-z0-9_]{1,48}$`. Catching it here gives a
    // Hebrew field error instead of a 23514 the owner cannot read.
    for (const key of ['Feedback', '9feedback', 'feed-back', 'f', 'משוב', '']) {
      const r = await createVoicePurposeAction(null, form({ key, displayName: 'משוב' }));
      expect(r?.fieldErrors?.key, key).toBeTruthy();
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate key as a message, not a crash', async () => {
    createMock.mockRejectedValue(new Error('כבר קיים ייעוד עם המזהה הזה'));
    const r = await createVoicePurposeAction(null, form({ key: 'feedback', displayName: 'משוב' }));
    expect(r?.error).toContain('כבר קיים');
  });
});

describe('updateVoicePurposeAction', () => {
  it('⚠️ REFUSES to enable a purpose with no rule id', async () => {
    // An enabled purpose with no rule cannot dial. Refusing here means the owner
    // reads it on the form instead of finding it in a run log.
    const r = await updateVoicePurposeAction(
      null,
      form({ key: 'feedback', displayName: 'משוב', enabled: 'on', ruleId: '' }),
    );
    expect(r?.error).toContain('Rule ID');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('allows saving a disabled purpose with no rule — that is a draft', async () => {
    const r = await updateVoicePurposeAction(
      null,
      form({ key: 'feedback', displayName: 'משוב', ruleId: '' }),
    );
    expect(r?.error).toBeUndefined();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('enables with a rule, and says plainly what that permits', async () => {
    const r = await updateVoicePurposeAction(
      null,
      form({ key: 'feedback', displayName: 'משוב', enabled: 'on', ruleId: '1521999', active: 'on' }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, ruleId: '1521999', active: true }),
    );
    expect(r?.notice).toContain('שיחות אמיתיות');
  });

  it('trims the rule id — a pasted value carries whitespace', async () => {
    await updateVoicePurposeAction(
      null,
      form({ key: 'feedback', displayName: 'משוב', enabled: 'on', ruleId: '  1521999  ' }),
    );
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ ruleId: '1521999' }));
  });
});
