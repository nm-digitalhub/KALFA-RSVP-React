import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// `npm run typecheck` must not depend on any build directory other than the one it generates itself.
// Next appends "<distDir>/types/**/*.ts" to tsconfig.json for every distDir a build has used, so a stale
// route stub left in .next-verify/.next-stage/… failed `tsc --noEmit` with the source clean (15.10.2026).
// The fix is tsconfig.typecheck.json + an isolated `next typegen` (docs: cli/next.md "next typegen").

const ROOT = join(__dirname, '../../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

// tsconfig files allow comments and trailing commas.
function parseJsonc(src: string): Record<string, unknown> {
  const noComments = src.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noComments) as Record<string, unknown>;
}

describe('typecheck setup', () => {
  const script = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts.typecheck;

  it('generates route types into its own distDir, then checks with the dedicated tsconfig', () => {
    expect(script).toBe(
      'NEXT_DIST_DIR=.next-typecheck next typegen && tsc --noEmit -p tsconfig.typecheck.json',
    );
  });

  const cfg = parseJsonc(read('tsconfig.typecheck.json')) as { extends?: string; include?: string[] };

  it('inherits tsconfig.json so compiler options never drift', () => {
    expect(cfg.extends).toBe('./tsconfig.json');
  });

  it('includes the source globs and exactly one generated-types directory', () => {
    const include = cfg.include ?? [];
    const generated = include.filter((p) => /^\.next[^/]*\//.test(p));
    expect(generated).toEqual(['.next-typecheck/types/**/*.ts']);
    for (const glob of ['next-env.d.ts', '**/*.ts', '**/*.tsx', '**/*.mts']) {
      expect(include).toContain(glob);
    }
  });

  it('keeps the generated directory out of git and out of ESLint', () => {
    expect(read('.gitignore')).toMatch(/^\/\.next-\*\/$/m);
    expect(read('eslint.config.mjs')).toMatch(/\.next-\*/);
  });
});
