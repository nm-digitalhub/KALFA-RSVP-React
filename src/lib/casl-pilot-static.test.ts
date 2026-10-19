import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PLATFORM_PERMISSION_KEYS } from '@/lib/auth/platform-permission-keys.generated';

// The guard that keeps the pilot's duplication gone (openspec/changes/pilot-casl-package-permissions, task 5.1). Over
// the pilot's files a permission key is named only by the action map in src/lib/casl.ts: no file names a catalogue key
// as a string, none calls the DAL's key gates directly, and every server gate goes through the action gates. Textual,
// like admin-data-layer-coverage.test.ts and admin-nav-coverage.test.ts.

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : [path];
  });
}

const PACKAGES_DIR = 'src/app/(admin)/admin/packages';
const PILOT_FILES = ['src/lib/data/admin/packages.ts', ...filesUnder(PACKAGES_DIR)];

// The two shared modules take part only through their packages lines; the rest of each is outside the pilot.
const PILOT_LINES = [
  {
    file: 'src/lib/data/admin/dashboard.ts',
    lines: (source: string) => source.split('\n').filter((line) => /packages|Package/.test(line)),
    expected: "ability.can('read', 'Package')",
  },
  {
    file: 'src/components/admin-shell.tsx',
    lines: (source: string) => source.split('\n').filter((line) => line.includes("href: '/admin/packages'")),
    expected: "can: ['read', 'Package']",
  },
];

// The files whose exported functions are server entry points, and so must each open with an action gate.
const GATED_FILES = [
  'src/lib/data/admin/packages.ts',
  `${PACKAGES_DIR}/page.tsx`,
  `${PACKAGES_DIR}/new/page.tsx`,
  `${PACKAGES_DIR}/[id]/page.tsx`,
  `${PACKAGES_DIR}/actions.ts`,
  `${PACKAGES_DIR}/rewrite-action.ts`,
];

const KEY_LITERAL = new RegExp(
  `(['"\`])(${PLATFORM_PERMISSION_KEYS.map((key) => key.replace(/\./g, '\\.')).join('|')})\\1`,
);
const DIRECT_GATE = /\b(requirePlatformPermission|hasPlatformPermission)\(/;
const ACTION_GATE = /\b(requirePlatformAction|requireAnyPlatformAction)\(/;

// Each top-level exported function, from its signature to the line that holds only its closing brace (a multi-line
// parameter type also has lines that start with `}`, such as `}: {`).
function exportedFunctions(source: string): { name: string; body: string }[] {
  return [...source.matchAll(/^export (?:default )?(?:async )?function (\w+)/gm)].map((match) => {
    const start = match.index ?? 0;
    const close = /^\}\s*$/m.exec(source.slice(start));
    return { name: match[1], body: close ? source.slice(start, start + close.index) : source.slice(start) };
  });
}

describe('the pilot names permission keys only through the action map', () => {
  it('sweeps the pilot files (an empty sweep proves nothing)', () => {
    expect(PILOT_FILES).toEqual(expect.arrayContaining(GATED_FILES));
    expect(PILOT_FILES.length).toBeGreaterThanOrEqual(17);
  });

  for (const file of PILOT_FILES) {
    it(`${file} names no catalogue key and calls no DAL key gate`, () => {
      const source = read(file);
      expect(source, `${file} names a permission key; take it from PLATFORM_ACTIONS instead`).not.toMatch(
        KEY_LITERAL,
      );
      expect(source, `${file} calls the DAL's key gate directly; use requirePlatformAction`).not.toMatch(
        DIRECT_GATE,
      );
    });
  }

  for (const { file, lines, expected } of PILOT_LINES) {
    it(`the packages lines of ${file} decide through the action map`, () => {
      const packagesLines = lines(read(file));
      expect(packagesLines.length).toBeGreaterThan(0);
      for (const line of packagesLines) {
        expect(line).not.toMatch(KEY_LITERAL);
        expect(line).not.toMatch(DIRECT_GATE);
      }
      expect(packagesLines.join('\n')).toContain(expected);
    });
  }

  for (const file of GATED_FILES) {
    const functions = exportedFunctions(read(file));

    it(`${file} exports server entry points to check`, () => {
      expect(functions.length).toBeGreaterThan(0);
    });

    for (const { name, body } of functions) {
      it(`${file}: ${name} is gated through the action gates`, () => {
        expect(body, `${name} has no requirePlatformAction / requireAnyPlatformAction`).toMatch(ACTION_GATE);
      });
    }
  }
});
