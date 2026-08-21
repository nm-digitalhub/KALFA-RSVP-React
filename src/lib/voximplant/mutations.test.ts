import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addApplicationSecret,
  addVoximplantUser,
  delVoximplantUser,
  getApplicationSecretValue,
  setAccountCallbackUrl,
  setVoximplantUserActive,
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

describe('addVoximplantUser — required fields + the (לא חובה) optional ones', () => {
  it('posts exactly the required fields when no optional param is given', async () => {
    const { lastUrl, lastBody } = stubFetch();
    await addVoximplantUser(cfg, 11107202, 'agent_abc', 'Aa1!aaaaaaaaaaaaaaaaaaaa');
    expect(lastUrl()).toContain('AddUser');
    expect([...lastBody().keys()].sort()).toEqual([
      'application_id',
      'user_active',
      'user_name',
      'user_password',
    ]);
    expect(lastBody().get('user_active')).toBe('true');
  });

  it('includes user_display_name only when non-empty', async () => {
    const { lastBody } = stubFetch();
    await addVoximplantUser(cfg, 11107202, 'agent_abc', 'Aa1!aaaaaaaaaaaaaaaaaaaa', 'שם תצוגה');
    expect(lastBody().get('user_display_name')).toBe('שם תצוגה');
  });

  it('includes parent_accounting, user_custom_data and application_name only when explicitly passed via opts', async () => {
    const { lastBody } = stubFetch();
    await addVoximplantUser(
      cfg,
      11107202,
      'agent_abc',
      'Aa1!aaaaaaaaaaaaaaaaaaaa',
      undefined,
      { parentAccounting: false, userCustomData: 'note', applicationName: 'kalfa-rsvp' },
    );
    expect(lastBody().get('parent_accounting')).toBe('false');
    expect(lastBody().get('user_custom_data')).toBe('note');
    expect(lastBody().get('application_name')).toBe('kalfa-rsvp');
  });

  it('rejects an invalid user_name before any network call', async () => {
    await expect(
      addVoximplantUser(cfg, 11107202, 'Bad Name!', 'Aa1!aaaaaaaaaaaaaaaaaaaa'),
    ).rejects.toThrow('שם משתמש Voximplant אינו תקין');
  });
});

describe('delVoximplantUser — the cleanup AddUser never had', () => {
  it('posts EXACTLY application_id + user_name to DelUser', async () => {
    const { lastUrl, lastBody } = stubFetch();
    await delVoximplantUser(cfg, 11107202, 'agent_abc');
    expect(lastUrl()).toContain('DelUser');
    expect([...lastBody().keys()].sort()).toEqual(['application_id', 'user_name']);
    expect(lastBody().get('application_id')).toBe('11107202');
    expect(lastBody().get('user_name')).toBe('agent_abc');
  });

  it('rejects an invalid user_name before any network call', async () => {
    await expect(delVoximplantUser(cfg, 11107202, 'Bad Name!')).rejects.toThrow(
      'שם משתמש Voximplant אינו תקין',
    );
  });

  it('opts.userId REPLACES user_name in the request (never both)', async () => {
    const { lastBody } = stubFetch();
    await delVoximplantUser(cfg, 11107202, 'agent_abc', { userId: 555 });
    expect(lastBody().has('user_name')).toBe(false);
    expect(lastBody().get('user_id')).toBe('555');
  });

  it('an invalid user_name does not block the call when opts.userId is given instead', async () => {
    const { lastBody } = stubFetch();
    await delVoximplantUser(cfg, 11107202, 'Bad Name!', { userId: 555 });
    expect(lastBody().get('user_id')).toBe('555');
  });

  it('includes application_name when passed via opts', async () => {
    const { lastBody } = stubFetch();
    await delVoximplantUser(cfg, 11107202, 'agent_abc', { applicationName: 'kalfa-rsvp' });
    expect(lastBody().get('application_name')).toBe('kalfa-rsvp');
  });
});

describe('setVoximplantUserActive — restricted to user_active (block/unblock)', () => {
  it('posts EXACTLY application_id + user_name + user_active — no other SetUserInfo field', async () => {
    const { lastUrl, lastBody } = stubFetch();
    await setVoximplantUserActive(cfg, 11107202, 'agent_abc', false);
    expect(lastUrl()).toContain('SetUserInfo');
    expect([...lastBody().keys()].sort()).toEqual(['application_id', 'user_active', 'user_name']);
    expect(lastBody().get('application_id')).toBe('11107202');
    expect(lastBody().get('user_name')).toBe('agent_abc');
    expect(lastBody().get('user_active')).toBe('false');
  });

  it('unblock sends user_active=true', async () => {
    const { lastBody } = stubFetch();
    await setVoximplantUserActive(cfg, 11107202, 'agent_abc', true);
    expect(lastBody().get('user_active')).toBe('true');
  });

  it('rejects an invalid user_name before any network call', async () => {
    await expect(setVoximplantUserActive(cfg, 11107202, 'Bad Name!', false)).rejects.toThrow(
      'שם משתמש Voximplant אינו תקין',
    );
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
