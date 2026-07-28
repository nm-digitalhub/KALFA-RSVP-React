#!/usr/bin/env node
// Fails the build if a source file carries a LITERAL control character.
//
// Why this exists: a control byte written straight into a string literal works
// at run time, so tests pass and nothing complains — but the source file now
// contains a byte that tools handle inconsistently. A NUL in particular makes
// grep treat the file as binary, and some editors and diff viewers truncate
// there. The intent is always expressible as an escape (\u0000, \t, \n), which
// reads better in a security or sanitisation test anyway.
//
// Deliberately NOT an ESLint rule: ESLint parses, and a parser sees the decoded
// string — by then the distinction between a literal byte and an escape is
// gone. This has to be a byte-level check on the file itself.
//
// Node only, no dependency. Run via `npm run check:control-chars`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'worker', 'scripts'];
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx', '.json', '.css', '.sql', '.md'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.next-verify', '.next-stage', 'dist', '.git']);

// Tab (0x09), LF (0x0A) and CR (0x0D) are legitimate file content.
const isControl = (b) => b <= 0x08 || b === 0x0b || b === 0x0c || (b >= 0x0e && b <= 0x1f) || b === 0x7f;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) yield full;
  }
}

const findings = [];
for (const root of ROOTS) {
  let exists = true;
  try {
    statSync(root);
  } catch {
    exists = false;
  }
  if (!exists) continue;

  for (const file of walk(root)) {
    const data = readFileSync(file);
    for (let offset = 0; offset < data.length; offset++) {
      if (!isControl(data[offset])) continue;
      // Line number by counting newlines before the offset — cheap enough at
      // this scale and avoids decoding the file.
      let line = 1;
      for (let i = 0; i < offset; i++) if (data[i] === 0x0a) line++;
      findings.push({ file: relative(process.cwd(), file), line, byte: data[offset] });
    }
  }
}

if (findings.length === 0) {
  console.log('✓ אין תווי בקרה ליטרליים בקוד המקור');
  process.exit(0);
}

console.error(`✗ נמצאו ${findings.length} תווי בקרה ליטרליים בקוד המקור:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  byte=0x${f.byte.toString(16).padStart(2, '0')}`);
}
console.error('\nהחליפו אותם ברצף בריחה — למשל \\u0000 במקום בייט NUL ממשי.');
process.exit(1);
