#!/usr/bin/env node
// Lists every place in CODE that reads or writes the legacy payment columns of public.campaigns — the columns that
// the payment ledger (public.payment_operations) replaces (docs/superpowers/plans/2026-09-24-campaign-payment-domain-split.md,
// the "Contract" step). Run it before moving a reader to the ledger and again before dropping a column:
//
//   node scripts/find-legacy-campaign-payment-columns.mjs                 # app code (TypeScript/JavaScript)
//   node scripts/find-legacy-campaign-payment-columns.mjs --db            # + live database objects (functions, views, ...)
//   node scripts/find-legacy-campaign-payment-columns.mjs --json          # machine-readable
//   node scripts/find-legacy-campaign-payment-columns.mjs --no-tests      # leave test files out
//   node scripts/find-legacy-campaign-payment-columns.mjs --verbose       # also list matches that belong to OTHER tables
//   node scripts/find-legacy-campaign-payment-columns.mjs --columns a,b   # a different column set
//
// WHAT COUNTS (and what does not). The file is parsed with the TypeScript compiler, so only syntax that is CODE is
// looked at: comments and JSDoc are not part of the syntax tree and can never match; Markdown, docs/, plans/ and
// handoffs/ are never opened. Inside code, a column name counts only in a position that actually names a column:
//   - a property access / element access / destructuring of the column     (row.capture_status)
//   - a key of an object literal passed to .update/.insert/.upsert         (WRITE)
//   - an argument of a Supabase query method that takes columns            (.select('...') .eq('capture_status', x))
//   - a PostgREST filter string                                            (.or('charge_status.is.null,...'))
//   - a comma-separated column list stored in a constant                   ('id, status, capture_status')
//   - a column named in an embedded resource                               (.select('id, campaigns(charge_status)'))
//   - a type that mirrors the column                                       (Pick<Row, 'capture_status'>, { capture_status: string })
// A string that is prose (an error message, a label) is ignored, and so is a bare identifier or variable that merely
// shares a column's name. src/lib/supabase/types.generated.ts is skipped (generated output).
//
// WHICH TABLE. A name alone does not prove the column belongs to campaigns, so every match is graded:
//   confirmed  the query chain starts at .from('campaigns') (or an embed of it), or the type checker resolves the
//              property to the campaigns row in the generated types
//   likely     the table could not be resolved, but the name exists in NO other table or view
//   ambiguous  the table could not be resolved AND the name also exists on another table — review by hand
//   weak       the name is unique to campaigns, but the file never mentions campaigns anywhere in its code
// (an unresolved match is upgraded to `likely` when the same file reads that column from campaigns.)
// A match whose chain starts at a DIFFERENT table is dropped (shown only with --verbose).
//
// ACCESS: READ (select / filter / property read / destructure), WRITE (update/insert/upsert payload, assignment),
// TYPE (a type that names the column), SHAPE (an object literal or fixture that carries the column but is not a query).
// Read-only: the script never writes a file or changes anything; --db only runs catalog SELECTs through the Supabase CLI.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = process.cwd();
const GENERATED = path.join(ROOT, 'src/lib/supabase/types.generated.ts');

// The 26 legacy payment columns (the plan's "23 live + 3 dead").
const DEFAULT_COLUMNS = [
  'billing_route', 'final_charge_amount', 'final_invoice_document_id', 'auth_amount', 'auth_number', 'authorized_at',
  'capture_status', 'release_status', 'sumit_order_document_id', 'card_token_ref', 'auth_external_ref',
  'card_exp_month', 'card_exp_year', 'card_citizen_id', 'charge_status', 'charged_at', 'sumit_charge_document_id',
  'charge_document_number', 'charge_document_url', 'charge_auth_number', 'charge_payment_id', 'credit_applied',
  'hold_order_document_id', 'hold_order_document_number', 'hold_order_document_url', 'sumit_customer_id',
];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const COLUMNS = new Set((opt('--columns') ? opt('--columns').split(',') : DEFAULT_COLUMNS).map((s) => s.trim()).filter(Boolean));
const WITH_TESTS = !flag('--no-tests');
const VERBOSE = flag('--verbose');
const AS_JSON = flag('--json');
const WITH_DB = flag('--db');

