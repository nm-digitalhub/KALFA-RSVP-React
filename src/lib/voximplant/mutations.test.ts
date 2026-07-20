import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addApplicationSecret,
  getApplicationSecretValue,
  setAccountCallbackUrl,
  startScenarios,
} from './mutations';
import type { VoximplantConfig } from './core';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const cfg: VoximplantConfig = { accountId: 1, keyId: 'k', privateKey };

function stubFetch(): { lastUrl: () => string; lastBody: () => URLSearchParams } {
  let url = '';
  let body: URLSearchParams = new URLSearchParams();
  vi.stubGlobal('fetch', async (u: string, init: { body: URLSearchParams }) => {
    url = String(u);
    body = init.body;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ result: 1 }),
    } as unknown as Response;
  });
  return { lastUrl: () => url, lastBody: () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setAccountCallbackUrl — restricted SetAccountInfo (plan B5)', () => {
  it('sends EXACTLY callback_url + callback_salt — no other account field can leak', async () => {
    const { lastUrl, lastBody } = stubFetch();
    await setAccountCallbackUrl(cfg, 'https://beta.kalfa.me/api/x', 'salt-1');
    expect(lastUrl()).toContain('SetAccountInfo');
    // Exact body keys pinned (owner directive): nothing but the two fields.
    expect([...lastBody().keys()].sort()).toEqual(['callback_salt', 'callback_url']);
    expect(lastBody().get('callback_url')).toBe('https://beta.kalfa.me/api/x');
    expect(lastBody().get('callback_salt')).toBe('salt-1');
  });

  it('null clears the values provider-side (rollback to no-callback state)', async () => {
    const { lastBody } = stubFetch();
    await setAccountCallbackUrl(cfg, null, null);
    expect([...lastBody().keys()].sort()).toEqual(['callback_salt', 'callback_url']);
    expect(lastBody().get('callback_url')).toBe('');
    expect(lastBody().get('callback_salt')).toBe('');
  });
});

describe('application Secrets wrappers — exact bodies, no caller-input spread', () => {
  it('getApplicationSecretValue posts EXACTLY application_id + secret_name', async () => {
    const { lastUrl, lastBody } = stubFetch();
    await getApplicationSecretValue(cfg, 11107202, 'ELEVENLABS_API_KEY');
    expect(lastUrl()).toContain('GetSecretValue');
    expect([...lastBody().keys()].sort()).toEqual(['application_id', 'secret_name']);
    expect(lastBody().get('application_id')).toBe('11107202');
    expect(lastBody().get('secret_name')).toBe('ELEVENLABS_API_KEY');
  });

  it('addApplicationSecret posts EXACTLY application_id + secret_name + secret_value', async () => {
    const { lastUrl, lastBody } = stubFetch();
    await addApplicationSecret(cfg, 11107202, 'ELEVENLABS_API_KEY', 'v');
    expect(lastUrl()).toContain('AddSecret');
    expect([...lastBody().keys()].sort()).toEqual([
      'application_id',
      'secret_name',
      'secret_value',
    ]);
  });
});

describe('startScenarios — behavior unchanged after the move from core', () => {
  it('posts rule_id + script_custom_data to StartScenarios', async () => {
    const { lastUrl, lastBody } = stubFetch();
    const res = await startScenarios(cfg, {
      rule_id: 1494311,
      script_custom_data: '{"to":"+972500000000"}',
    });
    expect(lastUrl()).toContain('StartScenarios');
    expect(lastBody().get('rule_id')).toBe('1494311');
    expect(lastBody().get('script_custom_data')).toBe('{"to":"+972500000000"}');
    expect(res.result).toBe(1);
  });
});
