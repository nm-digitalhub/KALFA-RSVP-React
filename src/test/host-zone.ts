import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSync } from 'esbuild';

// Runs PRODUCTION code under another HOST time zone, in a fresh Node process.
//
// Why a child process and not `process.env.TZ = ...` in the test: vitest.config.mts pins TZ=Asia/Jerusalem for the
// whole run, `TZ=UTC npm test` therefore proves nothing, and a zone assigned at run time reaches only the parts of
// the runtime that happen to re-read it. A new process with its own environment is the only setup that matches what
// a deployment on another machine does: the host zone is decided at process start and nothing of this test process
// (its pinned TZ included) leaks in.
//
// How: the entry source (TypeScript, may import `@/...`) is bundled once with esbuild — the same tool the worker
// build uses — into a temporary directory, then run once per host zone with the arguments as JSON on argv. The
// entry prints one JSON document on stdout. The bundle resolves `@/` to src/ and compiles JSX automatically, like
// the app does, and it runs the real modules: no stubs, no copies of the logic under test.

const SRC = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

export interface HostRunner {
  /** Runs the bundled entry in a fresh process whose host zone is `hostZone`; returns what it printed (parsed JSON). */
  run: <T>(hostZone: string, args: unknown) => T;
  /** Removes the temporary bundle. */
  dispose: () => void;
}

/**
 * Bundles `entrySource` (a TS module that reads `JSON.parse(process.argv[2])` and `console.log`s one JSON document).
 * Call `dispose()` when done (afterAll).
 */
export function createHostRunner(entrySource: string): HostRunner {
  const dir = mkdtempSync(join(tmpdir(), 'kalfa-host-zone-'));
  const outfile = join(dir, 'entry.mjs');
  buildSync({
    stdin: { contents: entrySource, resolveDir: SRC, loader: 'ts', sourcefile: 'host-zone-entry.ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    outfile,
    alias: { '@': SRC },
    logLevel: 'error',
  });

  return {
    run<T>(hostZone: string, args: unknown): T {
      const out = execFileSync(process.execPath, [outfile, JSON.stringify(args)], {
        // A minimal environment: nothing of this process leaks into the child.
        // (NODE_ENV only because Next's ProcessEnv typing requires the key; the child ignores it.)
        env: { PATH: process.env.PATH ?? '', TZ: hostZone, NODE_ENV: 'test' },
        encoding: 'utf8',
        timeout: 30_000,
      });
      return JSON.parse(out) as T;
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Host zones every host-independence test runs under. Asia/Jerusalem is production; the others are the ones that
 * broke (or could break) a resolver that leaned on the machine's zone: UTC and New York (UTC+2 or less during the
 * Israeli overlap), Athens / Cairo / Lord_Howe (their own DST gaps swallow ordinary Israeli wall times), Tokyo and
 * Auckland (far east).
 */
export const HOST_ZONES = [
  'Asia/Jerusalem',
  'UTC',
  'America/New_York',
  'Europe/Athens',
  'Africa/Cairo',
  'Australia/Lord_Howe',
  'Asia/Tokyo',
  'Pacific/Auckland',
] as const;