// Query-builder methods whose arguments name columns, and what that means.
const SELECT_METHODS = new Set(['select']);
const FILTER_METHODS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'overlaps', 'not',
  'filter', 'or', 'order', 'match', 'textSearch', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent',
]);
const WRITE_METHODS = new Set(['update', 'insert', 'upsert']);

const EXCLUDED_PREFIX = [
  'docs/', 'plans/', 'handoffs/', 'openapi/', 'typings/', 'templates/', 'voxfiles/', 'israeli-market-fit/',
  '.agents/', '.claude/', '.fleet-logs/', 'supabase/migrations/', 'node_modules/', '.next', 'dist/',
];
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || f.includes('/__tests__/') || f.startsWith('src/test/');

// ---------------------------------------------------------------------------------------------------------------------
// 1. Which tables carry each name (from the generated types), to grade ambiguity.
// ---------------------------------------------------------------------------------------------------------------------
function namesByTable() {
  const sf = ts.createSourceFile(GENERATED, readFileSync(GENERATED, 'utf8'), ts.ScriptTarget.Latest, true);
  const map = new Map(); // column -> Set(table)
  const member = (lit, name) => lit?.members?.find((m) => m.name && m.name.text === name);
  const typeLit = (m) => (m && m.type && ts.isTypeLiteralNode(m.type) ? m.type : undefined);
  const db = sf.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'Database');
  const pub = typeLit(member(db?.type, 'public'));
  for (const group of ['Tables', 'Views']) {
    const g = typeLit(member(pub, group));
    for (const t of g?.members ?? []) {
      const row = typeLit(member(typeLit(t), 'Row'));
      for (const c of row?.members ?? []) {
        if (!c.name) continue;
        const name = c.name.text;
        if (!map.has(name)) map.set(name, new Set());
        map.get(name).add(t.name.text);
      }
    }
  }
  return map;
}
const TABLES_OF = namesByTable();
const otherTables = (col) => [...(TABLES_OF.get(col) ?? [])].filter((t) => t !== 'campaigns');

// ---------------------------------------------------------------------------------------------------------------------
// 2. Program (type checker is used to resolve a property to its declaring table and to follow a query variable).
// ---------------------------------------------------------------------------------------------------------------------
const cfg = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean);
const SELF = 'scripts/find-legacy-campaign-payment-columns.mjs';
const wanted = new Set(
  tracked
    .filter((f) => f !== SELF && CODE_EXT.test(f) && !EXCLUDED_PREFIX.some((p) => f.startsWith(p)) && (WITH_TESTS || !isTestFile(f)))
    .map((f) => path.join(ROOT, f)),
);
const program = ts.createProgram({ rootNames: [...new Set([...parsed.fileNames, ...wanted])], options: { ...parsed.options, noEmit: true } });
const checker = program.getTypeChecker();

// ---------------------------------------------------------------------------------------------------------------------
// 3. Helpers.
// ---------------------------------------------------------------------------------------------------------------------
const unwrap = (e) => {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression;
  return e;
};


