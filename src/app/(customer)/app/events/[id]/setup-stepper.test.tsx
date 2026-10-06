// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SETUP_STEP_LABELS, type SetupStep } from '@/lib/data/setup-steps';

import { SetupStepper, type SetupStepView } from './setup-stepper';

afterEach(cleanup);

const steps = (states: SetupStep['state'][], hints: Record<number, string> = {}): SetupStepView[] =>
  (['details', 'confirm', 'sign', 'pay', 'live'] as const).map((key, i) => ({
    key,
    label: SETUP_STEP_LABELS[key],
    state: states[i],
    hint: hints[i],
  }));

describe('SetupStepper', () => {
  it('renders one list item per step, in order, under a Hebrew accessible name', () => {
    render(<SetupStepper steps={steps(['done', 'current', 'pending', 'pending', 'pending'])} />);
    expect(screen.getByRole('group', { name: 'שלבי ההקמה' })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0].textContent).toContain('1. פרטי האירוע');
    expect(items[3].textContent).toContain('4. אמצעי תשלום');
  });

  it('marks exactly the current step with aria-current and speaks every state', () => {
    render(<SetupStepper steps={steps(['done', 'current', 'pending', 'pending', 'pending'])} />);
    const items = screen.getAllByRole('listitem');
    expect(items.filter((li) => li.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[0].textContent).toContain('הושלם');
    expect(items[1].textContent).toContain('שלב נוכחי');
    expect(items[2].textContent).toContain('ממתין');
  });

  it('a blocked step shows its hint and is not announced as current', () => {
    render(
      <SetupStepper
        steps={steps(['done', 'blocked', 'pending', 'pending', 'pending'], {
          1: 'יש להשלים: מקום האירוע',
        })}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[1].textContent).toContain('חסום');
    expect(items[1].textContent).toContain('יש להשלים: מקום האירוע');
    expect(items[1].getAttribute('aria-current')).toBeNull();
    expect(items[1].hasAttribute('data-blocked')).toBe(true);
  });

  it('when every step is done, none is announced as current', () => {
    render(<SetupStepper steps={steps(['done', 'done', 'done', 'done', 'done'])} />);
    const items = screen.getAllByRole('listitem');
    expect(items.every((li) => li.getAttribute('aria-current') === null)).toBe(true);
    expect(items.every((li) => li.textContent?.includes('הושלם'))).toBe(true);
  });
});

describe('SetupStepper — the optional package step', () => {
  const withPackage = (states: SetupStep['state'][]): SetupStepView[] =>
    (['details', 'confirm', 'package', 'sign', 'pay', 'live'] as const).map((key, i) => ({
      key,
      label: SETUP_STEP_LABELS[key],
      state: states[i],
    }));

  it('renders the package step in its place and numbers the steps in the order the owner sees them', () => {
    render(<SetupStepper steps={withPackage(['done', 'done', 'current', 'pending', 'pending', 'pending'])} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[2].textContent).toContain('3. בחירת חבילה');
    expect(items[3].textContent).toContain('4. קריאת ההסכם וחתימה');
    expect(items[2].getAttribute('aria-current')).toBe('step');
  });

  it('without the package step the numbering has no gap: 1 to 5', () => {
    render(<SetupStepper steps={steps(['done', 'done', 'current', 'pending', 'pending'])} />);
    const numbers = screen.getAllByRole('listitem').map((li) => li.textContent?.match(/^(\d+)\./)?.[1]);
    expect(numbers).toEqual(['1', '2', '3', '4', '5']);
  });
});
