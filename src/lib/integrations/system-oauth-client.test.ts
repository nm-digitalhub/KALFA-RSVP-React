import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  readSystemOAuthClient,
  systemOAuthEnvKeys,
} from './system-oauth-client';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('system OAuth client configuration', () => {
  it('derives generic environment keys from the provider id', () => {
    expect(systemOAuthEnvKeys('microsoft')).toEqual({
      clientId: 'INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID',
      clientSecret: 'INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET',
    });
    expect(systemOAuthEnvKeys('example-provider')).toEqual({
      clientId: 'INTEGRATION_OAUTH_EXAMPLE_PROVIDER_CLIENT_ID',
      clientSecret: 'INTEGRATION_OAUTH_EXAMPLE_PROVIDER_CLIENT_SECRET',
    });
  });

  it('returns a complete deployment client without exposing it anywhere else', () => {
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID = 'client-123';
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET = 'secret-456';

    expect(readSystemOAuthClient('microsoft')).toEqual({
      clientId: 'client-123',
      clientSecret: 'secret-456',
    });
  });

  it('refuses partial configuration', () => {
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID = 'client-123';
    delete process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET;

    expect(readSystemOAuthClient('microsoft')).toBeNull();
  });

  it('preserves the secret bytes used for client authentication', () => {
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID = '  client-123  ';
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET = ' secret-with-spaces ';

    expect(readSystemOAuthClient('microsoft')).toEqual({
      clientId: 'client-123',
      clientSecret: ' secret-with-spaces ',
    });
  });
});
