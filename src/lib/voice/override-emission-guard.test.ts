import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// ⚠️ THE RULE MADE UN-BYPASSABLE.
//
// `override-policy.ts` states the invariant and `override-policy.test.ts` proves
// it holds. Neither stops the next ctx route from spelling
// `first_message_override: value` by hand and never calling the policy — which
// is exactly how a rule becomes a convention and then a comment.
//
// So this walks the Voximplant route tree and fails on any override key emitted
// outside the one sanctioned path. It is deliberately a TEXT scan: the thing it
// guards is a shape people copy from a neighbouring file, and a type cannot see
// a copy-paste.
//
// ⚠️ AND THE TEST HAS NOTHING TO SAY ABOUT WHETHER THE FLAG IS ON. That is the
// policy's job, at runtime, per agent. This only says: whatever decides, it is
// that module.

const ROUTES_DIR = join(process.cwd(), 'src/app/api/voximplant');

// The keys a scenario reads off ctx and forwards into
// `conversation_config_override`. Adding a new one here is the point: it fails
// the day someone introduces the fourth override and routes it by hand.
const OVERRIDE_KEYS = ['first_message_override', 'prompt_override', 'language_override'];

const POLICY_IMPORT = 'override-policy';

/**
 * Files allowed to name an override key without importing the policy.
 *
 * ONE ENTRY, WITH A REASON AND AN END DATE IN THE PLAN. The stage-0 probe is an
 * experiment ON the override mechanism: its whole purpose is to establish, by
 * listening to one call, whether an override reaches the agent at all. Gating it
 * behind a check that reads the same flag would make the experiment circular —
 * a failed flag lookup would omit the probe, and stage 0 would report "the
 * override did not work" for a reason that has nothing to do with overrides.
 *
 * It is a hardcoded constant, not a value any owner can set, and it is removed
 * when stage 0 concludes. Nothing else may join this list without the same kind
 * of argument.
 */
const EXEMPT = new Set(['sls/ctx/[token]/route.ts']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('no Voximplant route emits a conversation override outside the policy', () => {
  const files = walk(ROUTES_DIR);

  it('finds route files to check at all', () => {
    // A guard that silently checks nothing is worse than no guard.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(OVERRIDE_KEYS)('%s is only emitted through override-policy', (key) => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(ROUTES_DIR.length + 1);
      if (EXEMPT.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      if (!source.includes(key)) continue;
      if (!source.includes(POLICY_IMPORT)) offenders.push(rel);
    }
    expect(
      offenders,
      `these routes emit \`${key}\` without going through override-policy.ts. ` +
        `A-13: an override sent to an agent that does not permit it can THROW, ` +
        `after the phone has already rung. Route the value through ` +
        `allowedOverrides(agentId, {...}) instead.`,
    ).toEqual([]);
  });

  it('every exemption still exists, so the list cannot rot', () => {
    // An exemption for a file that was deleted or renamed is a hole nobody can
    // see: it stops excusing anything and starts hiding the fact that the rule
    // was never re-applied.
    for (const rel of EXEMPT) {
      const source = readFileSync(join(ROUTES_DIR, rel), 'utf8');
      expect(
        OVERRIDE_KEYS.some((k) => source.includes(k)),
        `${rel} is exempted but emits no override — remove it from EXEMPT.`,
      ).toBe(true);
    }
  });
});
