import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declaresAllowedTools, projectSkills, syncedAllow } from '../../../scripts/fleet-sync-skill-allowlist.mjs';

const ROOT = join(__dirname, '../../..');
const TIERS = ['tier0', 'tier0-design', 'tier1', 'tier2'];

function tierAllow(tier: string): string[] {
  const raw = readFileSync(join(ROOT, '.claude/fleet/settings', `${tier}.settings.json`), 'utf8');
  return (JSON.parse(raw) as { permissions: { allow: string[] } }).permissions.allow;
}

describe('fleet project-skill allowlist', () => {
  const { allowed, withTools } = projectSkills() as { allowed: string[]; withTools: string[] };

  it.each(TIERS)('%s allows exactly the synced project skills', (tier) => {
    const allow = tierAllow(tier);
    expect(syncedAllow(allow, allowed)).toEqual(allow);
  });

  it.each(TIERS)('%s never allows a skill that grants tools through allowed-tools', (tier) => {
    const allow = tierAllow(tier);
    for (const name of withTools) {
      expect(allow).not.toContain(`Skill(${name})`);
      expect(allow).not.toContain(`Skill(${name} *)`);
    }
  });

  it('reads allowed-tools only from the frontmatter', () => {
    expect(declaresAllowedTools('---\nname: x\nallowed-tools: Bash\n---\nbody')).toBe(true);
    expect(declaresAllowedTools('---\nname: x\nallowed-tools:\n  - "Write"\n---\n')).toBe(true);
    expect(declaresAllowedTools('---\nname: x\n---\nallowed-tools: Bash')).toBe(false);
  });

  it('keeps plugin-namespaced skill rules untouched', () => {
    expect(syncedAllow(['Read', 'Skill(design:ux-copy)', 'Skill(old)'], ['new'])).toEqual([
      'Read',
      'Skill(design:ux-copy)',
      'Skill(new)',
      'Skill(new *)',
    ]);
  });
});
