#!/usr/bin/env node
// Downloads Meta's OFFICIAL OpenAPI specs for the Graph version this codebase
// calls, and generates TypeScript types from them.
//
// WHY THIS SHAPE. The first version of this script generated from
// `meta-openapi/business-messaging-api_v23.0.yaml` — a monolith cloned from
// github.com/facebook/openapi and stamped v23.0 — while GRAPH_API_VERSION is
// v25.0. That is a contract mismatch by construction, and it is not fixable by
// finding a "newer monolith": Meta does not publish one.
//
// What Meta DOES publish is one OpenAPI document per API PER VERSION, served
// straight off the reference docs:
//
//   …/reference/<resource>/<api>/<version>.openapi.yaml
//
// MEASURED 2026-09-09: v25.0 returns 200 for the six APIs below; v26.0 returns
// 500 for all of them, which is also the evidence that v25.0 is the newest
// published spec — the same conclusion D3 reached from live sends. Not every
// reference page publishes one: message-template-management, messages, media
// and debug_token all answer 500 at every version tried.
//
// So the version drift disappears: the types are generated from the exact
// version the code calls, and bumping GRAPH_API_VERSION re-fetches rather than
// silently leaving the types behind.
//
// WHY npx AND NOT A DEPENDENCY. openapi-typescript declares
// `peerDependencies: { typescript: '^5.x' }` and this project is on TypeScript
// 6, so `npm install` fails with ERESOLVE; `--legacy-peer-deps` would leave a
// tool in node_modules that is peer-broken against the project's own compiler.
// `@hey-api/openapi-ts` breaks the same way (`import ts from 'typescript'` is
// undefined under TS 6, so `ts.SyntaxKind.AnyKeyword` throws). Running the
// generator through npx with TypeScript 5 pinned inside THAT isolated tree
// gives the generator the compiler it needs and leaves the project's alone.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Pinned so output is reproducible; bumping either is a reviewable change.
const GENERATOR = 'openapi-typescript@7.13.0';
const GENERATOR_TYPESCRIPT = 'typescript@5.9.3';

const REFERENCE =
  'https://developers.facebook.com/documentation/business-messaging/whatsapp/reference';

// The APIs Phase 2 touches. Each is fetched at GRAPH_API_VERSION, cached under
// openapi/meta/ (committed — a clean clone must be able to regenerate without
// network), and turned into its own types module.
const APIS = [
  {
    slug: 'whatsapp-business-account/phone-number-management-api',
    name: 'phone-number-management',
  },
  {
    slug: 'whatsapp-business-account/subscribed-apps-api',
    name: 'subscribed-apps',
  },
  {
    slug: 'whatsapp-business-account/whatsapp-business-account-api',
    name: 'whatsapp-business-account',
  },
  {
    slug: 'whatsapp-account-number/whatsapp-account-number-api',
    name: 'account-number',
  },
  // Under `business/`, not `whatsapp-business-account/` — the two-step add
  // flow starts on the business node.
  { slug: 'business/add-phone-numbers-api', name: 'add-phone-numbers' },
  {
    slug: 'business/client-whatsapp-business-accounts-api',
    name: 'client-wabas',
  },
];

const SPEC_DIR = 'openapi/meta';
const OUT_DIR = 'src/lib/whatsapp/generated';

// graph-version.ts is deliberately import-free so tsx, the worker bundle and
// this script can all read it. Parse rather than import: this file is plain
// Node ESM and the constant is a single literal.
function graphApiVersion() {
  const source = readFileSync('src/lib/whatsapp/graph-version.ts', 'utf8');
  const match = /GRAPH_API_VERSION\s*=\s*'(v\d+\.\d+)'/.exec(source);
  if (!match) throw new Error('לא נמצא GRAPH_API_VERSION ב-graph-version.ts');
  return match[1];
}

// Returns {text: null} when nothing needed changing, so the common case
// generates straight from the untouched file.
function patchSpec(text, name) {
  const notes = [];
  let out = text;

  if (name === 'phone-number-management') {
    // 1. `sort`. The spec types it as a closed enum of `<field>.asc` /
    //    `<field>.desc`, and Graph rejects all four:
    //      (#100) Cannot sort by last_onboarded_time.desc_ascending
    //    — it appends `_ascending` to whatever it gets. The form that works is
    //    `<field>_ascending` / `<field>_descending`, which is ALSO what Meta's
    //    own business-phone-numbers reference prints
    //    (`sort=['last_onboarded_time_ascending']`). So the two Meta documents
    //    disagree and the machine-readable one is the wrong one.
    const before = out;
    out = out
      .replace(/creation_time\.asc\b/g, 'creation_time_ascending')
      .replace(/creation_time\.desc\b/g, 'creation_time_descending')
      .replace(/last_onboarded_time\.asc\b/g, 'last_onboarded_time_ascending')
      .replace(/last_onboarded_time\.desc\b/g, 'last_onboarded_time_descending');
    if (out !== before) notes.push('sort → _ascending/_descending');

    // 2. `unified_cert_status`. Declared on the phone-number schema and listed
    //    under `fields`, but rejected as a nonexisting field on every version
    //    (v23–v26), both WABAs and both token types. Dropping the property
    //    keeps it out of the generated type so nobody builds a `fields=` list
    //    from the types and kills the whole request. `name_status` is the
    //    field that actually carries certification state.
    const dropped = out.replace(
      /^ {8}unified_cert_status:\n(?: {10}.*\n)+/m,
      '',
    );
    if (dropped !== out) {
      out = dropped;
      notes.push('unified_cert_status הוסר');
    }

    // It also appears in the `fields` parameter's prose description, which
    // becomes a JSDoc comment on the generated type. Removing the property is
    // not enough: a developer reading that comment would copy the name into a
    // `fields=` string and kill the request. Take it out of the list and say
    // why, right where they would have read it.
    const listed = out.replace(
      'code_verification_status, unified_cert_status, account_mode',
      'code_verification_status, account_mode',
    );
    if (listed !== out) {
      out = listed.replace(
        'messaging_limit_tier, is_official_business_account',
        'messaging_limit_tier, is_official_business_account.\n            NOTE: Meta also lists unified_cert_status here, but Graph rejects it\n            with (#100) on every version tried (v23-v26), on both WABAs and\n            both token types. Including it fails the ENTIRE request. Use\n            name_status for certification state. Verified by npm run meta:verify.',
      );
      notes.push('הערת fields עודכנה');
    }
  }

  return notes.length ? { text: out, notes } : { text: null, notes };
}

