// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from './use-media-query';

// useSyncExternalStore re-subscribes whenever its `subscribe` argument changes
// identity. These tests pin that the matchMedia listener is installed once per
// query, not once per render of the caller.
type Listener = () => void;

function mockMatchMedia(initial: Record<string, boolean>) {
  const matches = { ...initial };
  const listeners = new Map<string, Set<Listener>>();
  const addEventListener = vi.fn((query: string, _type: string, listener: Listener) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    listeners.get(query)!.add(listener);
  });
  const removeEventListener = vi.fn((query: string, _type: string, listener: Listener) => {
    listeners.get(query)?.delete(listener);
  });

  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches[query] ?? false;
    },
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: Listener) => addEventListener(query, type, listener),
    removeEventListener: (type: string, listener: Listener) =>
      removeEventListener(query, type, listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return {
    addEventListener,
    removeEventListener,
    set(query: string, value: boolean) {
      matches[query] = value;
      for (const listener of listeners.get(query) ?? []) listener();
    },
  };
}

const originalMatchMedia = window.matchMedia;

describe('useMediaQuery', () => {
  let media: ReturnType<typeof mockMatchMedia>;

  beforeEach(() => {
    media = mockMatchMedia({ '(min-width: 64rem)': true, '(pointer: coarse)': false });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('subscribes once across re-renders with the same query', () => {
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 64rem)' },
    });

    expect(result.current).toBe(true);
    rerender({ query: '(min-width: 64rem)' });
    rerender({ query: '(min-width: 64rem)' });
    rerender({ query: '(min-width: 64rem)' });

    expect(media.addEventListener).toHaveBeenCalledTimes(1);
    expect(media.removeEventListener).not.toHaveBeenCalled();
  });

  it('re-renders with the new value when the media query changes', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 64rem)'));
    expect(result.current).toBe(true);

    act(() => media.set('(min-width: 64rem)', false));

    expect(result.current).toBe(false);
  });

  it('moves the listener when the query itself changes', () => {
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 64rem)' },
    });

    rerender({ query: '(pointer: coarse)' });

    expect(result.current).toBe(false);
    expect(media.addEventListener).toHaveBeenCalledTimes(2);
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    expect(media.removeEventListener.mock.calls[0]![0]).toBe('(min-width: 64rem)');
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 64rem)'));

    unmount();

    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
