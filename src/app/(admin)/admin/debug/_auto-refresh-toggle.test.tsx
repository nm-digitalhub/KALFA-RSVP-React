// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoRefreshToggle as DebugToggle } from './_auto-refresh-toggle';
import { AutoRefreshToggle as RelocationToggle } from '../relocation/_auto-refresh-toggle';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

// The two opt-in refresh switches share one pattern: a per-browser preference in
// localStorage (default OFF) and a 30s refresh only while it is on.
const cases = [
  { name: 'debug', Toggle: DebugToggle, key: 'kalfa-debug-auto-refresh' },
  { name: 'relocation', Toggle: RelocationToggle, key: 'kalfa-relocation-auto-refresh' },
] as const;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refresh.mockReset();
});

const theSwitch = () => screen.getByRole('switch');

describe.each(cases)('$name auto-refresh switch', ({ Toggle, key }) => {
  it('is off by default and does not refresh', () => {
    vi.useFakeTimers();
    render(<Toggle />);

    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads a value stored by the previous format ("true")', () => {
    localStorage.setItem(key, 'true');
    render(<Toggle />);

    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('turning it on stores it and refreshes every 30 seconds', () => {
    vi.useFakeTimers();
    render(<Toggle />);

    fireEvent.click(theSwitch());

    expect(localStorage.getItem(key)).toBe('true');
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('follows a change made in another tab', () => {
    render(<Toggle />);

    act(() => {
      localStorage.setItem(key, 'true');
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'true', storageArea: localStorage }));
    });

    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
  });
});
