import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { toConsentView, type OAuthAuthorizationDetails } from './use-oauth-consent';

const full = {
  authorization_id: 'a1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c1', name: 'Claude', uri: '', logo_uri: '' },
  user: { id: 'u1', email: 'owner@example.com' },
  scope: 'openid email',
} satisfies OAuthAuthorizationDetails;

describe('toConsentView', () => {
  it('reads a complete authorization', () => {
    expect(toConsentView(full)).toEqual({
      clientName: 'Claude',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      email: 'owner@example.com',
      scopes: ['openid', 'email'],
    });
  });

  it('survives the omitempty fields Supabase drops (no scope → the crash seen on 28.9)', () => {
    const sparse = { authorization_id: 'a1' } as unknown as OAuthAuthorizationDetails;
    expect(toConsentView(sparse)).toEqual({ clientName: 'אפליקציה', redirectUri: '', email: null, scopes: [] });
  });

  it('an empty scope string yields no scopes', () => {
    expect(toConsentView({ ...full, scope: '' }).scopes).toEqual([]);
  });
});
