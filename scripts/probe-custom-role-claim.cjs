#!/usr/bin/env node
// Does PostgREST honour a JWT `role` claim naming a Postgres role that
// `authenticator` is NOT a member of?
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS PROBE CANNOT RUN TODAY, AND THAT IS A FINDING, NOT A TODO.
// ─────────────────────────────────────────────────────────────────────────────
//
// It needs a signed JWT. This project has migrated to the JWT signing-keys system,
// and neither trusted key can be extracted. Measured 2026-09-10 via the Management
// API (/config/auth/signing-keys):
//
//   8ade9d75-39dc-4a70-929a-b0a5e1fa10fb   HS256   previously_used   ← legacy secret
//   e76f3fc5-9b9e-4109-8758-3dbfc7d99e01   ES256   in_use            ← current key
//
// The ES256 private key was never extractable — that is the point of the system
// ("extracting of the private key or shared secret from Supabase is not possible",
// supabase.com/docs/guides/auth/signing-keys). The docs FAQ says the legacy secret
// is the one exception, but that describes a project BEFORE migration. After it,
// the dashboard's Legacy JWT Secret tab shows only a migration notice, and the
// secret is gone from every programmatic surface too. Searched, all empty:
//
//   pg_db_role_setting          no pgrst.jwt_secret on any role
//   app.settings.jwt_secret     not set
//   vault.secrets               empty; pgsodium not installed
//   /config/auth                243 fields, no jwt_secret — only jwt_exp
//   /config/auth/signing-keys   id/status/algorithm only; no key material
//
// So the ONLY way to mint a token for this project is to bring your own key:
//   supabase gen signing-key --algorithm ES256   → import as standby → Rotate key
// That is a change to production Auth infrastructure. Do not do it for a probe.
// Once such a key exists, this script runs unchanged — it shells out to
// `supabase gen bearer-jwt`, which signs with the imported key.
//
// AND NOT ANY KEY. Measured 2026-09-10: `supabase gen bearer-jwt` with no local key
// file signs with kid b81269f1-21d8-4f2e-b719-c2240a840d90 (ES256), identical across
// runs — a constant compiled into the CLI. The hosted project rejected all four
// tokens with PGRST301 "No suitable key was found to decode the JWT", including the
// anon control, so that run measured nothing.
//   NEVER import that CLI key to make this probe pass. Its private half ships with
//   every copy of the Supabase CLI, so importing it would let anyone holding the CLI
//   mint a service_role token for this project. Generate a fresh key, or do not run.
//
// WHY IT MAY NOT BE WORTH RUNNING AT ALL. The question is already answered by the
// official docs plus a measurement. The docs say the `role` claim "must be set to
// an existing Postgres role in your database", listing anon/authenticated/
// service_role as examples rather than as the permitted set. And the binding gate
// is on the Postgres side, measured 2026-09-10 in rolled-back transactions:
//   - `authenticator` is a member of anon, authenticated, service_role — nothing else.
//   - authenticator → SET ROLE <custom role> without a GRANT fails: 42501.
//   - After GRANT <role> TO authenticator it succeeds, with rolbypassrls = false.
//   - Under such a role RLS filters to zero rows; ungranted tables say permission denied.
// Whatever PostgREST does with the claim, without that GRANT the request cannot
// reach the role. The GRANT is the gate, and it is ours to withhold.
//
// READING THE RESULT, if it is ever run. `pgbouncer` is the discriminator, not the
// nonexistent role: it EXISTS in this database, has no BYPASSRLS, no table grants in
// public, and is not granted to `authenticator` (all measured). So:
//   - pgbouncer erroring in a way that names the role or the role switch → PostgREST
//     forwarded the claim and Postgres refused → claims ARE dynamic.
//   - pgbouncer behaving exactly like the nonexistent role AND like a request with no
//     Authorization header → the claim is being ignored.
// A nonexistent role alone cannot separate "refused" from "ignored".
//
// Read-only: five GETs to /rest/v1/packages?select=id&limit=1. No secret is written,
// logged or echoed; tokens are minted per-request and expire in two minutes.

const { execFileSync } = require('node:child_process');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const apikey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !apikey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / publishable key missing — run with --env-file=.env.local');
  process.exit(1);
}

// Mint via the CLI, which signs with the project's imported signing key. There is no
// local-secret path any more: the legacy HS256 secret is unreachable (see header).
function mint(role) {
  try {
    return execFileSync(
      'supabase',
      ['gen', 'bearer-jwt', '--role', role, '--valid-for', '2m'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch (e) {
    const why = (e && (e.stderr || e.message) ? String(e.stderr || e.message) : '').trim();
    console.error(`\ncannot mint a token for role="${role}".`);
    console.error('This project has no importable signing key — see the header of this file.');
    if (why) console.error(`supabase CLI said: ${why.slice(0, 300)}`);
    process.exit(2);
  }
}

const ENDPOINT = `${url}/rest/v1/packages?select=id&limit=1`;

async function request(headers) {
  try {
    const res = await fetch(ENDPOINT, { headers });
    return { status: res.status, body: (await res.text()).slice(0, 220) };
  } catch (e) {
    return { status: 'network', body: e instanceof Error ? e.message : String(e) };
  }
}

async function probe(role, note) {
  const token = mint(role);
  const { status, body } = await request({ apikey, Authorization: `Bearer ${token}` });
  console.log(`role="${role}"  →  HTTP ${status}   (${note})`);
  console.log(`   ${body}\n`);
  return { status, body };
}

(async () => {
  // Baseline: apikey only, no Authorization. Whatever role the gateway defaults to.
  const base = await request({ apikey });
  console.log(`no Authorization header  →  HTTP ${base.status}   (baseline to compare against)`);
  console.log(`   ${base.body}\n`);

  // The anon control runs FIRST and gates everything. If the project does not trust
  // the signing key, every role returns the same 401 and four identical lines look
  // like a finding when nothing was tested at all.
  const control = await probe('anon', 'control — the claim is read at all');
  if (control.status === 401 || /PGRST301|No suitable key/i.test(control.body)) {
    console.error('INCONCLUSIVE — the anon control failed, so no role was tested.');
    console.error('The project does not trust the key these tokens are signed with;');
    console.error('the signature is rejected before the role claim is ever read.');
    console.error('See the header of this file. Do not read the rows below as a result.');
    process.exit(3);
  }

  await probe('service_role', 'control — a DIFFERENT role must behave differently');
  await probe('pgbouncer', 'THE TEST — exists, not granted to authenticator');
  await probe('definitely_not_a_role_xyz', 'does not exist — separates "refused" from "ignored"');
})();