// A call to a function declared in the repo: the table of the query chain it returns (first return that resolves).
function helperTable(id, depth = 0) {
  if (depth > 3) return undefined;
  const d = checker.getSymbolAtLocation(id)?.valueDeclaration;
  let fn;
  if (d && ts.isFunctionDeclaration(d)) fn = d;
  else if (d && ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fn = d.initializer;
  if (!fn || !fn.body) return undefined;
  if (!ts.isBlock(fn.body)) return chainTable(fn.body);
  let found;
  (function walk(n) {
    if (found || (n !== fn.body && (ts.isFunctionLike(n)))) return;
    if (ts.isReturnStatement(n) && n.expression) { found = chainTable(n.expression); if (found) return; }
    ts.forEachChild(n, walk);
  })(fn.body);
  return found;
}

// The table a query-builder chain starts at, or undefined when it cannot be resolved statically.
function chainTable(expr) {
  let e = unwrap(expr);
  for (let guard = 0; guard < 40 && e; guard++) {
    e = unwrap(e);
    if (ts.isCallExpression(e)) {
      const c = e.expression;
      if (ts.isPropertyAccessExpression(c)) {
        if (c.name.text === 'from') {
          const a = e.arguments[0];
          return a && ts.isStringLiteralLike(a) ? a.text : undefined;
        }
        e = c.expression;
        continue;
      }
      if (ts.isIdentifier(c)) return helperTable(c);   // await selectCustomerNumber(id) -> the chain that helper returns
      return undefined;
    }
    if (ts.isPropertyAccessExpression(e)) { e = e.expression; continue; }
    if (ts.isIdentifier(e)) {
      const d = checker.getSymbolAtLocation(e)?.valueDeclaration;
      if (d && ts.isVariableDeclaration(d) && d.initializer) { e = d.initializer; continue; }
      return undefined;
    }
    return undefined;
  }
  return undefined;
}


// The table a row-valued expression came from: follows `const { data } = await admin.from('t')...`, a callback
// parameter of data.map(...), a for-of variable, and `x ?? []` back to the query chain. undefined when unknown.
function rowTableOf(expr, depth = 0) {
  if (!expr || depth > 8) return undefined;
  let e = unwrap(expr);
  if (e && ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return rowTableOf(e.left, depth + 1);
  if (e && ts.isPropertyAccessExpression(e)) return /^(data|rows|results?)$/.test(e.name.text) ? rowTableOf(e.expression, depth + 1) : undefined;
  if (e && ts.isCallExpression(e)) return chainTable(e);
  if (!e || !ts.isIdentifier(e)) return undefined;
  const d = checker.getSymbolAtLocation(e)?.valueDeclaration;
  if (!d) return undefined;
  if (ts.isBindingElement(d)) {
    const vd = d.parent?.parent;
    if (vd && ts.isVariableDeclaration(vd) && vd.initializer) return chainTable(vd.initializer) ?? rowTableOf(vd.initializer, depth + 1);
  }
  if (ts.isVariableDeclaration(d)) {
    const loop = d.parent?.parent;
    if (loop && ts.isForOfStatement(loop)) return rowTableOf(loop.expression, depth + 1);
    if (d.initializer) return chainTable(d.initializer) ?? rowTableOf(d.initializer, depth + 1);
  }
  if (ts.isParameter(d)) {
    const fn = d.parent;
    const call = fn?.parent;
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && call && ts.isCallExpression(call) && call.arguments[0] === fn && ts.isPropertyAccessExpression(call.expression)) return rowTableOf(call.expression.expression, depth + 1);
  }
  return undefined;
}

// Does a symbol belong to the campaigns row in the generated types? 'campaigns' | 'other' | undefined (unknown).
function declaringTable(sym) {
  for (const d of sym?.declarations ?? []) {
    if (path.resolve(d.getSourceFile().fileName) !== GENERATED) continue;
    for (let n = d; n; n = n.parent) {
      if (ts.isPropertySignature(n) && n.parent && ts.isTypeLiteralNode(n.parent)) {
        const g = n.parent.parent; // PropertySignature "Tables"/"Views" owns this literal
        if (g && ts.isPropertySignature(g) && g.name && /^(Tables|Views)$/.test(g.name.text)) return n.name.text === 'campaigns' ? 'campaigns' : 'other';
      }
    }
  }
  return undefined;
}

function grade(col, table, symTable) {
  if (table === 'campaigns' || symTable === 'campaigns') return 'confirmed';
  if (table && table !== 'campaigns') return 'other-table';
  if (symTable === 'other') return 'other-table';
  return otherTables(col).length === 0 ? 'likely' : 'ambiguous';
}

const refs = [];
const dropped = [];
function record(sf, node, col, access, via, table, symTable, note) {
  const g = grade(col, table, symTable);
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const file = path.relative(ROOT, sf.fileName);
  const item = {
    file, line: line + 1, col: character + 1, column: col, access, via,
    table: table ?? (symTable === 'campaigns' ? 'campaigns' : undefined) ?? null, confidence: g,
    test: isTestFile(file), note: note ?? null,
    text: sf.text.split('\n')[line].trim().slice(0, 150),
  };
  (g === 'other-table' ? dropped : refs).push(item);
}

const wordsIn = (text) => [...COLUMNS].filter((c) => new RegExp(`(^|[^A-Za-z0-9_])${c}($|[^A-Za-z0-9_])`).test(text));
const isColumnList = (text) => /^[\w*\s,().!:]+$/.test(text) && (text.includes(',') || /^\s*\w+\s*$/.test(text));

// ---------------------------------------------------------------------------------------------------------------------
// 4. Walk every wanted file.
// ---------------------------------------------------------------------------------------------------------------------
function visit(sf, node) {
  // --- strings: only where they name a column ---------------------------------------------------------------------
  if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    const text = ts.isStringLiteralLike(node) ? node.text : node.text;
    const cols = wordsIn(text);
    if (cols.length) handleString(sf, node, text, cols);
  }

  // --- property / element access -----------------------------------------------------------------------------------
  if (ts.isPropertyAccessExpression(node) && COLUMNS.has(node.name.text)) {
    const col = node.name.text;
    const parent = node.parent;
    const isWrite = ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    record(sf, node.name, col, isWrite ? 'WRITE' : 'READ', 'property access', rowTableOf(node.expression), declaringTable(checker.getSymbolAtLocation(node.name)));
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) && COLUMNS.has(node.argumentExpression.text)) {
    record(sf, node.argumentExpression, node.argumentExpression.text, 'READ', 'element access', undefined, undefined);
  }

  // --- destructuring -----------------------------------------------------------------------------------------------
  if (ts.isBindingElement(node)) {
    const key = node.propertyName ?? node.name;
    const name = key && (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) ? key.text : undefined;
    if (name && COLUMNS.has(name)) {
      const vd = node.parent?.parent;
      const from = vd && ts.isVariableDeclaration(vd) && vd.initializer ? (rowTableOf(vd.initializer) ?? chainTable(vd.initializer)) : undefined;
      record(sf, key, name, 'READ', 'destructuring', from, declaringTable(checker.getSymbolAtLocation(key)));
    }
  }

  // --- object literal keys: a write payload or just a shape --------------------------------------------------------
  if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && COLUMNS.has(node.name.text)) {
    const col = node.name.text;
    const w = writeContext(node.parent);
    if (w) record(sf, node.name, col, 'WRITE', `.${w.method}() payload`, w.table, undefined);
    else record(sf, node.name, col, 'SHAPE', 'object literal', undefined, contextTable(node.parent, col));
  }

  // --- types that mirror a column ----------------------------------------------------------------------------------
  if (ts.isPropertySignature(node) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && COLUMNS.has(node.name.text)) {
    record(sf, node.name, node.name.text, 'TYPE', 'type member', undefined, undefined);
  }
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal) && COLUMNS.has(node.literal.text)) {
    record(sf, node.literal, node.literal.text, 'TYPE', 'string-literal type', undefined, undefined);
  }

  ts.forEachChild(node, (c) => visit(sf, c));
}

