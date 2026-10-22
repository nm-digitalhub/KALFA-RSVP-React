// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { refresh, stop, subscribe, captured } = vi.hoisted(() => {
  const captured = { onChange: null as (() => void) | null };
  const stop = vi.fn();
  return {
    refresh: vi.fn(),
    stop,
    captured,
    subscribe: vi.fn((_userId: string, _since: number, cb: () => void) => {
      captured.onChange = cb;
      return stop;
    }),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/realtime/permission-changes', () => ({ subscribePermissionChanges: subscribe }));

import { PermissionChangeListener } from './permission-change-listener';

afterEach(() => {
  cleanup();
  refresh.mockClear();
  stop.mockClear();
  subscribe.mockClear();
  captured.onChange = null;
});

describe('PermissionChangeListener', () => {
  it('subscribes for the signed-in user from the render time and refreshes the route on a signal', () => {
    render(<PermissionChangeListener userId="u-1" renderedAt={1000} />);
    expect(subscribe).toHaveBeenCalledWith('u-1', 1000, expect.any(Function));
    expect(refresh).not.toHaveBeenCalled();
    captured.onChange!();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a new render time (after a refresh) re-subscribes from that time', () => {
    const { rerender } = render(<PermissionChangeListener userId="u-1" renderedAt={1000} />);
    rerender(<PermissionChangeListener userId="u-1" renderedAt={2000} />);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenLastCalledWith('u-1', 2000, expect.any(Function));
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<PermissionChangeListener userId="u-1" renderedAt={1000} />);
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('renders nothing', () => {
    const { container } = render(<PermissionChangeListener userId="u-1" renderedAt={1000} />);
    expect(container.innerHTML).toBe('');
  });
});
