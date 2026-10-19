// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(admin)/admin/integrations/actions', () => ({
  updateSendPolicyAction: vi.fn(),
}));

import { DEFAULT_SEND_POLICY } from '@/lib/outreach/send-policy';
import type { AdminSendPolicy } from '@/lib/data/admin/integrations/send-policy';
import { SendPolicyForm } from './send-policy-form';

// Everything under test is what the form PUTS ON THE PAGE for a given policy, so React renders it, hooks and
// nested components included. Calling the component as a plain function, as this suite once did, is what React
// forbids ("Never call component functions directly", react.dev Rules of React): its hooks then ran outside a
// render, printed "Invalid hook call", and the components behind them were never looked at.

afterEach(cleanup);

function renderForm(policy: AdminSendPolicy): HTMLElement {
  return render(<SendPolicyForm policy={policy} />).container;
}

const text = (container: HTMLElement) => container.textContent ?? '';

/** Every rendered input, by name. */
function inputs(container: HTMLElement): Map<string, HTMLInputElement> {
  return new Map(
    [...container.querySelectorAll<HTMLInputElement>('input[name]')].map((input) => [input.name, input]),
  );
}

const STORED: AdminSendPolicy = {
  policy: DEFAULT_SEND_POLICY,
  source: 'stored',
  invalidReason: null,
};

describe('SendPolicyForm — what it renders', () => {
  it('gives every editable weekday a start and an end, pre-filled', () => {
    const found = inputs(renderForm(STORED));
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
    const found = inputs(renderForm(STORED));
    expect(found.has('weekday.6.start')).toBe(false);
    expect(found.has('weekday.6.end')).toBe(false);
    expect(text(document.body)).toContain('נעול בקוד');
  });

  it('shows the spread in MINUTES, not milliseconds', () => {
    const found = inputs(renderForm(STORED));
    expect(found.get('spreadSpanMinutes')?.defaultValue).toBe('90');
    expect(found.has('spreadSpanMs')).toBe(false);
  });

  it('renders one row per stored preferred time PLUS one blank row', () => {
    const found = inputs(renderForm(STORED));
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
    const found = inputs(renderForm(STORED));
    expect(found.get('preferred.0.days')?.defaultValue).toBe('7');
    expect(found.get('preferred.1.days')?.defaultValue).toBe('3');
    expect(found.get('preferred.2.days')?.defaultValue).toBe('1');
  });

  it('uses time inputs, so the browser posts HH:MM the schema already accepts', () => {
    const found = inputs(renderForm(STORED));
    expect(found.get('weekday.0.start')?.type).toBe('time');
    expect(found.get('hardCap')?.type).toBe('time');
  });
});

describe('SendPolicyForm — the three sources are three different sentences', () => {
  it('stored says these values are what runs', () => {
    expect(text(renderForm(STORED))).toContain('מנוע השליחה משתמש בו כרגע');
  });

  it('default says nothing is saved — not that something is wrong', () => {
    const t = text(renderForm({ policy: DEFAULT_SEND_POLICY, source: 'default', invalidReason: null }));
    expect(t).toContain('לא נשמרה מדיניות');
    expect(t).not.toContain('אינה עוברת אימות');
  });

  it('invalid says the SAVED value is being ignored, and why', () => {
    // The state that had no way to be seen: getSendPolicy() swallows the failure
    // and schedules against the default, so the panel showed a policy nothing
    // obeyed. "We could not read it" and "it is not in use" are different problems.
    const t = text(
      renderForm({
        policy: DEFAULT_SEND_POLICY,
        source: 'invalid',
        invalidReason: 'hardCap לא יכול לעבור 21:00',
      }),
    );
    expect(t).toContain('אינה עוברת אימות');
    expect(t).toContain('hardCap לא יכול לעבור 21:00');
  });
});
