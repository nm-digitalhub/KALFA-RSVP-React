// Measures whether the OpenAPI spec we generate types from still describes the
// Graph version we actually call.
//
// WHY THIS EXISTS. The spec files carry version LABELS — `info.version: v23.0`
// in facebook/openapi, `Version: v18.0` in Meta's Postman environment, `example:
// v22.0` on a response header. None of those prove what the schemas contain.
// Reading a label and concluding "the types match v25.0" (or that they don't) is
// a guess. The only evidence is the live API: ask GRAPH_API_VERSION for a
// resource the spec describes, and compare the fields that come back to the
// fields the spec declares.
//
// Read-only. It performs GETs and never prints the access token.
//
//   npx tsx --env-file=.env.local scripts/verify-meta-schema.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

// Deliberately NOT '@/lib/supabase/admin': that module imports `server-only`,
// which throws the moment tsx loads it. Same constraint that keeps
// graph-version.ts import-free — a CLI script has to build its own client.
import { createClient } from '@supabase/supabase-js';

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

// The SAME specs `npm run meta:types` generates from, so this gate validates
// the contract the code is actually compiled against — not a different file.
const SPEC_DIR = 'openapi/meta';

// Versions to bisect a single field across. Spans the spec's own version, the
// one this codebase pins, and the newest Meta lists.
const MATRIX_VERSIONS = ['v23.0', 'v24.0', 'v25.0', 'v26.0'];

// The fields whose behaviour contradicts the written contract, one way or the
// other: unified_cert_status is documented for v25.0 but refused live, and
// username is refused by the v25.0 docs' own field list but accepted live.
// code_verification_status is the control — it is uncontroversial and must
// behave identically everywhere, proving the probe itself is sound.
const FIELD_MATRIX = [
  // Declared by BOTH the v23 monolith and Meta's own official v25.0 spec, and
  // absent from Meta's prose field reference for business phone numbers.
  'unified_cert_status',
  // The field that prose reference DOES document for certification status —
  // its enum is the one carrying EXPIRED ("the phone number's certificate has
  // expired") and NONE. If this works everywhere while unified_cert_status
  // fails everywhere, the OpenAPI spec simply names a field that does not
  // exist on this node.
  'name_status',
  // Accepted live, absent from the v25.0 spec: the mismatch in the other
  // direction.
  'username',
  // Control: uncontroversial, must behave identically everywhere.
  'code_verification_status',
];

// The resources the spec covers AND this codebase already reads in production,
// so a mismatch here is a mismatch that matters.
const PROBES = [
  {
    label: 'WABA phone numbers',
    spec: `phone-number-management.${GRAPH_API_VERSION}.yaml`,
    specPath: '/{Version}/{WABA-ID}/phone_numbers',
    fallbackFields: null,
    // Every field the spec declares is requested, so the response can only be
    // missing one because Meta no longer returns it.
    url: (wabaId: string, fields: string[]) =>
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/phone_numbers?fields=${fields.join(',')}&limit=1`,
  },
  {
    // Meta publishes no OpenAPI document for message templates at any version
    // tried, so this probe reads the field list this codebase actually sends
    // (template-health.ts) rather than a spec.
    label: 'WABA message templates',
    spec: null,
    specPath: null,
    fallbackFields: [
      'id',
      'name',
      'language',
      'category',
      'quality_score',
      'status',
    ],
    url: (wabaId: string, fields: string[]) =>
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?fields=${fields.join(',')}&limit=1`,
  },
];

type Schema = {
  $ref?: string;
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
};

