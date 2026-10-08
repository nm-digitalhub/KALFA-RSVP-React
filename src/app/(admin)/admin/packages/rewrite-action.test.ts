import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { permission, run } = vi.hoisted(() => ({ permission: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permission }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/ai/package-copy', () => ({
  runPackageCopy: run,
  PackageCopyError: class extends Error { constructor(public code: string) { super(code); } },
}));

import { rewritePackageCopyAction } from './rewrite-action';

beforeEach(() => {
  permission.mockReset().mockResolvedValue({ id: 'staff-1' });
  run.mockReset();
});

describe('package copy action', () => {
  it('does not start Claude when authorization fails', async () => {
    permission.mockRejectedValue(new Error('denied'));
    await expect(rewritePackageCopyAction('description', 'Original')).rejects.toThrow('denied');
    expect(run).not.toHaveBeenCalled();
  });
  it('refuses unknown fields and empty or oversized input', async () => {
    for (const [field, text] of [['price', 'Original'], ['description', ' '], ['description', 'x'.repeat(2001)]]) {
      expect((await rewritePackageCopyAction(field, text)).ok).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects oversized output', async () => {
    run.mockResolvedValue('x'.repeat(2001));
    expect((await rewritePackageCopyAction('description', 'Original')).ok).toBe(false);
  });
  it('keeps one output line per input item', async () => {
    run.mockResolvedValue('Only one');
    expect((await rewritePackageCopyAction('includes', 'First\nSecond')).ok).toBe(false);
    run.mockResolvedValue(' First improved \n\n Second improved ');
    expect(await rewritePackageCopyAction('includes', 'First\nSecond')).toEqual({
      ok: true, text: 'First improved\nSecond improved',
    });
  });
  it('returns a safe error for an internal failure', async () => {
    run.mockRejectedValue(new Error('SECRET ERROR'));
    const result = await rewritePackageCopyAction('description', 'Original');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