// The table a typed object literal belongs to: look the key up on the type the literal is contextually typed as.
function contextTable(objLit, col) {
  const ctx = checker.getContextualType(objLit);
  if (!ctx) return undefined;
  const parts = ctx.isUnion() ? ctx.types : [ctx];
  const seenTables = new Set();
  for (const t of parts) {
    const t2 = checker.getNonNullableType(t);
    const found = declaringTable(checker.getPropertyOfType(t2, col));
    if (found) seenTables.add(found);
  }
  if (seenTables.has('campaigns')) return 'campaigns';
  if (seenTables.size) return 'other';
  return undefined;
}

// Is this object literal (or an array of them, or a variable holding one) the payload of .update/.insert/.upsert?
function writeContext(objLit) {
  let n = objLit;
  if (n.parent && ts.isArrayLiteralExpression(n.parent)) n = n.parent;
  const call = n.parent;
  if (call && ts.isCallExpression(call) && call.arguments.includes(n) && ts.isPropertyAccessExpression(call.expression) && WRITE_METHODS.has(call.expression.name.text)) {
    return { method: call.expression.name.text, table: chainTable(call.expression.expression) };
  }
  // const patch = { capture_status: ... }; ...update(patch)
  const decl = n.parent;
  if (decl && ts.isVariableDeclaration(decl) && decl.initializer === n && ts.isIdentifier(decl.name)) {
    const sym = checker.getSymbolAtLocation(decl.name);
    for (const ref of findReferences(sym, decl.getSourceFile())) {
      const c = ref.parent;
      if (c && ts.isCallExpression(c) && c.arguments.includes(ref) && ts.isPropertyAccessExpression(c.expression) && WRITE_METHODS.has(c.expression.name.text)) {
        return { method: c.expression.name.text, table: chainTable(c.expression.expression) };
      }
    }
  }
  return undefined;
}
function findReferences(sym, sf) {
  const out = [];
  if (!sym) return out;
  (function walk(n) {
    if (ts.isIdentifier(n) && n.text === sym.name && checker.getSymbolAtLocation(n) === sym) out.push(n);
    ts.forEachChild(n, walk);
  })(sf);
  return out;
}

