import { beforeEach, describe, expect, it, vi } from 'vitest';

// The GET interstitial must NOT verify (that's the whole prefetch mitigation): it
// renders a form carrying the token in hidden fields, and only the POST
// (confirmOtp) verifies. createClient is spied to prove GET never creates a client.
vi.mock('server-only', () => ({}));

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  }),
}));

import ConfirmPage from './page';
import { SubmitButton } from '@/components/forms';

function call(params: Record<string, string>) {
  return ConfirmPage({ searchParams: Promise.resolve(params) });
}

// Flatten the returned React element tree.
function collect(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  out.push(el as Record<string, unknown>);
  collect(el.props?.children, out);
  return out;
}

beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
  vi.clearAllMocks();
});

describe('/auth/confirm page — GET interstitial', () => {
  it('valid link → renders the confirm form (hidden token_hash/type/next), NEVER verifies', async () => {
    const tree = await call({ token_hash: 'abc', type: 'recovery', next: '/auth/reset-password' });

    // No client / no verifyOtp on GET:
    expect(createClient).not.toHaveBeenCalled();

    const els = collect(tree);
    expect(els.some((e) => (e as { type?: unknown }).type === SubmitButton)).toBe(true);

    const hidden = els.filter(
      (e) =>
        (e as { type?: unknown }).type === 'input' &&
        (e as { props?: { type?: string } }).props?.type === 'hidden',
    );
    const byName = Object.fromEntries(
      hidden.map((e) => {
        const p = (e as { props: { name: string; value: string } }).props;
        return [p.name, p.value];
      }),
    );
    expect(byName.token_hash).toBe('abc');
    expect(byName.type).toBe('recovery');
    expect(byName.next).toBe('/auth/reset-password'); // sanitized, same-origin path
  });

  it('missing token_hash → redirect /auth/login (no verify)', async () => {
    await expect(call({ type: 'recovery' })).rejects.toMatchObject({
      digest: expect.stringContaining('/auth/login'),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('invalid type → redirect /auth/login', async () => {
    await expect(call({ token_hash: 'abc', type: 'bogus' })).rejects.toMatchObject({
      digest: expect.stringContaining('/auth/login'),
    });
  });

  it('email_change (accepted type) → renders the confirm form, never verifies on GET', async () => {
    const tree = await call({ token_hash: 'abc', type: 'email_change', next: '/app' });
    expect(createClient).not.toHaveBeenCalled();
    expect(collect(tree).some((e) => (e as { type?: unknown }).type === SubmitButton)).toBe(true);
  });
});
