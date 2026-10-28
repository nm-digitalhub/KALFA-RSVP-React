#!/usr/bin/env node
// Source-only date/time inventory. No grep of docs, tests, strings or comments.
// Run from the target Git repository root: node scripts/audit-date-time.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fail = (message) => { console.error(`[X] ${message}`); process.exit(2); };
const repoRoot = (() => {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return fail('Run this script inside a Git repository.'); }
})();
process.chdir(repoRoot);

const packageJson = (() => {
  try { return JSON.parse(readFileSync('package.json', 'utf8')); }
  catch { return fail('Missing or invalid package.json at repository root.'); }
})();
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));
let ts;
try { ts = requireFromRepo('typescript'); }
catch { fail('Project-local TypeScript is required. Run npm ci first.'); }

const args = process.argv.slice(2);
if (args.some((s) => s !== '--json' && s !== '--help')) fail('Supported flags: --json, --help');
if (args.includes('--help')) {
  console.log('node scripts/audit-date-time.mjs [--json]\nScans executable source only. Creates reports/date-time-audit.md and .json.');
  process.exit(0);
}
const onlyJson = args.includes('--json');
const SCAN_ROOTS = ['src', 'worker', 'scripts', 'supabase/functions', 'voxfiles'];
const OUTPUT_DIR = 'reports';
const SOURCES = /\.(?:[cm]?[jt]s|tsx|jsx)$/i;
const SKIP_FILE = /(?:\.d\.[cm]?ts$|(?:^|[./-])(?:test|spec|stories|story|fixture|mock|generated|min)(?:[./-]|$)|\.(?:snap|map)$)/i;
const SKIP_DIR = /^(?:node_modules|vendor|dist|build|coverage|\.next[^/]*|\.git|__tests__|__mocks__|__fixtures__|fixtures|mocks|generated|__generated__|docs|documentation|plans|examples|reports|tests|test|typings)$/i;
const SKIP_OWN_FILE = /(?:^|\/)audit-date-time\.[cm]?js$/;

const canonical = (name) => {
  if (name === 'dayjs' || name.startsWith('dayjs/')) return 'dayjs';
  if (name === 'date-fns' || name.startsWith('date-fns/')) return 'date-fns';
  if (name === '@date-fns/tz' || name.startsWith('@date-fns/tz/')) return '@date-fns/tz';
  if (name === 'temporal-polyfill' || name.startsWith('temporal-polyfill/')) return 'temporal-polyfill';
  return null;
};
const depNames = ['dayjs', 'date-fns', '@date-fns/tz', 'temporal-polyfill'];
const dependencies = Object.fromEntries(depNames.map((key) => [key,
  packageJson.dependencies?.[key] ?? packageJson.devDependencies?.[key] ?? null]));

// git ls-files lists tracked and non-ignored untracked source, without following symlinks.
let gitFiles;
try {
  const bytes = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...SCAN_ROOTS],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  gitFiles = [...new Set(bytes.toString('utf8').split('\0').filter(Boolean))].sort();
} catch { fail('Unable to enumerate Git source files.'); }
const files = gitFiles.filter((file) => {
  const parts = file.replaceAll('\\', '/').split('/');
  if (parts.some((part) => SKIP_DIR.test(part))) return false;
  const base = parts.at(-1);
  if (!SOURCES.test(base) || SKIP_FILE.test(base) || SKIP_OWN_FILE.test(file)) return false;
  if (!SCAN_ROOTS.some((root) => file === root || file.startsWith(`${root}/`))) return false;
  return true;
});

