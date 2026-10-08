// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETUP_STEP_LABELS, type SetupStep } from '@/lib/data/setup-steps';

import { SetupStepper, type SetupStepView } from './setup-stepper';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

beforeEach(() => pushMock.mockClear());
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

  describe('back', () => {
    const BACK = { href: '/app/events/e1/setup?step=details', label: 'פרטי האירוע' };
    const onConfirm = () => steps(['done', 'current', 'pending', 'pending', 'pending']);

    it('shows no button at all when the server offers no back: the stepper is a view, nothing else can change the step', () => {
      render(<SetupStepper steps={onConfirm()} />);
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('shows the library\'s Prev button, named for the step it leads to — and no Next, no per-step trigger', () => {
      render(<SetupStepper steps={onConfirm()} back={BACK} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].textContent).toContain('חזרה: פרטי האירוע');
      expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    });

    it('follows the server\'s link when pressed, once', () => {
      render(<SetupStepper steps={onConfirm()} back={BACK} />);
      fireEvent.click(screen.getByRole('button', { name: /חזרה: פרטי האירוע/ }));
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith('/app/events/e1/setup?step=details');
    });

    it('cannot go anywhere from the first step: the library disables Prev there, so a stray back changes nothing', () => {
      render(<SetupStepper steps={steps(['current', 'pending', 'pending', 'pending', 'pending'])} back={BACK} />);
      const button = screen.getByRole('button', { name: /חזרה/ }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(pushMock).not.toHaveBeenCalled();
    });

    it('keeps announcing the same current step while a back is offered', () => {
      render(<SetupStepper steps={onConfirm()} back={BACK} />);
      const items = screen.getAllByRole('listitem');
      expect(items.filter((li) => li.getAttribute('aria-current') === 'step')).toHaveLength(1);
      expect(items[1].getAttribute('aria-current')).toBe('step');
    });
  });
});
