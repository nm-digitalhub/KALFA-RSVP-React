import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, clientMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  clientMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/supabase/server', () => ({ createClient: clientMock }));

import { createVoicePurpose, updateVoicePurpose } from './voice-purposes';

// ⚠️ A ROW HERE CAN TELEPHONE PEOPLE. It carries a Voximplant rule id, and the
// moment it is enabled a workflow step can dial guests with it.

function mockDb(existing?: { is_builtin: boolean } | null) {
  const calls = { inserted: null as Record<string, unknown> | null, updated: null as Record<string, unknown> | null };
  clientMock.mockResolvedValue({
    from: () => ({
      insert: async (v: Record<string, unknown>) => {
        calls.inserted = v;
        return { error: null };
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: existing ?? null, error: null }) }),
      }),
      update: (v: Record<string, unknown>) => {
        calls.updated = v;
        return { eq: async () => ({ error: null }) };
      },
    }),
  });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue(undefined);
});

describe('createVoicePurpose', () => {
  it('⚠️ ALWAYS creates it switched off', async () => {
    // THE SAFETY PROPERTY OF THIS WHOLE FEATURE. Creating and arming in one
    // submit would make a typo in the rule id a real call to a real person.
    // Fault injection on 2026-09-14 flipped this to `true` and every other test
    // stayed green, which is why it is pinned here.
    const calls = mockDb();
    await createVoicePurpose({
      key: 'feedback',
      displayName: 'משוב',
      description: '',
      ruleId: '1521999',
    });
    expect(calls.inserted).toMatchObject({ enabled: false, is_builtin: false });
  });

  it('⚠️ never lets a caller declare itself built-in', async () => {
    // `is_builtin` decides whether the generic dispatcher refuses the row. A
    // purpose that claimed it would simply never dial.
    const calls = mockDb();
    await createVoicePurpose({ key: 'feedback', displayName: 'משוב', description: '', ruleId: '' });
    expect(calls.inserted!.is_builtin).toBe(false);
  });

  it('stores a blank rule id as NULL, not as an empty string', async () => {
    // The dispatcher tests `!purpose.ruleId`. An empty string is falsy too, but
    // the column means "not wired" and NULL is how that is written down.
    const calls = mockDb();
    await createVoicePurpose({ key: 'feedback', displayName: 'משוב', description: '', ruleId: '' });
    expect(calls.inserted!.rule_id).toBeNull();
  });

  it('requires the voice permission before touching anything', async () => {
    permMock.mockRejectedValue(new Error('denied'));
    mockDb();
    await expect(
      createVoicePurpose({ key: 'feedback', displayName: 'משוב', description: '', ruleId: '' }),
    ).rejects.toThrow('denied');
    expect(clientMock).not.toHaveBeenCalled();
  });
});

describe('updateVoicePurpose', () => {
  const input = {
    key: 'rsvp',
    displayName: 'שם חדש',
    description: 'תיאור',
    ruleId: '9999',
    enabled: true,
    active: true,
  };

  it('⚠️ a BUILT-IN purpose is description only', async () => {
    // RSVP, meeting-confirm and sales dial through their own dispatchers and
    // read their rule ids from `app_settings`. Writing rule_id here would change
    // a label while the owner believed they had changed a rule.
    const calls = mockDb({ is_builtin: true });
    await updateVoicePurpose(input);
    expect(calls.updated).toEqual({ display_name: 'שם חדש', description: 'תיאור' });
    expect(calls.updated).not.toHaveProperty('rule_id');
    expect(calls.updated).not.toHaveProperty('enabled');
  });

  it('a normal purpose updates its rule and switches', async () => {
    const calls = mockDb({ is_builtin: false });
    await updateVoicePurpose(input);
    expect(calls.updated).toMatchObject({ rule_id: '9999', enabled: true, active: true });
  });

  it('refuses a key that does not exist rather than inserting one', async () => {
    mockDb(null);
    await expect(updateVoicePurpose(input)).rejects.toThrow('לא נמצא');
  });
});
