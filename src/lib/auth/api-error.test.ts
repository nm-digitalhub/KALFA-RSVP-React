import { describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';

vi.mock('server-only', () => ({}));
import { platformAuthErrorResponse } from './api-error';

function redirectError(path: string) {
  try { redirect(path); } catch (error) { return error; }
}

describe('platformAuthErrorResponse', () => {
  it.each([
    ['/auth/login', 401, 'unauthorized'],
    ['/access-denied', 403, 'forbidden'],
  ] as const)('translates the real Next redirect to %s', async (path, status, code) => {
    const response = platformAuthErrorResponse(redirectError(path));
    expect(response?.status).toBe(status);
    expect(response?.headers.get('location')).toBeNull();
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
    await expect(response?.json()).resolves.toEqual({ error: code });
  });

  it('leaves other navigation and application failures to the caller', () => {
    expect(platformAuthErrorResponse(redirectError('/elsewhere'))).toBeNull();
    expect(platformAuthErrorResponse(new Error('db down'))).toBeNull();
    expect(platformAuthErrorResponse({ digest: 'NEXT_REDIRECT' })).toBeNull();
  });
});
