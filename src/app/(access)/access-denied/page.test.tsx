import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
import { requireUser } from '@/lib/auth/dal';
import AccessDeniedPage, { metadata } from './page';

beforeEach(() => vi.resetAllMocks());

describe('AccessDeniedPage', () => {
  it('shows the signed-in account with events and POST logout recovery', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'user-1', email: 'staff@example.test' } as Awaited<ReturnType<typeof requireUser>>);
    const html = renderToStaticMarkup(await AccessDeniedPage());
    expect(requireUser).toHaveBeenCalledOnce();
    expect(html).toContain('אין לך הרשאה לעמוד הזה');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('staff@example.test');
    expect(html).toContain('href="/app/events"');
    expect(html).toContain('action="/auth/logout"');
    expect(html).toContain('method="post"');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('omits the account box when email is absent', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'user-1' } as Awaited<ReturnType<typeof requireUser>>);
    expect(renderToStaticMarkup(await AccessDeniedPage())).not.toContain('החשבון המחובר');
  });

  it('propagates the login redirect without rendering the page', async () => {
    const error = new Error('NEXT_REDIRECT');
    vi.mocked(requireUser).mockRejectedValue(error);
    await expect(AccessDeniedPage()).rejects.toBe(error);
  });
});