const version = graphApiVersion();
const offline = process.argv.includes('--offline');

mkdirSync(SPEC_DIR, { recursive: true });
console.log(`גרסה: ${version} (מתוך GRAPH_API_VERSION)\n`);

let failed = 0;

for (const api of APIS) {
  const specPath = join(SPEC_DIR, `${api.name}.${version}.yaml`);
  const outPath = join(OUT_DIR, `${api.name}.d.ts`);

  if (!offline) {
    const url = `${REFERENCE}/${api.slug}/${version}.openapi.yaml`;
    const res = await fetch(url);
    if (!res.ok) {
      // A 500 here is how Meta answers "no spec published for that version",
      // so name the version rather than reporting a bare HTTP error.
      console.error(
        `❌ ${api.name}: אין מפרט ל-${version} (HTTP ${res.status})\n   ${url}`,
      );
      failed += 1;
      continue;
    }
    const body = await res.text();
    // Sanity-check the version the document declares against the one we asked
    // for. Meta serves these off the docs site; a redirect to another version
    // would otherwise be invisible.
    const declared = /^\s*version:\s*(v\d+\.\d+)\s*$/m.exec(body)?.[1];
    if (declared && declared !== version) {
      console.error(
        `❌ ${api.name}: ביקשנו ${version} וקיבלנו מפרט שמצהיר ${declared}`,
      );
      failed += 1;
      continue;
    }
    // Keep the file EXACTLY as Meta served it, so `git diff` on a later run
    // shows what Meta changed and nothing this script did.
    writeFileSync(specPath, body);
  }

  // Correct the two places where the published spec contradicts the live API,
  // MEASURED via `npm run meta:verify` (see the plan's §0.0 for the full
  // matrix). Applied to a COPY, in memory — the cached spec on disk stays a
  // faithful record of what Meta published.
  //
  // Without this the generated types are actively harmful: they hand a
  // developer a `sort` enum whose every value Graph rejects, and a field name
  // that fails the entire request when included in `fields=`.
  const patched = patchSpec(readFileSync(specPath, 'utf8'), api.name);
  const genPath = patched.text === null ? specPath : `${specPath}.patched`;
  if (patched.text !== null) {
    writeFileSync(genPath, patched.text);
    console.log(`   ↳ תוקן: ${patched.notes.join(' · ')}`);
  }

  const result = spawnSync(
    'npx',
    [
      '--yes',
      `--package=${GENERATOR_TYPESCRIPT}`,
      `--package=${GENERATOR}`,
      'openapi-typescript',
      genPath,
      '-o',
      outPath,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (genPath !== specPath) rmSync(genPath, { force: true });
  if (result.status !== 0) {
    console.error(`❌ ${api.name}: ייצור הטיפוסים נכשל`);
    failed += 1;
    continue;
  }
  console.log(`✅ ${api.name.padEnd(28)} ${specPath} → ${outPath}`);
}

if (failed > 0) {
  console.error(`\n${failed} מתוך ${APIS.length} נכשלו.`);
  process.exit(1);
}

// The generated files are committed, so the diff IS the review surface: a spec
// change that alters a request or response shape must be seen, not absorbed.
// `--stat` alone is blind to untracked files, which would report "no change"
// for a file that did not exist a second earlier. `--intent-to-add` on the
// untracked ones makes them visible to the diff without staging content.
spawnSync('git', ['add', '--intent-to-add', '--', OUT_DIR, SPEC_DIR], {
  stdio: 'ignore',
});
const diff = spawnSync('git', ['diff', '--stat', '--', OUT_DIR, SPEC_DIR], {
  encoding: 'utf8',
});
const summary = (diff.stdout ?? '').trim();
console.log(
  summary
    ? `\nהשתנה — יש לבדוק את ה-diff לפני commit:\n${summary}`
    : '\nזהה למה שמקומט. אין שינוי.',
);
console.log('\nהריצו `npm run meta:verify` כדי לאמת מול ה-API החי.');
