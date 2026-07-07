import { describe, expect, it, vi } from 'vitest';

// The reset-password page must gate the form on a verified session (getUser):
// without one, the recovery link was invalid/expired and the form must NOT render.
// Node env (no DOM) — we invoke the async Server Component and walk the returned
// React element tree for the ResetPasswordForm component reference.
vi.mock('server-only', () => ({}));

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));

import ResetPasswordPage from './page';
import { ResetPasswordForm } from './reset-password-form';

function containsType(node: unknown, type: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => containsType(n, type));
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) return true;
  return containsType(el.props?.children, type);
}

describe('ResetPasswordPage — gates the form on a verified session', () => {
  it('renders ResetPasswordForm when a user is present', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const tree = await ResetPasswordPage();
    expect(containsType(tree, ResetPasswordForm)).toBe(true);
  });

  it('does NOT render the form without an authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const tree = await ResetPasswordPage();
    expect(containsType(tree, ResetPasswordForm)).toBe(false);
  });
});
