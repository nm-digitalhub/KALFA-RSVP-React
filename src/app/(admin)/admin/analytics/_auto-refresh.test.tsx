// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoRefresh } from './_auto-refresh';

// jsdom has no App Router; the real useRouter throws outside one.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  refresh.mockReset();
});

describe('AutoRefresh (analytics)', () => {
  it('refreshes every 60 seconds while the tab is visible', () => {
    render(<AutoRefresh />);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('skips the tick while the tab is hidden', () => {
    render(<AutoRefresh />);
    visibility = 'hidden';

    vi.advanceTimersByTime(60_000);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops on unmount', () => {
    const { unmount } = render(<AutoRefresh />);
    unmount();

    vi.advanceTimersByTime(180_000);

    expect(refresh).not.toHaveBeenCalled();
  });
});
