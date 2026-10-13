import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
import { requirePlatformPermission } from '@/lib/auth/dal';
import { GET } from './route';

describe('fleet attachment authorization', () => {
  it('returns plain 403 without following the shared access-denied redirect', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
    }));
    const response = await GET(new Request('https://example.test/api/admin/fleet-file?path=fixture'));
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toBe('Forbidden');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });
});