const usages = [];
const declaredFns = [];
const imports = [];
const review = [];
const parseFailures = [];
const usageKeys = new Set();
const apiKey = (x) => `${x.family}:${x.api}`;
const site = (sf, node) => {
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { file: path.relative(repoRoot, sf.fileName).split(path.sep).join('/'),
    line: pos.line + 1, column: pos.character + 1 };
};
function record(sf, node, family, api, kind) {
  const where = site(sf, node);
  const unique = [where.file, where.line, where.column, family, api, kind].join('|');
  if (usageKeys.has(unique)) return;
  usageKeys.add(unique);
  usages.push({ ...where, family, api, kind });
}
function signal(sf, node, code, reason) { review.push({ ...site(sf, node), code, reason }); }
function readString(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}
function accessPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const parent = accessPath(node.expression);
    return parent ? [...parent, node.name.text] : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const parent = accessPath(node.expression);
    const val = readString(node.argumentExpression);
    return parent && val ? [...parent, val] : null;
  }
  return null;
}
function moduleInfo(specifier) {
  const family = canonical(specifier);
  return family ? { family, module: specifier } : null;
}
function isIdentifierUse(node) {
  const p = node.parent;
  if (ts.isImportClause(p) || ts.isImportSpecifier(p) || ts.isNamespaceImport(p) ||
      ts.isImportEqualsDeclaration(p) || ts.isExportSpecifier(p) || ts.isBindingElement(p) ||
      ts.isVariableDeclaration(p) && p.name === node ||
      ts.isParameter(p) && p.name === node ||
      ts.isFunctionDeclaration(p) && p.name === node ||
      ts.isPropertyAccessExpression(p) && p.name === node ||
      ts.isPropertyAssignment(p) && p.name === node ||
      ts.isShorthandPropertyAssignment(p) && p.name !== node ||
      ts.isMethodDeclaration(p) && p.name === node ||
      ts.isTypeReferenceNode(p)) return false;
  return true;
}
const temporalOps = new Set(['PlainDateTime', 'PlainDate', 'ZonedDateTime', 'Instant', 'Now', 'Duration', 'PlainTime']);
const timeName = /(?:date|time|day|month|week|year|hour|minute|second|duration|calendar|instant|clock|slot|tz|zone|localParts|deadline|schedule)/i;
function functionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return null;
}
function normalizedBody(node, sf) {
  if (!node.body) return null;
  const text = node.body.getText(sf);
  if (text.length < 40) return null;
  const substitutions = new Map((node.parameters ?? []).map((param, i) =>
    ts.isIdentifier(param.name) ? [param.name.text, `arg${i}`] : [null, null]).filter(([a]) => a));
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens = [];
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    const spelling = scanner.getTokenText();
    tokens.push(`${kind}:${kind === ts.SyntaxKind.Identifier ? (substitutions.get(spelling) ?? spelling) : spelling}`);
  }
  return createHash('sha256').update(tokens.join('\0')).digest('hex');
}

