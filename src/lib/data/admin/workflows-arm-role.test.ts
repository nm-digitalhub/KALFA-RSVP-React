import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, adminMock, assignRoleMock, convertMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  adminMock: vi.fn(),
  assignRoleMock: vi.fn(),
  convertMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/data/admin/integrations/provider-numbers', () => ({ assignRole: assignRoleMock }));
vi.mock('@/lib/workflow/adapter/to-definition', () => ({ toWorkflowDefinition: convertMock }));
vi.mock('@/lib/workflow/engine/dry-run', () => ({}));

import { setWorkflowActive } from './workflows';

// Arming a guest-list workflow claims the `whatsapp_import_sender` role for the
// number its trigger names.
//
// ⚠️ WHY THIS IS TESTED HARDER THAN ITS SIZE SUGGESTS. The role is ACCOUNT-WIDE
// routing: once assigned, an inbound message arriving on any number that is
// neither the RSVP line nor this one is classified 'unknown' and is not
// processed at all. A convenience that reaches that far has to be exact about
// when it fires, and — above all — about when it does NOT.

const trigger = (props: Record<string, unknown>) => ({
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
        properties: { label: 't', description: 'd', ...props },
      },
    },
  ],
  edges: [],
});

const LIST_TRIGGER = trigger({
  messageKinds: [{ value: 'document' }, { value: 'contacts' }],
  phoneNumberId: 'pn-import',
});

/**
 * A Supabase double answering per table.
 *
 * `heldBy` is who currently holds the role — null for unassigned.
 */
function mockDb(opts: {
  definition: unknown;
  number?: { id: string; e164: string | null; is_active: boolean } | null;
  heldBy?: string | null;
}) {
  const updates: Record<string, unknown>[] = [];

  adminMock.mockReturnValue({
    from: (table: string) => {
      if (table === 'workflows') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { definition: opts.definition } }) }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'provider_numbers') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: opts.number ?? null }),
        };
        return chain;
      }
      // provider_number_roles
      const roles: Record<string, unknown> = {
        select: () => roles,
        eq: () => roles,
        maybeSingle: async () => ({
          data: opts.heldBy === undefined || opts.heldBy === null ? null : { number_id: opts.heldBy },
        }),
      };
      return roles;
    },
  });

  return { updates };
}

const ACTIVE_NUMBER = { id: 'num-1', e164: '+97233301505', is_active: true };

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue(undefined);
  convertMock.mockReturnValue({ ok: true });
  assignRoleMock.mockResolvedValue(undefined);
});

