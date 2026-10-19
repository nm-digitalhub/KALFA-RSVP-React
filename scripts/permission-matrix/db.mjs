// The live database facts scripts/permission-matrix.mjs compares the code against. Read-only: SELECTs from the catalog
// and from the permission tables, through the Supabase CLI against the linked project.
//
// THE CLI IS CHECKED FIRST. `supabase db query --help` (CLI 2.121.0) documents the result format as --output-format
// (text | json | stream-json); -o / --output is listed as the format of status variables. Measured on 18.10.2026 with
// `select 1`: BOTH `-o json` and `--output-format json` return the same JSON, { boundary, rows, warning } — so
// scripts/find-legacy-campaign-payment-columns.mjs (which uses -o json) works too. This uses the documented flag, and
// reads the installed CLI's help first, stopping with a clear error when a flag it needs is missing. parseRows accepts
// a top-level array, { rows }, { data }, or one JSON value per line, and refuses anything else.

export function parseRows(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return [];
  const fail = (why) => new Error(`The Supabase CLI answered in a shape this script does not read (${why}). First 120 characters: ${text.slice(0, 120)}`);
  const rowsOf = (j) => (Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : Array.isArray(j?.data) ? j.data : null);
  let whole;
  try {
    whole = JSON.parse(text);
  } catch {
    whole = undefined;
  }
  if (whole !== undefined) {
    const rows = rowsOf(whole);
    if (!rows) throw fail('JSON without rows');
    return rows;
  }
  // One JSON value per line (stream-json): each a row, or a { rows } batch.
  try {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l)).flatMap((o) => rowsOf(o) ?? [o]);
  } catch {
    throw fail('not JSON');
  }
}

export function checkCli(help) {
  const missing = ['--linked', '--output-format'].filter((f) => !String(help).includes(f));
  if (missing.length) throw new Error(`This Supabase CLI's \`db query\` has no ${missing.join(' / ')}. Update the CLI, or run without --db.`);
}

const keysIn = (s) => [
  ...[...String(s).matchAll(/has_platform_permission\(\s*'([^']+)'/g)].map((m) => m[1]),
  ...(/is_platform_owner\(/.test(s) ? ['OWNER'] : []),
  ...(/is_staff\(/.test(s) ? ['STAFF'] : []),
];

export function readLiveDb({ execFileSync, cli = 'supabase' }) {
  checkCli(execFileSync(cli, ['db', 'query', '--help'], { encoding: 'utf8' }));
  const q = (sql) => parseRows(execFileSync(cli, ['db', 'query', '--linked', '--output-format', 'json', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const catalog = q(`select p.key, p.category, coalesce((select array_agg(r.name order by r.rank) from public.platform_role_permissions rp join public.platform_roles r on r.id = rp.role_id where rp.permission_id = p.id), '{}') as roles from public.platform_permission_definitions p order by p.category, p.key`)
    .map((c) => ({ ...c, roles: Array.isArray(c.roles) ? c.roles : String(c.roles ?? '').replace(/[{}]/g, '').split(',').filter(Boolean) }));
  const roles = q('select name, is_owner_role from public.platform_roles order by rank');
  const rls = q(`select c.relname as "table", c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')`);
  const policies = q(`select tablename as "table", policyname as name, permissive, cmd, roles::text as roles, coalesce(qual, '') as using_expr, coalesce(with_check, '') as check_expr from pg_policies where schemaname = 'public'`);
  const fns = q(`select p.proname as fn, p.prosecdef as definer, p.provolatile as volatility, coalesce(p.prosrc, '') as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
  const policyMap = new Map();
  for (const p of policies) {
    const list = policyMap.get(p.table) ?? [];
    list.push({ ...p, keys: keysIn(`${p.using_expr} ${p.check_expr}`) });
    policyMap.set(p.table, list);
  }
  return {
    catalog,
    roles,
    rls: new Map(rls.map((r) => [r.table, { rls: r.rls === true || r.rls === 't' }])),
    policies: policyMap,
    // An overloaded name keeps its first definition's volatility only when all agree; otherwise it is unknown.
    fns: fns.reduce((m, f) => {
      const prev = m.get(f.fn);
      m.set(f.fn, prev && prev.volatility !== f.volatility ? { ...prev, volatility: '?' } : { definer: f.definer, volatility: f.volatility, keys: keysIn(f.src) });
      return m;
    }, new Map()),
  };
}