for (const rel of files) {
  const absolute = path.join(repoRoot, rel);
  let content;
  try { content = readFileSync(absolute, 'utf8'); }
  catch { parseFailures.push({ file: rel, reason: 'read failure' }); continue; }
  const kind = /\.tsx$|\.jsx$/i.test(rel) ? ts.ScriptKind.TSX : /\.[cm]?js$/i.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(absolute, content, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics.length) {
    parseFailures.push({ file: rel, reason: `${sf.parseDiagnostics.length} syntax diagnostics` });
    continue;
  }
  const bindings = new Map();
  const addImport = (name, family, api, specifier, node, typeOnly = false) => {
    if (!typeOnly) bindings.set(name, { family, api });
    imports.push({ ...site(sf, node), family, api, specifier, typeOnly });
  };

  // Pass 1: imports, re-exports and CommonJS bindings.
  function collect(node) {
    if (ts.isImportDeclaration(node)) {
      const specifier = readString(node.moduleSpecifier);
      const info = specifier && moduleInfo(specifier);
      if (info) {
        const c = node.importClause;
        if (!c) record(sf, node, info.family, specifier, 'side_effect_import');
        else {
          if (c.name) {
            const defaultApi = specifier === 'dayjs' ? 'dayjs' :
              specifier.startsWith('dayjs/plugin/') ? `plugin/${specifier.slice('dayjs/plugin/'.length)}` :
              specifier.startsWith('dayjs/locale/') ? `locale/${specifier.slice('dayjs/locale/'.length)}` : 'default';
            addImport(c.name.text, info.family, defaultApi, specifier, node, c.isTypeOnly);
          }
          if (c.namedBindings && ts.isNamespaceImport(c.namedBindings))
            addImport(c.namedBindings.name.text, info.family, '*', specifier, node, c.isTypeOnly);
          if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
            for (const element of c.namedBindings.elements) {
              const exported = element.propertyName?.text ?? element.name.text;
              addImport(element.name.text, info.family, specifier.includes('/plugin/') ? specifier.split('/').at(-1) : exported,
                specifier, node, c.isTypeOnly || element.isTypeOnly);
            }
          }
        }
      }
    }
    if (ts.isExportDeclaration(node)) {
      const specifier = readString(node.moduleSpecifier);
      const info = specifier && moduleInfo(specifier);
      if (info && !node.isTypeOnly) record(sf, node, info.family, specifier, 'reexport');
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(sf) === 'require') {
      const specifier = readString(node.initializer.arguments[0]);
      const info = specifier && moduleInfo(specifier);
      if (info) {
        if (ts.isIdentifier(node.name)) addImport(node.name.text, info.family, '*', specifier, node);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            if (ts.isIdentifier(el.name)) addImport(el.name.text, info.family,
              el.propertyName?.getText(sf) ?? el.name.text, specifier, node);
          }
        }
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(sf);

  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
      const name = functionName(node);
      if (name && timeName.test(name)) {
        declaredFns.push({ ...site(sf, node), name, fingerprint: normalizedBody(node, sf),
          bodyChars: node.body.getText(sf).length });
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const parts = accessPath(expression);
      const kind = ts.isNewExpression(node) ? 'construct' : 'call';
      const root = parts?.[0];
      if (root && bindings.has(root)) {
        const entry = bindings.get(root);
        const suffix = parts.slice(1).join('.');
        const api = entry.api === '*' ? suffix || '<namespace>' : entry.api + (suffix ? `.${suffix}` : '');
        record(sf, node, entry.family, api, kind);
      }
      if (parts?.[0] === 'Date' && !bindings.has('Date')) {
        if (parts.length === 1 || ['now', 'parse', 'UTC'].includes(parts[1])) record(sf, node, 'native', parts.join('.'), kind);
      }
      if (parts?.[0] === 'Intl' && ['DateTimeFormat', 'RelativeTimeFormat'].includes(parts[1]))
        record(sf, node, 'native', parts.slice(0, 2).join('.'), kind);
      if (parts?.[0] === 'Temporal' && temporalOps.has(parts[1]))
        record(sf, node, 'native', parts.join('.'), kind);
      if ((ts.isCallExpression(node) && (parts?.[0] === 'require' || expression.kind === ts.SyntaxKind.ImportKeyword))) {
        const specifier = readString(node.arguments[0]);
        const info = specifier && moduleInfo(specifier);
        if (info) record(sf, node, info.family, specifier, 'module_load');
      }
      if (parts?.[0] === 'Date' && parts[1] === 'parse' || parts?.length === 1 && parts[0] === 'Date') {
        const literal = readString(node.arguments?.[0]);
        if (literal && /^\d{4}-\d{2}-\d{2}[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(literal))
          signal(sf, node, 'zone_less_literal', 'Literal wall-clock timestamp parsed without an explicit zone');
        const argText = node.arguments?.[0]?.getText(sf) ?? '';
        if (/(?:\.startLocal|\.endLocal|\.dateTimeLocal|wallClock|wallTime)/.test(argText))
          signal(sf, node, 'possible_host_local_parse', 'Time-local-looking value passed to Date without an explicit zone');
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(expression) && expression.name.text === 'slice' &&
          node.arguments[0]?.getText(sf) === '0' && node.arguments[1]?.getText(sf) === '10' &&
          ts.isCallExpression(expression.expression) && ts.isPropertyAccessExpression(expression.expression.expression) &&
          expression.expression.expression.name.text === 'toISOString')
        signal(sf, node, 'utc_day_slice', 'toISOString().slice(0, 10) yields UTC day, not necessarily local day');
    }
    if (ts.isIdentifier(node) && bindings.has(node.text) && isIdentifierUse(node)) {
      // Count value references that are not already counted as a call/constructor.
      const parent = node.parent;
      const directInvocation = (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node;
      const nestedCall = ts.isPropertyAccessExpression(parent) && parent.expression === node &&
        (ts.isCallExpression(parent.parent) || ts.isNewExpression(parent.parent)) && parent.parent.expression === parent;
      if (!directInvocation && !nestedCall) {
        // An identifier inside a property-access chain is already represented by its outer call.
        const outer = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent : null;
        if (!outer || !ts.isPropertyAccessExpression(outer.parent)) {
          const entry = bindings.get(node.text);
          record(sf, node, entry.family, entry.api, 'value_reference');
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function distinctLocations(list) {
  return [...new Map(list.map(({ file, line }) => [`${file}:${line}`, { file, line }])).values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
const groups = new Map();
for (const item of usages) {
  const key = apiKey(item);
  if (!groups.has(key)) groups.set(key, { family: item.family, api: item.api, count: 0, kinds: new Set(), files: new Set(), sites: [] });
  const entry = groups.get(key);
  entry.count++;
  entry.kinds.add(item.kind);
  entry.files.add(item.file);
  entry.sites.push({ file: item.file, line: item.line, column: item.column, kind: item.kind });
}
const operations = [...groups.values()].map((x) => ({ ...x,
  kinds: [...x.kinds].sort(), files: [...x.files].sort(), sites: x.sites.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line) }))
  .sort((a,b) => a.family.localeCompare(b.family) || a.api.localeCompare(b.api));
const used = (family, pattern) => operations.filter((x) => x.family === family && pattern.test(x.api) &&
  x.kinds.some((k) => ['call', 'construct', 'value_reference', 'module_load', 'reexport', 'side_effect_import'].includes(k)));
const apiPresent = (family, pattern) => used(family, pattern).length > 0;
const functionNamed = (pattern) => declaredFns.some((x) => pattern.test(x.name));
const abilities = [
  { feature: 'formatting/localization', dayjs: 'format, localizedFormat, localeData', alternatives: ['Intl.DateTimeFormat', 'date-fns format'], observed: apiPresent('native', /^Intl\.DateTimeFormat$/) || apiPresent('date-fns', /^(format|formatInTimeZone)$/) },
  { feature: 'calendar arithmetic', dayjs: 'add, subtract, startOf, endOf', alternatives: ['date-fns addDays/addMonths/startOfWeek', 'local addCalendarDays'], observed: apiPresent('date-fns', /^(add|sub|startOf|endOf)/) || functionNamed(/^addCalendarDays$/) },
  { feature: 'date differences/comparison', dayjs: 'diff, isBefore, isAfter, isSame', alternatives: ['date-fns differenceIn/isSame'], observed: apiPresent('date-fns', /^(differenceIn|isSame|isBefore|isAfter)/) },
  { feature: 'timezone/UTC', dayjs: 'timezone and utc plugins', alternatives: ['Temporal', '@date-fns/tz', 'Intl.DateTimeFormat'], observed: apiPresent('@date-fns/tz', /TZDate/) || apiPresent('temporal-polyfill', /Temporal/) },
  { feature: 'strict or custom date parsing', dayjs: 'customParseFormat plugin', alternatives: ['temporal-polyfill', 'date-fns parse'], observed: apiPresent('temporal-polyfill', /Temporal/) || apiPresent('date-fns', /^parse/) },
  { feature: 'relative time in UI', dayjs: 'relativeTime plugin', alternatives: ['date-fns formatDistanceToNow', 'Intl.RelativeTimeFormat'], observed: apiPresent('date-fns', /^(formatDistance|formatRelative)/) || apiPresent('native', /^Intl\.RelativeTimeFormat$/) },
  { feature: 'calendar-relative UI labels', dayjs: 'calendar plugin', alternatives: ['date-fns formatRelative'], observed: apiPresent('date-fns', /^formatRelative$/) },
  { feature: 'duration objects/humanization', dayjs: 'duration plugin', alternatives: ['date-fns intervalToDuration/formatDuration', 'custom formatDuration'], observed: apiPresent('date-fns', /^(intervalToDuration|formatDuration)$/) || functionNamed(/^formatDuration$/) },
  { feature: 'ISO week', dayjs: 'isoWeek and weekOfYear plugins', alternatives: ['date-fns getWeek/getISOWeek'], observed: apiPresent('date-fns', /^(getWeek|getISOWeek|startOfISOWeek)/) },
];
const byName = new Map();
for (const f of declaredFns) {
  if (!byName.has(f.name)) byName.set(f.name, []);
  byName.get(f.name).push(f);
}
const sameName = [...byName.entries()].filter(([, values]) => new Set(values.map(x => x.file)).size > 1)
  .map(([name, entries]) => ({ name, sites: distinctLocations(entries) }))
  .sort((a,b) => a.name.localeCompare(b.name));
const byFingerprint = new Map();
for (const f of declaredFns) {
  if (!f.fingerprint) continue;
  if (!byFingerprint.has(f.fingerprint)) byFingerprint.set(f.fingerprint, []);
  byFingerprint.get(f.fingerprint).push(f);
}
const identicalBodies = [...byFingerprint.values()].filter((v) => new Set(v.map(f=>f.file)).size > 1)
  .map((v) => ({ names: [...new Set(v.map(f => f.name))].sort(), sites: distinctLocations(v) }))
  .sort((a,b) => a.names.join(',').localeCompare(b.names.join(',')));

const audit = {
  scope: { branch: (()=>{try{return execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()||'detached';}catch{return 'unknown';}})(),
    commit: (()=>{try{return execFileSync('git',['rev-parse','--verify','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return 'unknown';}})(),
    roots: SCAN_ROOTS, filesScanned: files.length, filesSkipped: gitFiles.length - files.length,
    testsDocsGeneratedExcluded: true, parseFailures },
  dependencies, libraryOperations: operations.filter(x=>x.family !== 'native'), nativeOperations: operations.filter(x=>x.family === 'native'),
  declaredTimeFunctions: declaredFns.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line),
  sameNameCandidates: sameName, identicalBodyCandidates: identicalBodies,
  manualReview: [...new Map(review.map(x=>[`${x.file}|${x.line}|${x.code}`,x])).values()].sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line),
  capabilityMatrix: abilities,
  interpretation: {
    sameNameCandidates: 'Same function name is not proof of a duplicate.',
    identicalBodyCandidates: 'Normalized lexical body match, not proof of equivalent semantics.',
    capabilityMatrix: 'observed means direct source evidence, not comprehensive semantic support; missing evidence is not a missing feature.',
    manualReview: 'Review candidates only; not verified defects.',
    limits: 'Only executable JS/TS files in selected roots. Historical SQL migrations are intentionally excluded; live DB functions require a separate audit. AST recognizes imported APIs and global constructors, not every instance method or dynamic runtime resolution.',
  },
};
const md = [];
md.push('# Date/time source audit', '');
md.push(`Scope: ${audit.scope.branch} @ ${audit.scope.commit.slice(0,12)} | ${files.length} source files | ${audit.scope.parseFailures.length} parse failures`, '');
md.push('## Declared dependencies and observed code calls', '');
md.push('| Library | Installed | Imported files | Code-use sites |', '|---|---|---:|---:|');
for (const name of depNames) {
  const seen = usages.filter(x=>x.family===name);
  const codeCalls = seen.filter(x=>['call','construct','module_load','reexport','side_effect_import','value_reference'].includes(x.kind));
  md.push(`| ${name} | ${dependencies[name] ?? 'not declared'} | ${new Set(imports.filter(x=>x.family===name && !x.typeOnly).map(x=>x.file)).size} | ${codeCalls.length} |`);
}
md.push('', '## Imported library APIs actually used', '');
md.push('| Library | API | Uses | Source files |', '|---|---|---:|---:|');
for (const op of audit.libraryOperations.filter(x=>x.kinds.some(k=>['call','construct','value_reference','module_load','reexport','side_effect_import'].includes(k)))) {
  md.push(`| ${op.family} | \`${op.api}\` | ${op.count} | ${op.files.length} |`);
}
md.push('', '## Native Date/Intl/Temporal APIs', '', '| API | Sites | Files |', '|---|---:|---:|');
for (const op of audit.nativeOperations) md.push(`| \`${op.api}\` | ${op.count} | ${op.files.length} |`);
md.push('', '## Capability map (observed usage is not proof of full feature coverage)', '', '| Capability | Dayjs provides | Existing alternatives | Observed |', '|---|---|---|---|');
for (const a of abilities) md.push(`| ${a.feature} | ${a.dayjs} | ${a.alternatives.join('; ')} | ${a.observed ? 'yes' : 'no direct usage found'} |`);
md.push('', '## Repeated date/time function names (review only)', '');
if (!sameName.length) md.push('None.');
for (const x of sameName) md.push(`- \`${x.name}\`: ${x.sites.map(s=>`\`${s.file}:${s.line}\``).join(', ')}`);
md.push('', '## Identical normalized function bodies (review only)', '');
if (!identicalBodies.length) md.push('None.');
for (const x of identicalBodies) md.push(`- \`${x.names.join(', ')}\`: ${x.sites.map(s=>`\`${s.file}:${s.line}\``).join(', ')}`);
md.push('', '## Time-zone/date conversion review candidates (not confirmed bugs)', '');
if (!audit.manualReview.length) md.push('None.');
for (const x of audit.manualReview) md.push(`- \`${x.file}:${x.line}\` [${x.code}]: ${x.reason}`);
if (parseFailures.length) { md.push('', '## Source files not parsed', '');for(const x of parseFailures) md.push(`- \`${x.file}\`: ${x.reason}`); }
md.push('', 'Full code-only locations are in date-time-audit.json. No documentation, comments, test files or generated files were scanned.', '');
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(path.join(OUTPUT_DIR, 'date-time-audit.json'), JSON.stringify(audit,null,2)+'\n');
writeFileSync(path.join(OUTPUT_DIR, 'date-time-audit.md'), md.join('\n')+'\n');
if (onlyJson) console.log(JSON.stringify({ files: files.length, parseFailures:parseFailures.length,
  outputs: ['reports/date-time-audit.json','reports/date-time-audit.md'] }));
else console.log(`[OK] ${files.length} code files scanned; ${parseFailures.length} parse failures.\n[OK] reports/date-time-audit.md\n[OK] reports/date-time-audit.json`);
if (parseFailures.length) process.exitCode = 1;
