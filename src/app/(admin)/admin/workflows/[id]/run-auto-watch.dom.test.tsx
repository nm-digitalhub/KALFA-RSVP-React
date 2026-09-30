// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunAutoWatch } from './run-auto-watch';
import { watchRun } from './run-watcher';

// The watcher opens an EventSource stream; what is under test here is the
// switch's stored preference and the attach decision it feeds.
vi.mock('./run-watcher', () => ({ watchRun: vi.fn(), isWatchedByUser: () => false }));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.mocked(watchRun).mockReset();
});

const theSwitch = () => screen.getByRole('switch');
const isOn = () => theSwitch().getAttribute('aria-checked') === 'true';

describe('RunAutoWatch switch', () => {
  it('⚠️ is ON for a reader who never touched it, and attaches to a new run', () => {
    const { rerender } = render(<RunAutoWatch newestRun={{ id: 'r1', status: 'completed' }} />);
    expect(isOn()).toBe(true);

    rerender(<RunAutoWatch newestRun={{ id: 'r2', status: 'running' }} />);

    expect(watchRun).toHaveBeenCalledWith('r2', { byUser: false });
  });

  it('respects a stored OFF (the previous format stored "false")', () => {
    localStorage.setItem('kalfa-workflow-auto-watch', 'false');
    const { rerender } = render(<RunAutoWatch newestRun={{ id: 'r1', status: 'completed' }} />);
    expect(isOn()).toBe(false);

    rerender(<RunAutoWatch newestRun={{ id: 'r2', status: 'running' }} />);

    expect(watchRun).not.toHaveBeenCalled();
  });

  it('turning it off is stored', () => {
    render(<RunAutoWatch newestRun={null} />);

    fireEvent.click(theSwitch());

    expect(localStorage.getItem('kalfa-workflow-auto-watch')).toBe('false');
    expect(isOn()).toBe(false);
  });
});
