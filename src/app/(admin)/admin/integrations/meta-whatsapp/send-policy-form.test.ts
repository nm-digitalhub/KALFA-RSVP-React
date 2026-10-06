import { describe, expect, it, vi } from 'vitest';

// The form calls useActionState, which throws outside a React render. Everything
// under test here is what the component PUTS IN THE TREE for a given policy, so the
// hook is replaced with its untouched initial state rather than dragging in a DOM.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useActionState: () => [null, vi.fn()] };
});
vi.mock('@/app/(admin)/admin/integrations/actions', () => ({
  updateSendPolicyAction: vi.fn(),
}));

import { DEFAULT_SEND_POLICY } from '@/lib/outreach/send-policy';
import type { AdminSendPolicy } from '@/lib/data/admin/integrations/send-policy';
import { SendPolicyForm } from './send-policy-form';

type El = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

// Nested function components are INVOKED — TimeInput, NumberInput and Badge are
// where the values actually land, and a walker that only descends `children` would
// see unexecuted elements and assert nothing.
function collect(node: unknown, out: El[] = [], depth = 0): El[] {
  if (!node || typeof node !== 'object' || depth > 60) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out, depth + 1));
    return out;
  }
  const el = node as El;
  out.push(el);
  if (typeof el.type === 'function') {
    try {
      collect((el.type as (p: unknown) => unknown)(el.props ?? {}), out, depth + 1);
    } catch {
      /* a component needing a runtime we lack is simply not descended into */
    }
  }
  collect(el.props?.children, out, depth + 1);
  return out;
}

function text(tree: unknown): string {
  return collect(tree)
    .flatMap((el) => {
      const c = el.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((t): t is string => typeof t === 'string')
    .join(' ');
}

/** Every rendered input, by name. */
function inputs(tree: unknown): Map<string, El['props']> {
  const out = new Map<string, El['props']>();
  for (const el of collect(tree)) {
    const name = el.props?.name;
    if (typeof name === 'string' && el.type === 'input') out.set(name, el.props);
  }
  return out;
}

const STORED: AdminSendPolicy = {
  policy: DEFAULT_SEND_POLICY,
  source: 'stored',
  invalidReason: null,
};

describe('SendPolicyForm — what it renders', () => {
  it('gives every editable weekday a start and an end, pre-filled', () => {
    const found = inputs(SendPolicyForm({ policy: STORED }));
    for (let d = 0; d <= 5; d++) {
      expect(found.get(`weekday.${d}.start`)?.defaultValue).toBe(
        DEFAULT_SEND_POLICY.weekday[d]!.start,
      );
      expect(found.get(`weekday.${d}.end`)?.defaultValue).toBe(
        DEFAULT_SEND_POLICY.weekday[d]!.end,
      );
    }
  });

  it('renders NO Saturday input at all', () => {
    // Not disabled — absent. A disabled control says "you may not", which invites
    // "who may?". There is no answer: Shabbat sends need a code change.
    const found = inputs(SendPolicyForm({ policy: STORED }));
    expect(found.has('weekday.6.start')).toBe(false);
    expect(found.has('weekday.6.end')).toBe(false);
    expect(text(SendPolicyForm({ policy: STORED }))).toContain('נעול בקוד');
  });

  it('shows the spread in MINUTES, not milliseconds', () => {
    const found = inputs(SendPolicyForm({ policy: STORED }));
    expect(found.get('spreadSpanMinutes')?.defaultValue).toBe('90');
    expect(found.has('spreadSpanMs')).toBe(false);
  });

  it('renders one row per stored preferred time PLUS one blank row', () => {
    const found = inputs(SendPolicyForm({ policy: STORED }));
    const keys = Object.keys(DEFAULT_SEND_POLICY.preferredTimeByDaysBefore);
    for (let i = 0; i < keys.length; i++) {
      expect(found.get(`preferred.${i}.days`)?.defaultValue).not.toBe('');
    }
    // The blank row is what lets an admin add a days_before the policy has never
    // carried, without a migration or a developer.
    expect(found.get(`preferred.${keys.length}.days`)?.defaultValue).toBe('');
    expect(found.get(`preferred.${keys.length}.time`)?.defaultValue).toBe('');
  });

  it('sorts the preferred rows by days-before descending — send order', () => {
    const found = inputs(SendPolicyForm({ policy: STORED }));
    expect(found.get('preferred.0.days')?.defaultValue).toBe('7');
    expect(found.get('preferred.1.days')?.defaultValue).toBe('3');
    expect(found.get('preferred.2.days')?.defaultValue).toBe('1');
  });

  it('uses time inputs, so the browser posts HH:MM the schema already accepts', () => {
    const found = inputs(SendPolicyForm({ policy: STORED }));
    expect(found.get('weekday.0.start')?.type).toBe('time');
    expect(found.get('hardCap')?.type).toBe('time');
  });
});

describe('SendPolicyForm — the three sources are three different sentences', () => {
  it('stored says these values are what runs', () => {
    expect(text(SendPolicyForm({ policy: STORED }))).toContain('מנוע השליחה משתמש בו כרגע');
  });

  it('default says nothing is saved — not that something is wrong', () => {
    const t = text(
      SendPolicyForm({
        policy: { policy: DEFAULT_SEND_POLICY, source: 'default', invalidReason: null },
      }),
    );
    expect(t).toContain('לא נשמרה מדיניות');
    expect(t).not.toContain('אינה עוברת אימות');
  });

  it('invalid says the SAVED value is being ignored, and why', () => {
    // The state that had no way to be seen: getSendPolicy() swallows the failure
    // and schedules against the default, so the panel showed a policy nothing
    // obeyed. "We could not read it" and "it is not in use" are different problems.
    const t = text(
      SendPolicyForm({
        policy: {
          policy: DEFAULT_SEND_POLICY,
          source: 'invalid',
          invalidReason: 'hardCap לא יכול לעבור 21:00',
        },
      }),
    );
    expect(t).toContain('אינה עוברת אימות');
    expect(t).toContain('hardCap לא יכול לעבור 21:00');
  });
});
