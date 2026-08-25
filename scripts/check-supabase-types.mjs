#!/usr/bin/env node
// Fails when src/lib/supabase/types.generated.ts no longer matches the LIVE linked
// database (run: npm run types:check; wired into `npm run deploy`).
//
// types.generated.ts is generated output (`npm run gen:types` = `supabase gen types
// --linked`, per https://supabase.com/docs/guides/api/rest/generating-types).
// Nothing else guards it: a migration pushed to the linked project without a
// regenerate leaves the committed types describing a schema that no longer
// exists, and `tsc --noEmit` stays green because it only knows the stale file.
// The drift then surfaces at runtime as a PostgREST 42703 / PGRST204 on a
// column the code "knows" is there. This check compares a fresh generation
// byte-for-byte against the committed file so the deploy stops instead.
//
// Exit codes: 0 in sync · 1 drift (regenerate + commit) · 2 the CLI itself
// failed (no link / no token / network) — distinct so a Supabase outage is
// not misreported as schema drift.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TARGET = 'src/lib/supabase/types.generated.ts';

let generated;
try {
  generated = execFileSync('npx', ['supabase', 'gen', 'types', '--linked'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  const stderr = err && typeof err.stderr === 'string' ? err.stderr.trim() : '';
  console.error(`types:check — \`supabase gen types --linked\` failed${stderr ? `:\n${stderr}` : ''}`);
  process.exit(2);
}

if (!generated.includes('export type Database')) {
  console.error('types:check — generator output has no `export type Database`; refusing to compare.');
  process.exit(2);
}

const committed = readFileSync(TARGET, 'utf8');
if (committed === generated) {
  console.log(`types:check — ${TARGET} matches the linked database.`);
  process.exit(0);
}

console.error(
  `types:check — ${TARGET} is out of date vs the linked database.\n` +
    'Regenerate and commit: npm run gen:types',
);
process.exit(1);
