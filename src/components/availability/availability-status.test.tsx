// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshAvailabilityAction = vi.fn();

vi.mock('./actions', () => ({
  refreshAvailabilityAction: () => refreshAvailabilityAction(),
  clearAvailabilityAction: vi.fn(),
  removeAvailabilityBlockAction: vi.fn(),
  setAvailabilityBlockAction: vi.fn(),
}));

import { AvailabilityMenuSection } from './availability-status';

// The section pulls live state once right after mount (deferred one macrotask)
// and again on every window focus, and stops listening once unmounted.
beforeEach(() => {
  vi.useFakeTimers();
  refreshAvailabilityAction.mockReset();
  refreshAvailabilityAction.mockResolvedValue({
    ok: true,
    blocks: [],
    presence: { showAs: 'free', untilIso: null, ownedByApp: false },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount() {
  return render(
    <AvailabilityMenuSection
      initialBlocks={[]}
      initialPresence={{ showAs: 'free', untilIso: null, ownedByApp: false }}
      hasConnection
    />,
  );
}

describe('AvailabilityMenuSection live refresh', () => {
  it('refreshes once, on the tick after mount — not during the commit', async () => {
    mount();
    expect(refreshAvailabilityAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refreshAvailabilityAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refreshAvailabilityAction).toHaveBeenCalledTimes(1);
  });

  it('refreshes on window focus, and not after unmount', async () => {
    const { unmount } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refreshAvailabilityAction.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(refreshAvailabilityAction).toHaveBeenCalledTimes(1);

    unmount();
    window.dispatchEvent(new Event('focus'));
    expect(refreshAvailabilityAction).toHaveBeenCalledTimes(1);
  });

  it('an unmount before the first tick cancels the mount refresh', async () => {
    const { unmount } = mount();
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(refreshAvailabilityAction).not.toHaveBeenCalled();
  });
});
