import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  parseOAuthCredentialSecret,
  serializeOAuthCredentialSecret,
} from './credential-secret';

describe('OAuth credential secret envelope', () => {
  it('round-trips the access and refresh token without storing expiry metadata', () => {
    const raw = serializeOAuthCredentialSecret({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'bearer',
    });

    expect(JSON.parse(raw)).toEqual({
      v: 1,
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
    });
    expect(parseOAuthCredentialSecret(raw)).toEqual({
      version: 1,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
    });
  });

  it('rejects legacy/raw text instead of guessing its meaning', () => {
    expect(() => parseOAuthCredentialSecret('plain-access-token')).toThrowError(
      expect.objectContaining({ code: 'integration_credential_invalid' }),
    );
  });
});
