// The Markdown and JSON forms of analyze()'s result. Pure: strings in, strings out.

import { STATES, isCapability } from './analyze.mjs';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const keys = (list) => (list && list.length ? list.join(' + ') : '—');

export function renderJson(result, meta) {
  return JSON.stringify({
    meta,
    coverage: result.coverage,
    findings: result.findings,
    nav: result.nav,
    entries: result.entries.map((e) => ({
      id: e.id, route: e.route, kind: e.kind, file: e.file, name: e.name,
      proven: [...e.exit], capabilities: e.caps, direct: e.direct, inheritedFromLayouts: e.inherited,
      gates: e.gates, operations: e.ops, unresolved: e.unresolved, truncated: e.truncated,
    })),
  }, null, 2);
}

export function renderMarkdown(result, meta) {
  const L = [];
  const add = (s = '') => L.push(s);
  const c = result.coverage;
  add('# Admin permission matrix');
  add();
  add(`Generated ${meta.generatedAt} by scripts/permission-matrix.mjs${meta.withDb ? ', with the live database' : ', code only (no --db: no catalog, RLS or RPC volatility)'}${meta.policyFile ? `, against the policy ${meta.policyFile}` : ', with no policy file (PROVEN means "gated", not "gated by the right key")'}.`);
  add();
  add('## Summary');
  add();
  add('| State | Findings |');
  add('|---|---|');
  for (const s of STATES) add(`| ${s} | ${result.findings.filter((f) => f.state === s).length} |`);
  add();
  add(`Coverage: ${c.entries} entry points; calls followed ${c.callsResolved}, library calls ${c.callsLibrary}, calls the scan could not resolve ${c.callsUnresolved} (${c.unresolvedCallSites} on admin paths); paths cut off at depth ${result.maxDepth}: ${c.truncatedPaths}; operations ${c.operations}, of them with an unknown client ${c.operationsUnknownClient} and with an unknown effect ${c.operationsUnknownEffect}.`);
  add();
  add('A gate counts only when it runs, awaited, on every path BEFORE the operation. A layout\'s gate is listed but never counted for the page under it (Next.js, "Layouts and auth checks").');
  add();
  add(`Append-only tables (inserts there are not counted as writes behind a view key): ${result.appendOnly.join(', ') || 'none'}.${result.readOnlyCandidatesChecked ? '' : ' Read-only candidates (V2) are not checked without --db: which view keys exist is in the catalog.'}`);
  add();
  for (const s of STATES) {
    const list = result.findings.filter((f) => f.state === s);
    if (!list.length) continue;
    add(`## ${s}`);
    add();
    for (const f of list) {
      add(`### ${f.rule}${f.severity && f.severity !== 'normal' ? ` · ${f.severity}` : ''} — ${esc(f.entry)}`);
      add();
      add(`- ${esc(f.text)}`);
      if (f.location) add(`- Where: \`${f.location}\`${f.fn ? ` in \`${f.fn}\`` : ''}`);
      if (f.found?.length || f.expected) add(`- Found: ${keys(f.found)}${f.expected ? ` · expected: ${f.expected}` : ''}`);
      if (f.chain?.length) {
        add('- Call chain:');
        for (const step of f.chain) add(`  - \`${step}\``);
      }
      add();
    }
  }
  add('## Matrix');
  add();
  add('Per entry: the keys proven on its own path (`STAFF` = any staff, `USER` = signed in, `OWNER` = owner role), the layouts\' keys (not counted), and each operation with what is proven before it. *Italic* = may not run.');
  add();
  add('| Route | Entry | Proven on its path | Layouts (not counted) | Operations (proven before it) |');
  add('|---|---|---|---|---|');
  const sorted = [...result.entries].sort((a, b) => a.route.localeCompare(b.route) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  for (const e of sorted) {
    const ops = [...new Map(e.ops.map((o) => [o.location, o])).values()].map((o) => {
      const label = `${o.kind}:${o.target}.${o.op} · ${o.origin} · [${keys(o.proven.filter(isCapability))}]`;
      return o.may ? `*${label}*` : label;
    });
    add(`| ${esc(e.route)} | ${e.kind} ${esc(e.name)} | ${esc(keys([...e.exit]))} | ${esc(keys(e.inherited))} | ${esc(ops.join('; ') || '—')} |`);
  }
  add();
  add('## Menu');
  add();
  add('| Link | Label | Menu key | Page proves |');
  add('|---|---|---|---|');
  for (const item of result.nav) {
    const page = result.entries.find((e) => e.kind === 'page' && e.route === item.href);
    add(`| ${item.href} | ${esc(item.label)} | ${item.permission ?? '—'} | ${page ? esc(keys(page.caps)) : '(no page)'} |`);
  }
  if (meta.catalog) {
    add();
    add('## Catalog (live)');
    add();
    add('| Key | Category | Roles |');
    add('|---|---|---|');
    for (const k of meta.catalog) add(`| ${k.key} | ${k.category} | ${(k.roles ?? []).join(', ')} |`);
  }
  return `${L.join('\n')}\n`;
}
