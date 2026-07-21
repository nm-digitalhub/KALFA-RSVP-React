import { describe, expect, it, vi } from 'vitest';

// The module under test is server-only and reaches the admin client at module
// scope through its imports; the two pure helpers exercised here do not.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import {
  generateVoxPassword,
  voxUserNameFor,
} from '@/lib/data/console-agent-provisioning';
import { VOX_USER_NAME_PATTERN } from '@/lib/voximplant/mutations';

// These two pure functions decide whether provisioning can succeed AT ALL: a
// username or password Voximplant rejects fails the AddUser call, and a failed
// AddUser mid-provisioning is the case that leaves an agent half-created. Both
// rules are the API's own, quoted in the source they guard.

const UUID = '1bbe74dc-5721-48e9-9092-fd9e3c6e6b21';

describe('voxUserNameFor', () => {
  it('produces a name Voximplant accepts', () => {
    const name = voxUserNameFor(UUID);
    expect(name).toBe(`agent_${UUID}`);
    // [a-z0-9][a-z0-9_-]{2,49} — hyphens ARE legal, which is why the uuid can be
    // used verbatim rather than stripped.
    expect(VOX_USER_NAME_PATTERN.test(name)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(50);
  });

  it('lowercases, since the pattern has no uppercase class', () => {
    const name = voxUserNameFor(UUID.toUpperCase());
    expect(name).toBe(name.toLowerCase());
    expect(VOX_USER_NAME_PATTERN.test(name)).toBe(true);
  });
});

describe('generateVoxPassword', () => {
  // "at least 8 characters long and contain at least one uppercase and lowercase
  // letter, one number, and one special character" — verbatim from the method
  // tree. Built by construction, so this asserts the construction holds.
  const RULES: Array<[string, RegExp]> = [
    ['lowercase', /[a-z]/],
    ['uppercase', /[A-Z]/],
    ['digit', /[0-9]/],
    ['special', /[^A-Za-z0-9]/],
  ];

  it('satisfies every class on every draw', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateVoxPassword();
      expect(pw).toHaveLength(24);
      for (const [label, re] of RULES) {
        expect(re.test(pw), `draw ${i} has no ${label}: ${pw}`).toBe(true);
      }
    }
  });

  it('is not deterministic', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateVoxPassword()));
    expect(seen.size).toBe(50);
  });

  it('does not park the required classes in fixed positions', () => {
    // The shuffle matters: without it the first four characters would always be
    // lower/upper/digit/special, which is a pattern an attacker can exploit.
    const firsts = new Set(
      Array.from({ length: 100 }, () => generateVoxPassword()[0]),
    );
    expect(firsts.size).toBeGreaterThan(4);
  });
});
