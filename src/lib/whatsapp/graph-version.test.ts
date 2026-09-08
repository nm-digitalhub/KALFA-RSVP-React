import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

// Guard for gap G5. The version had drifted across SIX call sites (v21 twice,
// v23 four times, plus the SDK's own default) before it was unified, and
// nothing in lint, tsc or the test suite could see it happening: every one of
// those literals was perfectly valid code. This test is the thing that sees it.
//
// It scans the real source tree rather than asserting on a list of files, so a
// NEW module that hard-codes a version fails here on the day it is written
// instead of the day its behaviour diverges from the send path in production.

const SRC = join(process.cwd(), 'src');
const GRAPH_VERSION_LITERAL = /graph\.facebook\.com\/v\d+\.\d+/g;

// Facebook Page and Instagram publishing is a DIFFERENT product surface with
// its own separately verified versions (v26.0 page feed/photos, v25.0 IG
// login). It is exempt on purpose — see the note in graph-version.ts.
const ALLOWED = new Set(['lib/fleet/publish-social.ts']);

// Generated API types are a vendored artifact, not our call sites.
const SKIP_DIRS = new Set(['generated', 'node_modules']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('GRAPH_API_VERSION is the only Graph version in the source', () => {
  it('no module hard-codes a graph.facebook.com version', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const hits = readFileSync(file, 'utf8').match(GRAPH_VERSION_LITERAL);
      if (hits) offenders.push(`${rel}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(
      offenders,
      `hard-coded Graph versions found — import GRAPH_API_VERSION from @/lib/whatsapp/graph-version instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('is a plausible Graph version string', () => {
    expect(GRAPH_API_VERSION).toMatch(/^v\d{2}\.\d$/);
  });

  it('carries no imports, so tsx CLIs and the worker bundle can load it', () => {
    // The relocation wizard runs under tsx and cannot load `server-only`; the
    // pg-boss worker bundles it through esbuild. A stray import here would
    // break one of them at runtime, not at build time.
    // Matches real statements only, not the words inside the file's own doc
    // comment — the first version of this assertion failed on its own prose.
    const source = readFileSync(join(SRC, 'lib/whatsapp/graph-version.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/['"]server-only['"]/);
  });
});
