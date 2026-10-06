import { describe, expect, it } from 'vitest';

import { appSecretProof, withAppSecretProof } from './appsecret-proof';

// Meta (facebook-login/security, "Secure Server-side Calls with appsecret_proof"):
// hash_hmac('sha256', $access_token.'|'.time(), $app_secret), sent with
// appsecret_time. MEASURED 2026-09-25 against Graph v25.0: this form is
// accepted, a wrong proof is rejected (code 100), and hmac(token) WITH
// appsecret_time is rejected — the time must be inside the hash.

describe('appSecretProof', () => {
  it('is HMAC-SHA256(key=app secret, "token|time") as hex, with the same time', () => {
    expect(appSecretProof('TOKEN', 'APP-SECRET', 1790000000)).toEqual({
      appsecret_proof: 'd69034ccc190ed235907053d1ee1b0a7b9148e829c4ba264fa05df63649dd42d',
      appsecret_time: '1790000000',
    });
  });

  it('floors a fractional timestamp (Meta: convert to an integer first)', () => {
    expect(appSecretProof('TOKEN', 'APP-SECRET', 1790000000.9).appsecret_time).toBe('1790000000');
  });
});

describe('withAppSecretProof', () => {
  it('adds both parameters and keeps the existing query', () => {
    const url = new URL(
      withAppSecretProof('https://graph.facebook.com/1?fields=id', 'TOKEN', 'APP-SECRET', 1790000000),
    );
    expect(url.searchParams.get('fields')).toBe('id');
    expect(url.searchParams.get('appsecret_proof')).toBe('d69034ccc190ed235907053d1ee1b0a7b9148e829c4ba264fa05df63649dd42d');
    expect(url.searchParams.get('appsecret_time')).toBe('1790000000');
  });

  it('replaces a stale proof already on the URL (a followed paging.next)', () => {
    const url = new URL(
      withAppSecretProof(
        'https://graph.facebook.com/1?after=X&appsecret_proof=old&appsecret_time=1',
        'TOKEN',
        'APP-SECRET',
        1790000000,
      ),
    );
    expect(url.searchParams.getAll('appsecret_proof')).toEqual(['d69034ccc190ed235907053d1ee1b0a7b9148e829c4ba264fa05df63649dd42d']);
    expect(url.searchParams.get('after')).toBe('X');
  });
});