function handleString(sf, node, text, cols) {
  const lit = node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle || node.kind === ts.SyntaxKind.TemplateTail ? node.parent.parent ?? node.parent : node;
  const call = lit.parent && ts.isCallExpression(lit.parent) && lit.parent.arguments.includes(lit) ? lit.parent : undefined;
  const method = call && ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
  if (call && method && (SELECT_METHODS.has(method) || FILTER_METHODS.has(method))) {
    const base = chainTable(call.expression.expression);
    // embedded resource: select('id, campaigns(capture_status)') — those columns are campaigns' whatever the base is
    if (SELECT_METHODS.has(method)) {
      for (const m of text.matchAll(/campaigns(?:![\w]+)?\(([^()]*)\)/g)) {
        for (const c of cols.filter((x) => new RegExp(`(^|[^A-Za-z0-9_])${x}($|[^A-Za-z0-9_])`).test(m[1]))) record(sf, node, c, 'READ', `.select() embed`, 'campaigns', undefined);
      }
      const outside = text.replace(/[\w:]*campaigns(?:![\w]+)?\([^()]*\)/g, '');
      for (const c of wordsIn(outside)) record(sf, node, c, 'READ', '.select() list', base, undefined);
    } else {
      for (const c of cols) record(sf, node, c, 'READ', `.${method}() filter`, base, undefined);
    }
    return;
  }
  if (ts.isLiteralTypeNode(node.parent)) return; // handled as a type
  if (isColumnList(text)) {
    // const COLUMNS = 'id, capture_status, ...'  ->  follow the constant to the query that uses it
    let usedAt;
    const d = lit.parent;
    if (d && ts.isVariableDeclaration(d) && d.initializer === lit && ts.isIdentifier(d.name)) {
      for (const ref of findReferences(checker.getSymbolAtLocation(d.name), sf)) {
        const c = ref.parent;
        if (c && ts.isCallExpression(c) && c.arguments.includes(ref) && ts.isPropertyAccessExpression(c.expression) && (SELECT_METHODS.has(c.expression.name.text) || FILTER_METHODS.has(c.expression.name.text))) {
          usedAt = { table: chainTable(c.expression.expression), method: c.expression.name.text };
          break;
        }
      }
    }
    for (const c of cols) {
      if (usedAt) record(sf, node, c, 'READ', `column list used by .${usedAt.method}()`, usedAt.table, undefined);
      else record(sf, node, c, 'READ', 'column list / column name', undefined, undefined, 'a string of column names — check where it is used');
    }
  }
  // anything else is prose (an error message, a label, a comment-like string): ignored on purpose
}