describe('arming a guest-list workflow claims the import role', () => {
  it('assigns it when nobody holds it, and SAYS SO', async () => {
    mockDb({ definition: LIST_TRIGGER, number: ACTIVE_NUMBER, heldBy: null });
    const r = await setWorkflowActive('wf-1', true);

    expect(assignRoleMock).toHaveBeenCalledWith('whatsapp_import_sender', 'num-1');
    expect(r.ok).toBe(true);
    // The notice is not decoration: assigning this role stops OTHER numbers
    // being processed, and nobody may discover that from behaviour alone.
    expect(r.ok && r.notice).toContain('+97233301505');
  });

  it('⚠️ NEVER STEALS the role from another number', async () => {
    // THE ASSERTION THE OBJECTION TO THIS FEATURE RESTED ON. Arming a second
    // workflow must not silently re-point account-wide routing.
    mockDb({ definition: LIST_TRIGGER, number: ACTIVE_NUMBER, heldBy: 'num-other' });
    const r = await setWorkflowActive('wf-1', true);

    expect(assignRoleMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.ok && r.notice).toContain('כבר משויך');
  });

  it('says nothing when the number already holds it', async () => {
    mockDb({ definition: LIST_TRIGGER, number: ACTIVE_NUMBER, heldBy: 'num-1' });
    const r = await setWorkflowActive('wf-1', true);

    expect(assignRoleMock).not.toHaveBeenCalled();
    expect(r.ok && r.notice).toBeUndefined();
  });

  it('does NOT claim it for a trigger that only wants guest replies', async () => {
    // A workflow pinned to a number for ordinary RSVP messages has said nothing
    // about guest lists, and must not repurpose that number.
    mockDb({
      definition: trigger({ phoneNumberId: 'pn-import' }),
      number: ACTIVE_NUMBER,
      heldBy: null,
    });
    await setWorkflowActive('wf-1', true);
    expect(assignRoleMock).not.toHaveBeenCalled();
  });

  it('does NOT claim it when the trigger names no number', async () => {
    // "any number" is not a statement about which one should hold the role.
    mockDb({
      definition: trigger({ messageKinds: [{ value: 'contacts' }] }),
      number: ACTIVE_NUMBER,
      heldBy: null,
    });
    await setWorkflowActive('wf-1', true);
    expect(assignRoleMock).not.toHaveBeenCalled();
  });

  it('does NOT claim it for an INACTIVE number', async () => {
    // `resolveNumberForRole` answers null for a deactivated number, so the
    // assignment would be inert and the notice would be a lie.
    mockDb({
      definition: LIST_TRIGGER,
      number: { ...ACTIVE_NUMBER, is_active: false },
      heldBy: null,
    });
    await setWorkflowActive('wf-1', true);
    expect(assignRoleMock).not.toHaveBeenCalled();
  });

  it('does NOT claim it for a number we do not have', async () => {
    mockDb({ definition: LIST_TRIGGER, number: null, heldBy: null });
    await setWorkflowActive('wf-1', true);
    expect(assignRoleMock).not.toHaveBeenCalled();
  });

  it('⚠️ the workflow stays ARMED even if claiming the role throws', async () => {
    // Ordering: the arm is committed first, and this is a convenience on top. A
    // failure here must never leave an owner who pressed "arm" un-armed.
    const { updates } = mockDb({
      definition: LIST_TRIGGER,
      number: ACTIVE_NUMBER,
      heldBy: null,
    });
    assignRoleMock.mockRejectedValue(new Error('permission denied'));

    const r = await setWorkflowActive('wf-1', true);
    expect(r.ok).toBe(true);
    expect(updates).toContainEqual({ is_active: true });
  });

  it('claims nothing when DISARMING', async () => {
    mockDb({ definition: LIST_TRIGGER, number: ACTIVE_NUMBER, heldBy: null });
    await setWorkflowActive('wf-1', false);
    expect(assignRoleMock).not.toHaveBeenCalled();
    // And disarming is never gated on the conversion contract.
    expect(convertMock).not.toHaveBeenCalled();
  });

  it('refuses to arm — and claims nothing — when the graph will not convert', async () => {
    convertMock.mockReturnValue({ ok: false, errors: [{ message: 'אין צומת התחלה' }] });
    const { updates } = mockDb({
      definition: LIST_TRIGGER,
      number: ACTIVE_NUMBER,
      heldBy: null,
    });

    const r = await setWorkflowActive('wf-1', true);
    expect(r).toEqual({ ok: false, errors: ['אין צומת התחלה'] });
    expect(updates).toHaveLength(0);
    expect(assignRoleMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The configuration gate
// ---------------------------------------------------------------------------
//
// ⚠️ WHY THIS LIVES HERE AND NOT ONLY IN `arm-check.test.ts`. That file proves
// the RULE; this one proves it is WIRED. Fault injection showed the difference:
// deleting the two lines that call `findArmBlockers` from `setWorkflowActive`
// left `tsc` clean and every arm-check test green — the gate was gone and
// nothing said so.

describe('arming refuses a workflow that is not configured', () => {
  const FAN_OUT = {
    name: 'w',
    layoutDirection: 'RIGHT',
    nodes: [
      {
        id: 'fan',
        type: 'node',
        position: { x: 0, y: 0 },
        data: {
          type: 'action.start_for_each_guest',
          properties: {
            label: 'לכל אורח',
            description: 'd',
            targetWorkflowId: '',
            maxGuests: 10,
          },
        },
      },
    ],
    edges: [],
  };

  it('⚠️ refuses, names the field, and does NOT flip the switch', async () => {
    // The failure this replaces was invisible: the switch flipped, and the run
    // failed the next time the clock fired.
    const { updates } = mockDb({ definition: FAN_OUT });
    convertMock.mockReturnValue({ ok: true, definition: { nodes: [], edges: [] }, globals: {} });

    const r = await setWorkflowActive('wf-1', true);

    expect(r).toEqual({
      ok: false,
      errors: [
        'הצעד "לכל אורח": לא נבחר תהליך להרצה. צרו את תהליך-הבן (למשל מהתבנית "תזכורת לאורח אחד") והדביקו את המזהה שלו כאן.',
      ],
    });
    // Nothing was written. An arm that reports failure and arms anyway is worse
    // than no gate at all.
    expect(updates).toEqual([]);
  });

  it('does not stand in the way of a configured workflow', async () => {
    const { updates } = mockDb({ definition: trigger({ keyword: 'אישור' }) });
    convertMock.mockReturnValue({ ok: true, definition: { nodes: [], edges: [] }, globals: {} });

    const r = await setWorkflowActive('wf-1', true);
    expect(r.ok).toBe(true);
    expect(updates).toContainEqual(expect.objectContaining({ is_active: true }));
  });
});