// Most responses in this spec are `$ref`s into components/schemas, so a probe
// that does not follow them silently measures nothing — which is how the
// phone_numbers probe reported "המפרט לא מצהיר שדות" on the first run.
function deref(schema: Schema | undefined, spec: unknown): Schema | undefined {
  let current = schema;
  // Bounded: a malformed spec must not spin here.
  for (let hops = 0; current?.$ref && hops < 10; hops++) {
    const path = current.$ref.replace(/^#\//, '').split('/');
    let node: unknown = spec;
    for (const key of path) {
      node = (node as Record<string, unknown> | undefined)?.[key];
    }
    current = node as Schema | undefined;
  }
  return current;
}

// The list endpoints wrap their rows in `{ data: [ … ] }`; the fields we care
// about are the row's own properties.
function rowProperties(schema: Schema | undefined, spec: unknown): string[] {
  const envelope = deref(schema, spec);
  const rows = deref(envelope?.properties?.data, spec);
  const item = deref(rows?.items, spec) ?? rows;
  return Object.keys(deref(item, spec)?.properties ?? {});
}

async function main() {

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'חסרים NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — הריצו עם --env-file=.env.local',
    );
  }
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: settings, error } = await admin
    .from('app_settings')
    .select('whatsapp_waba_id, whatsapp_access_token')
    .eq('id', true)
    .maybeSingle();
  if (error) throw new Error(`app_settings: ${error.message}`);

  const wabaId = (settings as Record<string, string> | null)?.whatsapp_waba_id;
  const token = (settings as Record<string, string> | null)
    ?.whatsapp_access_token;
  if (!wabaId || !token) {
    throw new Error('WhatsApp WABA id / access token are not configured');
  }

  console.log(`מפרטים: ${SPEC_DIR}/*.${GRAPH_API_VERSION}.yaml`);
  console.log(`נקרא:   ${GRAPH_API_VERSION} (GRAPH_API_VERSION)\n`);

  let mismatches = 0;

  for (const probe of PROBES) {
    let declared: string[];
    if (probe.spec && probe.specPath) {
      const spec = parse(readFileSync(join(SPEC_DIR, probe.spec), 'utf8'));
      const operation = spec.paths?.[probe.specPath]?.get;
      declared = rowProperties(
        operation?.responses?.['200']?.content?.['application/json']?.schema,
        spec,
      );
    } else {
      declared = probe.fallbackFields ?? [];
    }
    if (declared.length === 0) {
      console.log(`⚠ ${probe.label}: המפרט לא מצהיר שדות — מדלג\n`);
      continue;
    }

    // Graph rejects the WHOLE request on the first unknown field (error #100,
    // "Tried accessing nonexisting field (x)"), so asking once only ever names
    // one. Drop the field it names and ask again: what falls out is the
    // complete list of fields the spec declares that this version removed.
    const rejected: string[] = [];
    let asked = [...declared];
    let body: {
      data?: Record<string, unknown>[];
      error?: { message?: string; code?: number };
    } = {};
    let ok = false;

    for (let attempt = 0; attempt < declared.length; attempt++) {
      const res = await fetch(probe.url(wabaId, asked), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      body = await res.json();
      if (res.ok) {
        ok = true;
        break;
      }
      const unknownField = /nonexisting field \(([^)]+)\)/.exec(
        body.error?.message ?? '',
      )?.[1];
      if (!unknownField || !asked.includes(unknownField)) {
        console.log(`❌ ${probe.label}: HTTP ${res.status}`);
        console.log(`   ${body.error?.message ?? '(ללא הודעה)'}\n`);
        mismatches += 1;
        break;
      }
      rejected.push(unknownField);
      asked = asked.filter((f) => f !== unknownField);
    }

    if (!ok) continue;

    const row = body.data?.[0];
    if (!row) {
      console.log(`⚠ ${probe.label}: אין שורות להשוואה\n`);
      continue;
    }

    const returned = Object.keys(row);
    const missing = asked.filter((f) => !returned.includes(f));
    const extra = returned.filter((f) => !declared.includes(f));

    console.log(`${probe.label}`);
    console.log(`   שדות במפרט:   ${declared.length}`);
    console.log(`   שדות בתשובה:  ${returned.length}`);
    if (rejected.length) {
      // The hard evidence: the spec describes a field this Graph version does
      // not have, and asking for it fails the entire call.
      console.log(
        `   ❌ במפרט ונדחים ע"י ${GRAPH_API_VERSION}: ${rejected.join(', ')}`,
      );
      mismatches += 1;
    }
    if (missing.length) {
      // Accepted but absent from this row — may simply be unset here.
      console.log(`   התקבלו אך ריקים בשורה זו: ${missing.join(', ')}`);
    }
    if (extra.length) {
      // Returned but not declared: the spec is behind the version we call.
      console.log(`   בתשובה ולא במפרט: ${extra.join(', ')}`);
      mismatches += 1;
    }
    if (!rejected.length && !extra.length) {
      console.log('   ✅ כל השדות שהמפרט מצהיר מתקבלים');
    }
    console.log('');
  }

  console.log(
    mismatches === 0
      ? `סיכום: המפרט תואם את מה ש-${GRAPH_API_VERSION} מחזיר בפועל בנתיבים שנבדקו.`
      : `סיכום: ${mismatches} אי-התאמות מול ${GRAPH_API_VERSION}. ראו למעלה.`,
  );

  // A rejected field is NOT evidence that the version removed it. Meta's own
  // v25.0 reference lists `unified_cert_status` as available, and the live
  // v25.0 API refuses it — while it ACCEPTS `username`, which that same
  // reference omits. So the field list in a spec or a doc page does not
  // predict what the API answers. Asking one field across several versions is
  // what separates "this version dropped it" from "this account/token never
  // had it".
  // The reference documents `filtering` and `sort` on this edge. Phase 2's
  // numbers page wants both server-side, so whether they actually work decides
  // whether it can page against Graph or must pull everything and sort in the
  // app. Documented is not the same as working — that is the lesson of every
  // other finding on this page.
  console.log('\n── יכולות שאילתה (filtering / sort) ──');
  const CAPABILITIES = [
    {
      label: 'filtering: account_mode = LIVE',
      query: `filtering=${encodeURIComponent('[{"field":"account_mode","operator":"EQUAL","value":"LIVE"}]')}`,
    },
    // The doc names three filterable fields. account_mode works; these check
    // the other two, and rule out that a string "false" (rather than a JSON
    // boolean) was MY error rather than the API's.
    {
      label: 'filtering: OBA, value "false" (מחרוזת)',
      query: `filtering=${encodeURIComponent('[{"field":"is_official_business_account","operator":"EQUAL","value":"false"}]')}`,
    },
    {
      label: 'filtering: OBA, value false (בוליאני)',
      query: `filtering=${encodeURIComponent('[{"field":"is_official_business_account","operator":"EQUAL","value":false}]')}`,
    },
    {
      label: 'filtering: messaging_limit_tier',
      query: `filtering=${encodeURIComponent('[{"field":"messaging_limit_tier","operator":"EQUAL","value":"TIER_1K"}]')}`,
    },
    // The documented form. Graph answers "Cannot sort by
    // last_onboarded_time.desc_ascending" — it appends `_ascending` to
    // whatever it is given, which is the clue that the real suffix is
    // `_descending` / `_ascending`, not the documented `.desc` / `.asc`.
    { label: 'sort: last_onboarded_time.desc (מתועד)', query: 'sort=last_onboarded_time.desc' },
    { label: 'sort: creation_time.asc (מתועד)', query: 'sort=creation_time.asc' },
    { label: 'sort: last_onboarded_time_descending', query: 'sort=last_onboarded_time_descending' },
    { label: 'sort: creation_time_ascending', query: 'sort=creation_time_ascending' },
    { label: 'sort: last_onboarded_time', query: 'sort=last_onboarded_time' },
    // The EXACT syntax the business-phone-numbers reference prints — an array
    // in single quotes. The OpenAPI spec and the Explorer show `field.desc`
    // instead, so the two Meta documents contradict each other; this settles
    // which one the backend actually parses.
    {
      label: "sort: ['last_onboarded_time_ascending'] (פרוזה)",
      query: `sort=${encodeURIComponent("['last_onboarded_time_ascending']")}`,
    },
    {
      label: 'sort: ["creation_time_descending"] (מערך JSON)',
      query: `sort=${encodeURIComponent('["creation_time_descending"]')}`,
    },
  ];
  for (const capability of CAPABILITIES) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/phone_numbers?fields=id&${capability.query}`,
      { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    const payload = (await res.json()) as {
      data?: unknown[];
      error?: { message?: string; code?: number };
    };
    console.log(
      `  ${capability.label.padEnd(40)} ${
        res.ok
          ? `✅ ${payload.data?.length ?? 0} שורות`
          : `❌ #${payload.error?.code ?? '?'} — ${payload.error?.message ?? ''}`
      }`,
    );
  }

  console.log('\n── מטריצת שדה × גרסה ──');
  for (const field of FIELD_MATRIX) {
    const results: string[] = [];
    for (const version of MATRIX_VERSIONS) {
      const res = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}/phone_numbers?fields=${field}&limit=1`,
        { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
      );
      const payload = (await res.json()) as {
        data?: Record<string, unknown>[];
        error?: { message?: string; code?: number };
      };
      if (res.ok) {
        const present = payload.data?.[0] && field in payload.data[0];
        results.push(`${version}: ${present ? 'יש ערך' : 'התקבל, ריק'}`);
      } else {
        const code = payload.error?.code;
        results.push(`${version}: נדחה (#${code ?? '?'})`);
      }
    }
    console.log(`  ${field.padEnd(24)} ${results.join('  |  ')}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
