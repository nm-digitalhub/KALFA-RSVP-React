import 'server-only';

import { IntegrationRuntimeError } from './errors';

export type OAuthCredentialSecret = {
  version: 1;
  accessToken: string;
  refreshToken?: string;
  tokenType: 'Bearer';
};

type StoredOAuthCredentialSecretV1 = {
  v: 1;
  access_token: string;
  refresh_token?: string;
  token_type: 'Bearer';
};

export function serializeOAuthCredentialSecret(input: {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
}): string {
  const accessToken = input.accessToken.trim();
  if (!accessToken) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_credential_invalid',
      'OAuth credential is missing an access token.',
    );
  }

  const tokenType = (input.tokenType ?? 'Bearer').trim();
  if (tokenType.toLowerCase() !== 'bearer') {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_credential_invalid',
      `Unsupported OAuth token type: ${tokenType || '(empty)'}.`,
    );
  }

  const refreshToken = input.refreshToken?.trim();
  const stored: StoredOAuthCredentialSecretV1 = {
    v: 1,
    access_token: accessToken,
    token_type: 'Bearer',
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  };

  return JSON.stringify(stored);
}

export function parseOAuthCredentialSecret(raw: string): OAuthCredentialSecret {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_credential_invalid',
      'Stored OAuth credential is not valid JSON.',
      { cause },
    );
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_credential_invalid',
      'Stored OAuth credential has an invalid shape.',
    );
  }

  const record = value as Record<string, unknown>;
  if (record.v !== 1) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_credential_version_unsupported',
      'Stored OAuth credential version is not supported.',
    );
  }

  const accessToken = typeof record.access_token === 'string' ? record.access_token.trim() : '';
  const tokenType = typeof record.token_type === 'string' ? record.token_type.trim() : '';
  const refreshToken =
    typeof record.refresh_token === 'string' && record.refresh_token.trim()
      ? record.refresh_token.trim()
      : undefined;

  if (!accessToken || tokenType.toLowerCase() !== 'bearer') {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_credential_invalid',
      'Stored OAuth credential is missing a Bearer access token.',
    );
  }

  return {
    version: 1,
    accessToken,
    tokenType: 'Bearer',
    ...(refreshToken ? { refreshToken } : {}),
  };
}
