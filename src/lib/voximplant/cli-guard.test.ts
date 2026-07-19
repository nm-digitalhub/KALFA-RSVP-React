import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { KNOWN_COMMANDS } from './cli-support';

// Guard tests for the read-only/mutations split (plan stage 1, owner
// directives 1-4): the CLI must NEVER be able to reach a mutating wrapper.

const repoRoot = join(__dirname, '..', '..', '..');
const cliEntry = readFileSync(join(repoRoot, 'scripts', 'voximplant', 'cli.ts'), 'utf8');
const cliSupport = readFileSync(join(__dirname, 'cli-support.ts'), 'utf8');
const core = readFileSync(join(__dirname, 'core.ts'), 'utf8');

describe('CLI ↔ mutations guard', () => {
  it('the CLI entrypoint never imports or mentions the mutations module', () => {
    expect(cliEntry).not.toMatch(/from ['"].*mutations['"]/);
    expect(cliEntry).not.toContain('setAccountCallbackUrl');
    expect(cliEntry).not.toContain('startScenarios');
  });

  it('cli-support (pure logic) never references mutations either', () => {
    expect(cliSupport).not.toMatch(/from ['"].*mutations['"]/);
    expect(cliSupport).not.toContain('startScenarios');
  });

  it('core.ts exports no mutating Management-API method', () => {
    // The two mutations that exist in the codebase must not appear in core.
    expect(core).not.toContain("'StartScenarios'");
    expect(core).not.toContain("'SetAccountInfo'");
  });

  it('KNOWN_COMMANDS is pinned to the read-only set (no start)', () => {
    expect([...KNOWN_COMMANDS].sort()).toEqual(
      [
        'account',
        'audit',
        'call-lists',
        'history',
        'media-resources',
        'numbers',
        'recording',
        'rules',
        'transactions',
      ].sort(),
    );
    expect(KNOWN_COMMANDS).not.toContain('start');
  });

  it('package.json points the voximplant script at scripts/voximplant/cli.ts', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.voximplant).toBe('tsx scripts/voximplant/cli.ts');
  });
});
