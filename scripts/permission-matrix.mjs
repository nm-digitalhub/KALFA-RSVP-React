#!/usr/bin/env node
// The admin permission matrix: for every admin entry point (page, layout, route handler, server action), what is
// PROVEN to run before each data operation it reaches — which permission, through which client, and what RLS says —
// and every gap between those layers, each with a state: MISMATCH, UNRESOLVED, REVIEW or PROVEN.
//
//   node scripts/permission-matrix.mjs                         # code only
//   node scripts/permission-matrix.mjs --db                    # + the live catalog, RLS policies, RPC volatility (SELECTs)
//   node scripts/permission-matrix.mjs --policy p.json         # + the expected key per function / route
//   node scripts/permission-matrix.mjs --db --out report.md    # write the report to a file
//   node scripts/permission-matrix.mjs --json --out report.json
//   node scripts/permission-matrix.mjs --max-depth 16          # follow deeper call chains (default 12)
//
// The analysis is in scripts/permission-matrix/analyze.mjs (what is proven and how: read its header), the live
// database reader in db.mjs, the report in report.mjs; the tests run the analysis on a program built in memory:
//   npm run test:permission-matrix
//
// The policy file is the only place the RIGHT key is written down; the scan cannot infer it. Its shape:
//   { "functions": { "src/lib/data/admin/users.ts#listAllUsers": "view_customer_data" },
//     "routes":    { "/admin/users": "view_customer_data" } }
// Without it, PROVEN means "gated before every sensitive operation", not "gated by the right key".
//
// Read-only: nothing is written except --out; --db runs SELECTs only, through the Supabase CLI against the linked
// project, after checking that the installed CLI has the flags it uses.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { analyze } from './permission-matrix/analyze.mjs';
import { readLiveDb } from './permission-matrix/db.mjs';
import { renderJson, renderMarkdown } from './permission-matrix/report.mjs';

const requireCjs = createRequire(import.meta.url);
const ts = requireCjs('typescript');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const ROOT = process.cwd();
const WITH_DB = flag('--db');
const AS_JSON = flag('--json');
const OUT = opt('--out');
const POLICY = opt('--policy');
const MAX_DEPTH = Number(opt('--max-depth') ?? 12);
if (!Number.isInteger(MAX_DEPTH) || MAX_DEPTH < 1) {
  console.error('--max-depth must be a positive whole number');
  process.exit(2);
}

const cfg = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
if (cfg.error) {
  console.error('tsconfig.json could not be read; run this from the project root');
  process.exit(2);
}
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });

const db = WITH_DB ? readLiveDb({ execFileSync }) : null;
const policy = POLICY ? JSON.parse(readFileSync(POLICY, 'utf8')) : null;

const result = analyze({ ts, program, root: ROOT, db, policy, maxDepth: MAX_DEPTH });
const meta = { generatedAt: new Date().toISOString(), withDb: WITH_DB, policyFile: POLICY ?? null, catalog: db?.catalog ?? null };
const text = AS_JSON ? renderJson(result, meta) : renderMarkdown(result, meta);
if (OUT) writeFileSync(OUT, text);
else process.stdout.write(text);
