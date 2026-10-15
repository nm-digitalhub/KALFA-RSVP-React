import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseJlist, warnOnNotice } from '../../../scripts/lib/pm2-jlist.mjs';

// `pm2 jlist` prints the JSON as one line. When the CLI and the in-memory daemon are
// different versions, pm2 7.0.4 prints a banner to STDOUT first (lib/binaries/CLI.js:148)
// — measured 15.10.2026 with a v7 CLI against a v6 daemon.
const LIST = [
  { name: 'kalfa-worker', pm2_env: { status: 'online' } },
  { name: 'kalfa-owner-agent', pm2_env: { status: 'stopped' } },
];
const JSON_LINE = JSON.stringify(LIST);
const BANNER =
  '\n>>>> In-memory PM2 is out-of-date, do:\n>>>> $ pm2 update\nIn memory PM2 version: 6.0.5\nLocal PM2 version: 7.0.4\n\n';

describe('parseJlist', () => {
  it('parses plain JSON with no notice', () => {
    expect(parseJlist(JSON_LINE + '\n')).toEqual({ list: LIST, notice: '' });
  });

  it('survives the version-mismatch banner and returns it as the notice', () => {
    const parsed = parseJlist(BANNER + JSON_LINE + '\n');
    expect(parsed?.list).toEqual(LIST);
    expect(parsed?.notice).toContain('In-memory PM2 is out-of-date');
    expect(parsed?.notice).toContain('pm2 update');
  });

  it('strips ANSI colour codes from the notice (the banner is chalk.red.bold)', () => {
    const coloured = '\u001b[1m\u001b[31m>>>> In-memory PM2 is out-of-date, do:\u001b[39m\u001b[22m\n';
    expect(parseJlist(coloured + JSON_LINE)?.notice).toBe('>>>> In-memory PM2 is out-of-date, do:');
  });

  it('ignores a bracketed prefix line that is not JSON ("[PM2] ...")', () => {
    const parsed = parseJlist('[PM2] Spawning PM2 daemon\n' + JSON_LINE);
    expect(parsed?.list).toEqual(LIST);
    expect(parsed?.notice).toBe('[PM2] Spawning PM2 daemon');
  });

  it('accepts an empty process list', () => {
    expect(parseJlist('[]')).toEqual({ list: [], notice: '' });
  });

  it('returns null — a real failure — when there is no JSON array at all', () => {
    expect(parseJlist('')).toBeNull();
    expect(parseJlist(BANNER)).toBeNull();
    expect(parseJlist('{"not":"an array"}')).toBeNull();
    expect(parseJlist(BANNER + '[truncated')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseJlist(undefined as unknown as string)).toBeNull();
    expect(parseJlist(null as unknown as string)).toBeNull();
  });
});

describe('warnOnNotice', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is silent when pm2 printed nothing extra', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnNotice('worker-build-restart', '');
    expect(warn).not.toHaveBeenCalled();
  });

  it('says out loud that a mismatch happened, naming the script and the fix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnNotice('worker-build-restart', '>>>> In-memory PM2 is out-of-date, do:\n>>>> $ pm2 update');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('worker-build-restart');
    expect(line).toContain('pm2 update');
    expect(line).toContain('In-memory PM2 is out-of-date');
  });
});

// Both deploy steps must go through the shared parser — a bare JSON.parse(r.stdout) is
// the regression this file guards.
describe('deploy steps use the shared parser', () => {
  const ROOT = join(__dirname, '../../..');
  for (const script of ['worker-build-restart.mjs', 'owner-agent-build-restart.mjs']) {
    it(`${script} parses pm2 jlist via parseJlist, not JSON.parse(stdout)`, () => {
      const src = readFileSync(join(ROOT, 'scripts', script), 'utf8');
      expect(src).toContain("from './lib/pm2-jlist.mjs'");
      expect(src).toContain('parseJlist(r.stdout)');
      expect(src).not.toMatch(/JSON\.parse\(\s*r\.stdout\s*\)/);
    });
  }
});
