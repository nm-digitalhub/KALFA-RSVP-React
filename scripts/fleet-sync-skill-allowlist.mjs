#!/usr/bin/env node
// Syncs the fleet tier settings' Skill(...) allow rules with the project skills
// Claude Code discovers under .claude/skills (real folders plus the symlinks into
// .agents/skills). Run after `npx skills add/update/remove`.
//
// A skill whose SKILL.md declares `allowed-tools` is NOT allowed here: Claude Code
// grants those tools for the turn that invokes the skill, and a fleet run is a
// single `claude -p` turn — so such a skill could open Write/Edit/Bash on a
// read-only tier. Those stay out until the owner approves them by name
// (APPROVED_WITH_TOOLS below).
//
// Usage: node scripts/fleet-sync-skill-allowlist.mjs [--check]
//   --check  exit 1 when any tier file is out of sync, write nothing.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKILLS_DIR = join(ROOT, '.claude/skills');
const TIERS = ['tier0', 'tier0-design', 'tier1', 'tier2'];

// Skills with `allowed-tools` that the owner has approved for the fleet
// (owner, 28.9.2026: all 28 that were installed at the time).
const APPROVED_WITH_TOOLS = new Set([
  'design-md',
  'elevenlabs-skills',
  'enhance-prompt',
  'github-project-management',
  'hebrew-voice-bot-builder',
  'israeli-chatbot-analytics',
  'israeli-consumer-contract-law',
  'israeli-ecommerce-compliance',
  'israeli-osek-patur-tax',
  'nextjs-code-review',
  'react-vite-dashboard',
  'remotion',
  'shadcn',
  'shadcn-ui',
  'site-md',
  'stitch-code-to-design',
  'stitch-extract-design-md',
  'stitch-extract-static-html',
  'stitch-generate-design',
  'stitch-loop',
  'stitch-manage-design-system',
  'stitch-react-components',
  'stitch-react-native',
  'stitch-upload-to-stitch',
  'supabase-schema-from-requirements',
  'taste-design',
  'zod-4',
  'zod-validation-utilities',
]);

export function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

export function declaresAllowedTools(text) {
  return /^allowed-tools\s*:/m.test(frontmatter(text));
}

export function projectSkills(dir = SKILLS_DIR) {
  const allowed = [];
  const withTools = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    if (declaresAllowedTools(readFileSync(file, 'utf8')) && !APPROVED_WITH_TOOLS.has(name)) {
      withTools.push(name);
    } else {
      allowed.push(name);
    }
  }
  return { allowed, withTools };
}

// Project-skill rules are the ones without a plugin namespace (`design:...`).
const isProjectSkillRule = (rule) => /^Skill\([^:()]+\)$/.test(rule);

export function syncedAllow(allow, names) {
  const kept = allow.filter((r) => !isProjectSkillRule(r));
  return [...kept, ...names.flatMap((n) => [`Skill(${n})`, `Skill(${n} *)`])];
}

function main() {
  const check = process.argv.includes('--check');
  const { allowed, withTools } = projectSkills();
  let drift = false;
  for (const tier of TIERS) {
    const file = join(ROOT, '.claude/fleet/settings', `${tier}.settings.json`);
    const raw = readFileSync(file, 'utf8');
    const settings = JSON.parse(raw);
    settings.permissions.allow = syncedAllow(settings.permissions.allow, allowed);
    const next = `${JSON.stringify(settings, null, 2)}\n`;
    if (next === raw) continue;
    drift = true;
    if (!check) writeFileSync(file, next);
    console.log(`${check ? 'out of sync' : 'updated'}: ${tier}.settings.json`);
  }
  console.log(`project skills allowed: ${allowed.length}; held back (allowed-tools): ${withTools.length}`);
  if (withTools.length) console.log(`held back: ${withTools.join(', ')}`);
  if (check && drift) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
