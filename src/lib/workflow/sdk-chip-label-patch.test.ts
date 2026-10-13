import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Pins patches/@workflowbuilder/sdk@3.0.0.patch (`patchedDependencies` in package.json): the INSTALLED
// SDK must show full node and field labels on variable chips. The SDK cuts both
// labels to 15 characters in `display`, with no prop to change it. npm applies
// the patch during every install — also under --ignore-scripts — and fails the
// install if an SDK upgrade moves the code; this test is the second net, so the
// owner never sees `{{ תפיסת מסגרת השת... · … }}` again.
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
