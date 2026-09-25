import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Pins scripts/patch-workflowbuilder-sdk.mjs: the INSTALLED SDK must show full
// node and field labels on variable chips. If an SDK upgrade moves the code, the
// postinstall patch finds nothing and this fails — instead of the owner seeing
// `{{ תפיסת מסגרת השת... · … }}` again.
const dist = join(process.cwd(), 'node_modules', '@workflowbuilder', 'sdk', 'dist');
const bundles = readdirSync(dist)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(dist, f), 'utf8'));

describe('workflow SDK variable chips', () => {
  it('no longer cuts node / field labels to 15 characters', () => {
    expect(bundles.some((s) => /\$\{\w+\([\w.$]+, 15\)\} · \$\{\w+\([\w.$]+, 15\)\}/.test(s))).toBe(false);
  });

  it('builds the chip from the full labels', () => {
    expect(bundles.some((s) => /display: `\$\{[\w.$]+\} · \$\{[\w.$]+\}`/.test(s))).toBe(true);
  });
});
