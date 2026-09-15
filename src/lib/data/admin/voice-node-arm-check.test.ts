import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// `vi.hoisted`, because `vi.mock` is hoisted above every const in the file.
const { purposesMock } = vi.hoisted(() => ({ purposesMock: vi.fn() }));
vi.mock('@/lib/data/voice-purposes', () => ({ listVoicePurposes: purposesMock }));

import { findVoiceDialBlockers } from './voice-node-arm-check';

// The registry rows this gate reads. `ruleId` is the one that varies per test —
// it is the field the node can now supply for itself.
const PURPOSE = {
  key: 'feedback',
  displayName: 'משוב',
  description: null,
  ruleId: '999',
  enabled: true,
  isBuiltin: false,
  leadMs: 0,
  minDelayMs: 0,
  tokenTtlSec: 7200,
  active: true,
};

function diagram(properties: Record<string, unknown>) {
  return {
    nodes: [
      {
        id: 'n1',
        type: 'node',
        position: { x: 0, y: 0 },
        data: {
          type: 'action.start_voice_call',
          properties: { label: 'שיחה', status: 'active', purposeKey: 'feedback', ...properties },
        },
      },
    ],
    edges: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  purposesMock.mockResolvedValue([PURPOSE]);
});

describe('findVoiceDialBlockers', () => {
  it('passes a node whose purpose carries a rule', async () => {
    await expect(findVoiceDialBlockers(diagram({}))).resolves.toEqual([]);
  });

  it('does not read the registry at all when no call node exists', async () => {
    await findVoiceDialBlockers({ nodes: [], edges: [] });
    // The common case is a workflow that never dials, and it must cost nothing.
    expect(purposesMock).not.toHaveBeenCalled();
  });

  it('BLOCKS when neither the purpose nor the node names a rule', async () => {
    purposesMock.mockResolvedValue([{ ...PURPOSE, ruleId: null }]);
    const blockers = await findVoiceDialBlockers(diagram({}));
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('אין כלל ניתוב');
  });

  it('PASSES a rule-less purpose when the node supplies the rule itself', async () => {
    // ⚠️ THE INVERSION THIS GATE MUST NOT MAKE. Before the node carried dial
    // parameters, a purpose with no rule was undialable full stop. Checking only
    // the purpose here would refuse to arm a workflow that dials correctly.
    purposesMock.mockResolvedValue([{ ...PURPOSE, ruleId: null }]);
    await expect(findVoiceDialBlockers(diagram({ ruleId: '1520915' }))).resolves.toEqual([]);
  });

  it('blocks a purpose that no longer exists, naming it', async () => {
    purposesMock.mockResolvedValue([]);
    const blockers = await findVoiceDialBlockers(diagram({}));
    expect(blockers[0]).toContain('feedback');
  });

  it('blocks a disabled purpose and a built-in one', async () => {
    purposesMock.mockResolvedValue([{ ...PURPOSE, enabled: false }]);
    expect((await findVoiceDialBlockers(diagram({})))[0]).toContain('כבוי');

    purposesMock.mockResolvedValue([{ ...PURPOSE, isBuiltin: true }]);
    expect((await findVoiceDialBlockers(diagram({})))[0]).toContain('מובנה');
  });

  it('says nothing about a draft or disabled step', async () => {
    // A draft is reported by `findArmBlockers`, which says it is a draft. A
    // second complaint about the same node would bury that one.
    purposesMock.mockResolvedValue([{ ...PURPOSE, ruleId: null }]);
    await expect(findVoiceDialBlockers(diagram({ status: 'draft' }))).resolves.toEqual([]);
    await expect(findVoiceDialBlockers(diagram({ status: 'disabled' }))).resolves.toEqual([]);
  });

  it('leaves an empty purpose to the field-level gate', async () => {
    // `findArmBlockers` already names the field and says where to create one.
    await expect(findVoiceDialBlockers(diagram({ purposeKey: '' }))).resolves.toEqual([]);
  });

  it('returns nothing for a definition it cannot parse', async () => {
    await expect(findVoiceDialBlockers({ not: 'a diagram' })).resolves.toEqual([]);
  });
});
