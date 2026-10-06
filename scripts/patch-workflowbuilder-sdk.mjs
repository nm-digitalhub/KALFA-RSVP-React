#!/usr/bin/env node
// Removes the 15-character cut on variable chips in the workflow editor.
//
// THE PROBLEM. When a text field references another node's output, the SDK
// shows a chip `{{ <node label> · <field label> }}` — and cuts BOTH labels to 15
// characters with "...", in its own code:
//
//   packages/sdk/src/features/variables/utils/get-node-suggestions-from-output-properties.ts:21
//     display: `${truncate(nodeLabel, 15)} · ${truncate(property.label, 15)}`,
//
// Hebrew node labels are long ("תפיסת מסגרת השתנתה ב-SUMIT"), so the owner saw
// `{{ תפיסת מסגרת השת... · מזהה הכרטיס }}` and could not tell which node a chip
// meant. There is no prop, decorator or CSS that reaches it: the cut happens in
// JS before the text reaches the page (measured in @workflowbuilder/sdk 2.3.0,
// and still present in the upstream repo at 052c396). So the shipped bundle is
// patched here, after every install.
//
// WHAT CHANGES: exactly that template — both labels are shown in full. The
// stored value is `{{nodes.<id>.<path>}}` and is not touched; the chip text is
// computed on render, so saved workflows are unaffected.
//
// SAFE BY CONSTRUCTION:
//   - idempotent: an already-patched bundle is left alone;
//   - it edits only a line that matches the exact minified shape
//     `${f(a, 15)} · ${f(b, 15)}` with the SAME function on both sides;
//   - on an SDK upgrade that moves the code, it says so loudly and changes
//     nothing — src/lib/workflow/sdk-chip-label-patch.test.ts then fails, so the
//     break is caught by the test suite rather than by the owner.
//   - it never fails the install.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'node_modules', '@workflowbuilder', 'sdk', 'dist');

// `${bu(n, 15)} · ${bu(l.label, 15)}` → `${n} · ${l.label}`
const CUT = /\$\{(\w+)\(([\w.$]+), 15\)\} · \$\{\1\(([\w.$]+), 15\)\}/;

function main() {
  if (!existsSync(dist)) return; // SDK not installed (e.g. a partial install)
  const files = readdirSync(dist).filter((f) => f.endsWith('.js'));
  let patched = 0;
  let found = 0;
  for (const file of files) {
    const path = join(dist, file);
    const source = readFileSync(path, 'utf8');
    if (!source.includes(' · ${')) continue;
    const match = source.match(CUT);
    if (!match) continue;
    found += 1;
    writeFileSync(path, source.replace(CUT, (_all, _fn, a, b) => `\${${a}} · \${${b}}`));
    patched += 1;
    console.log(`[patch-workflowbuilder-sdk] full labels on variable chips: ${file}`);
  }
  if (found === 0) {
    // Either already patched on a previous install, or the SDK changed shape.
    const alreadyPatched = files.some((f) => /display: `\$\{[\w.$]+\} · \$\{[\w.$]+\}`/.test(readFileSync(join(dist, f), 'utf8')));
    if (!alreadyPatched) {
      console.warn(
        '[patch-workflowbuilder-sdk] ⚠️ the variable-chip truncation was not found — the SDK changed. ' +
          'Chips may be cut to 15 characters again; re-derive the pattern (see this file).',
      );
    }
  }
  return patched;
}

try {
  main();
} catch (error) {
  console.warn('[patch-workflowbuilder-sdk] skipped:', error instanceof Error ? error.message : error);
}
