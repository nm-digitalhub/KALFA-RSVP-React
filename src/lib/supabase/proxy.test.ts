import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const claims = vi.fn();

// What @supabase/ssr does when a token is refreshed: it hands back cookies plus the no-store headers that must travel
// with them.
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (...args: unknown[]) => void } }) => ({
    auth: {
      getClaims: async () => {
        options.cookies.setAll(
          [{ name: 'sb-session', value: 'refreshed', options: { path: '/' } }],
          { 'Cache-Control': 'private, no-store' },
        );
        return claims();
      },
    },
  }),
}));
vi.mock('@/lib/supabase/env', () => ({ getPublicSupabaseEnv: () => ({ url: 'https://x.supabase.co', anonKey: 'anon' }) }));

const { updateSession } = await import('./proxy');

describe('updateSession — a rewritten page', () => {
  it('keeps a refreshed session on the rewrite response', async () => {
    claims.mockResolvedValue({ data: { claims: { sub: 'user' } } });
    const request = new NextRequest('https://beta.kalfa.me/en/about');
    const url = new URL('https://beta.kalfa.me/about');

    const response = await updateSession(request, { url, headers: new Headers({ 'x-i18next-current-language': 'en' }) });

    expect(response.headers.get('x-middleware-rewrite')).toBe(url.toString());
    expect(response.headers.get('x-middleware-request-x-i18next-current-language')).toBe('en');
    expect(response.cookies.get('sb-session')?.value).toBe('refreshed');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