for (const sf of program.getSourceFiles()) {
  if (!wanted.has(path.resolve(sf.fileName)) || path.resolve(sf.fileName) === GENERATED) continue;
  visit(sf, sf);
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Optional: live database objects that read the columns (functions, views, policies, triggers, indexes, constraints).
// ---------------------------------------------------------------------------------------------------------------------
function dbObjects() {
  const cols = [...COLUMNS];
  const word = (c) => `(^|[^a-z0-9_])${c}($|[^a-z0-9_])`;
  const anyCol = `(${cols.map((c) => word(c)).join('|')})`;
  const q = (sql) => JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).rows;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const hit = (s) => cols.filter((c) => new RegExp(word(c)).test(s));
  const out = [];
  for (const r of q(`select p.proname as name, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f','p')`)) {
    const body = strip(r.def);
    const c = hit(body);
    if (c.length && /campaigns/i.test(body)) out.push({ kind: 'function', name: r.name, columns: c, note: 'body also mentions campaigns' });
  }
  for (const r of q(`select viewname as name, definition as def from pg_views where schemaname = 'public'`)) {
    const c = hit(strip(r.def));
    if (c.length && /campaigns/i.test(r.def)) out.push({ kind: 'view', name: r.name, columns: c });
  }
  for (const r of q(`select policyname as name, tablename as tbl, coalesce(qual,'') || ' ' || coalesce(with_check,'') as def from pg_policies where schemaname = 'public'`)) {
    const c = hit(r.def);
    if (c.length && (r.tbl === 'campaigns' || /campaigns/i.test(r.def))) out.push({ kind: 'policy', name: `${r.tbl}.${r.name}`, columns: c });
  }
  for (const r of q(`select tgname as name, pg_get_triggerdef(t.oid) as def from pg_trigger t where tgrelid = 'public.campaigns'::regclass and not tgisinternal`)) {
    const c = hit(r.def);
    if (c.length) out.push({ kind: 'trigger (UPDATE OF / WHEN)', name: r.name, columns: c });
  }
  for (const r of q(`select indexname as name, indexdef as def from pg_indexes where schemaname = 'public' and tablename = 'campaigns'`)) {
    const c = hit(r.def);
    if (c.length) out.push({ kind: 'index', name: r.name, columns: c });
  }
  for (const r of q(`select conname as name, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.campaigns'::regclass`)) {
    const c = hit(r.def);
    if (c.length) out.push({ kind: 'constraint', name: r.name, columns: c });
  }
  void anyCol;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Report.
// ---------------------------------------------------------------------------------------------------------------------
// File-level corroboration: an unresolved match is upgraded when the same file reads that column from campaigns, and a
// match whose file never mentions campaigns at all is downgraded to 'weak' (the name is unique, the context is not).
const confirmedIn = new Map();
for (const r of refs) if (r.confidence === 'confirmed') confirmedIn.set(`${r.file}|${r.column}`, true);
const mentionsCampaign = new Map();
for (const sf of program.getSourceFiles()) {
  const f = path.relative(ROOT, sf.fileName);
  if (!wanted.has(path.resolve(sf.fileName))) continue;
  let hit = false;
  (function walk(n) {
    if (hit) return;
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && /campaign/i.test(n.text)) { hit = true; return; }
    ts.forEachChild(n, walk);
  })(sf);
  mentionsCampaign.set(f, hit);
}
for (const r of refs) {
  if (r.confidence === 'ambiguous' && confirmedIn.get(`${r.file}|${r.column}`)) { r.confidence = 'likely'; r.note = r.note ?? 'same file reads it from campaigns'; }
  else if (r.confidence === 'likely' && !mentionsCampaign.get(r.file)) { r.confidence = 'weak'; r.note = r.note ?? 'file never mentions campaigns'; }
}

const key = (r) => `${r.file}:${r.line}:${r.col}:${r.column}:${r.access}`;
const seen = new Set();
const unique = refs.filter((r) => (seen.has(key(r)) ? false : (seen.add(key(r)), true)));
unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
const db = WITH_DB ? dbObjects() : undefined;

