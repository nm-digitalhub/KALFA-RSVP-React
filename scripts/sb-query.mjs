#!/usr/bin/env node
// Read-only Supabase query helper for the LINKED project.
//
// Runs a single read statement (SELECT / WITH / EXPLAIN / TABLE / SHOW) against
// the live database via the Supabase Management API, authenticating with the
// CLI access token in ~/.supabase/access-token. This is a local DEV DIAGNOSTIC
// tool — it is safe to auto-approve because it REFUSES anything that is not a
// read: mutations (insert/update/delete/drop/alter/truncate/create/grant/
// revoke/merge) and statements not starting with a read keyword are rejected
// before any network call.
//
// Usage: node scripts/sb-query.mjs "select count(*) from public.activity_log"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sql = process.argv.slice(2).join(' ').trim();
if (!sql) {
  console.error('usage: node scripts/sb-query.mjs "<select ...>"');
  process.exit(2);
}

// Read-only guard (defense in depth). Must start with a read keyword and must
// not contain any mutating keyword as a whole word.
const lowered = sql.toLowerCase();
const STARTS_READ = /^(\s*with\b|\s*select\b|\s*explain\b|\s*table\b|\s*show\b)/;
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\b/;
if (!STARTS_READ.test(lowered) || FORBIDDEN.test(lowered)) {
  console.error('refused: only read-only SELECT/WITH/EXPLAIN/TABLE/SHOW queries are allowed');
  process.exit(3);
}

const ref =
  (() => {
    try {
      return fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
    } catch {
      return process.env.SUPABASE_PROJECT_REF || '';
    }
  })();
if (!ref) {
  console.error('no linked project ref (supabase/.temp/project-ref missing)');
  process.exit(4);
}

const token = fs
  .readFileSync(path.join(os.homedir(), '.supabase', 'access-token'), 'utf8')
  .trim();

const res = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql, read_only: true }),
  },
);

const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  process.exit(1);
}
console.log(text);
