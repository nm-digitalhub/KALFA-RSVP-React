import { describe, expect, it, vi } from 'vitest';

import { REGISTRY_MAX_WAITS, REGISTRY_WAIT_SECONDS, deferForRegistry, nextRegistryWait, registryWaitJobId } from './registry-wait';

describe('nextRegistryWait', () => {
  it('counts up from the first wait and stops after the last', () => {
    expect(nextRegistryWait(undefined)).toBe(1);
    expect(nextRegistryWait(REGISTRY_MAX_WAITS - 1)).toBe(REGISTRY_MAX_WAITS);
    expect(nextRegistryWait(REGISTRY_MAX_WAITS)).toBeNull();
  });
});

describe('deferForRegistry', () => {
  it('re-sends the same payload later, with the wait counted and a per-wait id', async () => {
    const send = vi.fn().mockResolvedValue('id');
    const data: { callbackRequestId: string; registryWaits?: number } = { callbackRequestId: 'req-1' };
    expect(await deferForRegistry({ send }, 'q', 'req-1', data)).toBe(true);
    expect(send).toHaveBeenCalledWith(
      'q',
      { callbackRequestId: 'req-1', registryWaits: 1 },
      expect.objectContaining({ id: registryWaitJobId('q', 'req-1', 1), startAfter: REGISTRY_WAIT_SECONDS }),
    );
  });

  it('a redelivered job reuses the same id for the same wait, so it cannot enqueue the wait twice', () => {
    expect(registryWaitJobId('q', 'req-1', 2)).toBe(registryWaitJobId('q', 'req-1', 2));
    expect(registryWaitJobId('q', 'req-1', 2)).not.toBe(registryWaitJobId('q', 'req-1', 3));
  });

  it('after the last wait nothing is sent, and the caller completes the job', async () => {
    const send = vi.fn();
    expect(await deferForRegistry({ send }, 'q', 'req-1', { registryWaits: REGISTRY_MAX_WAITS })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