if (AS_JSON) {
  console.log(JSON.stringify({ columns: [...COLUMNS], references: unique, dropped: VERBOSE ? dropped : undefined, database: db }, null, 1));
  process.exit(0);
}

const byFile = new Map();
for (const r of unique) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const codeRefs = unique.filter((r) => !r.test);
const testRefs = unique.filter((r) => r.test);

console.log(`Legacy campaigns payment columns scanned: ${COLUMNS.size}\n`);
for (const [file, list] of byFile) {
  console.log(`${file}  (${list.length})${list[0].test ? '  [test]' : ''}`);
  for (const r of list) console.log(`  ${String(r.line).padStart(5)}:${String(r.col).padEnd(3)} ${r.access.padEnd(5)} ${r.confidence.padEnd(9)} ${r.column.padEnd(26)} ${r.via}${r.table ? ` [${r.table}]` : ''}${r.note ? ` — ${r.note}` : ''}`);
}
console.log('\n--- summary ---');
console.log(`references: ${unique.length} in ${byFile.size} files  (code ${codeRefs.length} in ${new Set(codeRefs.map((r) => r.file)).size} files, tests ${testRefs.length} in ${new Set(testRefs.map((r) => r.file)).size} files)`);
console.log('by access    :', JSON.stringify(count(unique, (r) => r.access)));
console.log('by confidence:', JSON.stringify(count(unique, (r) => r.confidence)));
const perColumn = count(unique, (r) => r.column);
console.log('by column    :', JSON.stringify(Object.fromEntries(Object.entries(perColumn).sort((a, b) => b[1] - a[1]))));
const untouched = [...COLUMNS].filter((c) => !perColumn[c]);
console.log(`columns with NO reference in code: ${untouched.length ? untouched.join(', ') : '(none)'}`);
if (dropped.length) console.log(`dropped (the chain starts at another table): ${dropped.length}${VERBOSE ? '' : '  (--verbose to list)'}`);
if (VERBOSE) for (const r of dropped) console.log(`  ${r.file}:${r.line}  ${r.column}  [${r.table ?? 'other'}]  ${r.via}`);
const ambiguous = unique.filter((r) => r.confidence === 'ambiguous' || r.confidence === 'weak');
if (ambiguous.length) console.log(`\nNEEDS A MANUAL LOOK (${ambiguous.length}): the table could not be resolved (ambiguous = the name also exists on another table, weak = the file has no campaign context)`);
for (const r of ambiguous) console.log(`  ${r.file}:${r.line}  ${r.column}  ${r.confidence}${otherTables(r.column).length ? ` (also on: ${otherTables(r.column).join(', ')})` : ''}`);
console.log('\n--- files to migrate (non-test code with a READ or WRITE; confirmed + likely only) ---');
const migrate = new Map();
const mirrorOnly = new Map();
for (const r of unique) {
  if (r.test || !(r.confidence === 'confirmed' || r.confidence === 'likely')) continue;
  const target = r.access === 'READ' || r.access === 'WRITE' ? migrate : mirrorOnly;
  if (!target.has(r.file)) target.set(r.file, new Set());
  target.get(r.file).add(r.column);
}
for (const [f, c] of [...migrate].sort((a, b) => b[1].size - a[1].size)) console.log(`  ${String(c.size).padStart(2)} columns  ${f}`);
const mirrors = [...mirrorOnly].filter(([f]) => !migrate.has(f));
if (mirrors.length) {
  console.log('\n--- non-test files that only MIRROR a column (type member / object shape), no read or write ---');
  for (const [f, c] of mirrors) console.log(`  ${String(c.size).padStart(2)} columns  ${f}`);
}
if (db) {
  console.log('\n--- live database objects that reference the columns ---');
  for (const o of db) console.log(`  ${o.kind.padEnd(26)} ${o.name}  ←  ${o.columns.join(', ')}${o.note ? `  (${o.note})` : ''}`);
  if (!db.length) console.log('  (none)');
}
