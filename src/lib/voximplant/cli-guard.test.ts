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
    // The mutations that exist in the codebase must not appear in core. The
    // Secrets pair lives in mutations even though GetSecretValue is a "read" —
    // a secret read-back is as privileged as a write and must stay off the CLI.
    expect(core).not.toContain("'StartScenarios'");
    expect(core).not.toContain("'SetAccountInfo'");
    expect(core).not.toContain("'GetSecretValue'");
    expect(core).not.toContain("'AddSecret'");
  });

  it('KNOWN_COMMANDS is pinned to the read-only set (no start)', () => {
    // Adding a command here is meant to be deliberate: this list is pinned so a
    // new subcommand cannot slip in without someone confirming it only reads.
    // 'log' qualifies — GetCallHistory plus an authenticated GET of the returned
    // log_file_url, no mutation.
    // 'autocharge' qualifies — GetAutochargeConfig, and there is no setter to
    // confuse it with: the accounts category has exactly two write methods
    // (SetAccountInfo, SetChildAccountInfo) and neither touches autocharge.
    // Enabling automatic top-up is a support ticket, so this can only read back
    // what support configured.
    expect([...KNOWN_COMMANDS].sort()).toEqual(
      [
        'account',
        'autocharge',
        'audit',
        'call-lists',
        'history',
        'log',
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
