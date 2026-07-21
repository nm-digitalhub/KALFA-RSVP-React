import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { computeOneTimeKeyHash } from '@/lib/data/console-sdk-auth';

// The hash recipe is fixed by Voximplant and cannot be inferred from our own
// code being self-consistent: a wrong-but-consistent implementation produces a
// well-formed hash that the platform rejects with no explanation. These pin the
// recipe itself, independently computed from the formula in the official guide
//
//     MD5(`${login_key}|${MD5(`${myuser}:voximplant.com:${mypass}`)}`)
//
// against its own worked example (user "myuser", password "mypass").

describe('computeOneTimeKeyHash follows the documented recipe', () => {
  const USER = 'myuser';
  const PASS = 'mypass';
  const KEY = 'somekey';
  // Independently derived from the formula, not copied from our implementation.
  const INNER = '2b46f850be1e592abfbd5504b038ac33';
  const EXPECTED = '3c85e45030acefcf93958cd26a3ee098';

  it('matches the reference vector', () => {
    expect(computeOneTimeKeyHash(USER, PASS, KEY)).toBe(EXPECTED);
  });

  it('is 32 lowercase hex characters', () => {
    expect(computeOneTimeKeyHash(USER, PASS, KEY)).toMatch(/^[0-9a-f]{32}$/);
  });

  // The realm is the literal string "voximplant.com", NOT our account name. A
  // hash built with the account name is well-formed and always rejected.
  it('uses the literal voximplant.com realm', () => {
    // Rebuild the recipe here with the realm spelled out. If the implementation
    // ever swaps in the account name, this diverges — which is exactly the
    // failure that produces a well-formed hash the platform rejects.
    const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
    expect(md5(`${USER}:voximplant.com:${PASS}`)).toBe(INNER);
    expect(computeOneTimeKeyHash(USER, PASS, KEY)).toBe(
      md5(`${KEY}|${md5(`${USER}:voximplant.com:${PASS}`)}`),
    );
  });

  // The inner term takes the SHORT name. Passing the FQDN is the other silent
  // failure, and it must produce a DIFFERENT hash — proving the two are not
  // interchangeable.
  it('is sensitive to short name vs FQDN', () => {
    const short = computeOneTimeKeyHash('agent_x', PASS, KEY);
    const fqdn = computeOneTimeKeyHash(
      'agent_x@kalfa-rsvp.kalfarsvp.voximplant.com',
      PASS,
      KEY,
    );
    expect(short).not.toBe(fqdn);
  });

  it('changes with every input', () => {
    const base = computeOneTimeKeyHash(USER, PASS, KEY);
    expect(computeOneTimeKeyHash('other', PASS, KEY)).not.toBe(base);
    expect(computeOneTimeKeyHash(USER, 'other', KEY)).not.toBe(base);
    expect(computeOneTimeKeyHash(USER, PASS, 'other')).not.toBe(base);
  });
});
