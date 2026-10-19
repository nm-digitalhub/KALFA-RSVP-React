// The analysis behind scripts/permission-matrix.mjs. Separate, and pure, so its tests can run it on a small program built
// in memory (analyze.test.mjs) instead of on the repo: it reads the TypeScript program and the database facts it is
// handed, and returns data. No file, process or network access.
//
// WHAT IT PROVES, AND HOW.
//   - Every call is resolved by the type checker to the declaration it really reaches, across imports. A gate is a gate
//     only when it resolves to its own module (src/lib/auth/dal.ts, src/lib/auth/console-agent.ts), never by name.
//   - Each function is walked path by path (if / else, return, throw, try, loops, switch). A gate PROTECTS an operation
//     only when every path reaching it has checked it: awaited, not in a callback or behind && / ?: inside its
//     statement, and not in a try whose catch neither rethrows nor exits (Next's redirect() is an exception a catch can
//     swallow). When every path checked SOME capability but not the same one, the guarantee is `any(a|b)`. A callee's
//     guarantee at its exit protects what the caller does after the call.
//   - A check that only answers (hasPlatformPermission, isPlatformOwner, callerHasPlatformPermission,
//     requireConsoleAgent) protects only when its answer guards an exit: `if (!(await check())) return/throw/notFound()`,
//     or the same through a variable (`const ok = await check(); if (!ok) …`, `if (!auth.ok) …`, an element of an awaited
//     Promise.all destructured into a name). Otherwise it is conditional UI, and protects nothing.
//   - A nested function is analysed only where it is called; a function passed as an argument (a callback) is analysed
//     in place, as code that MAY run.
//   - A layout's gate is shown but never counted for the page under it: Next renders a page's segments independently of
//     the layout, and its docs say to check auth next to the data (node_modules/next/dist/docs/01-app/02-guides/
//     authentication.md, "Layouts and auth checks").
//   - The client of a query is traced to its source: createAdminClient() (service role: RLS does not apply),
//     createClient() (cookie: RLS applies), a helper that returns one of them, or a parameter whose argument at the
//     call site is one of them. Anything else stays `?`, and an unprotected operation on a `?` client is UNRESOLVED.
//
// EVERY FINDING HAS A STATE.
//   MISMATCH    a contradiction the code and the data prove;
//   UNRESOLVED  the scan cannot decide (an unresolved call before the operation, a cut-off path, a dynamic key, an
//               unknown client, a gate that may not enforce, an RPC whose effect is unknown);
//   REVIEW      a possible gap that needs a business decision (which key is right is not in the code). A write behind
//               only a view key is REVIEW, not MISMATCH: "view" is our naming, not a rule the database enforces. An
//               insert into a table the admin code only inserts into (a log) is not counted as such a write;
//   PROVEN      the operation is protected, before it, by the key shown. Whether that key is the RIGHT one is proven only
//               against a policy file (--policy); without it PROVEN means "gated", not "gated correctly".

import path from 'node:path';

export const FLOOR = new Set(['USER', 'STAFF', 'CONSOLE_AGENT']);
export const STATES = ['MISMATCH', 'UNRESOLVED', 'REVIEW', 'PROVEN'];

const GATE_DEFS = new Map([
  ['src/lib/auth/dal.ts#requirePlatformPermission', { kind: 'require', keyArg: 0 }],
  ['src/lib/auth/dal.ts#requirePlatformOwner', { kind: 'require', key: 'OWNER' }],
  ['src/lib/auth/dal.ts#requirePlatformStaff', { kind: 'require', key: 'STAFF' }],
  ['src/lib/auth/dal.ts#requireUser', { kind: 'require', key: 'USER' }],
  ['src/lib/auth/dal.ts#hasPlatformPermission', { kind: 'check', keyArg: 0 }],
  ['src/lib/auth/dal.ts#isPlatformOwner', { kind: 'check', key: 'OWNER' }],
  ['src/lib/auth/dal.ts#isStaff', { kind: 'check', key: 'STAFF' }],
  ['src/lib/auth/console-agent.ts#callerHasPlatformPermission', { kind: 'check', keyArg: 1 }],
  ['src/lib/auth/console-agent.ts#requireConsoleAgent', { kind: 'check', key: 'CONSOLE_AGENT' }],
]);
const CLIENT_DEFS = new Map([
  ['src/lib/supabase/admin.ts#createAdminClient', 'service'],
  ['src/lib/supabase/server.ts#createClient', 'cookie'],
]);
// Next's navigation functions throw: a branch that calls one does not fall through.
const NEXT_EXITS = new Set(['notFound', 'redirect', 'permanentRedirect', 'forbidden', 'unauthorized']);
const CHAIN_OPS = new Set(['select', 'insert', 'update', 'upsert', 'delete']);
const TABLE_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
const STORAGE_WRITES = new Set(['upload', 'update', 'remove', 'move', 'copy', 'createSignedUploadUrl', 'uploadToSignedUrl']);
const AUTH_ADMIN_READS = new Set(['getUserById', 'listUsers', 'listFactors']);
// The gate itself, called as an RPC: not an operation to protect.
const GATE_RPCS = new Set(['has_platform_permission', 'is_platform_owner', 'is_staff']);

const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || f.includes('/__tests__/') || f.startsWith('src/test/');
const inScope = (f) => !!f && f.startsWith('src/') && !isTest(f) && !f.endsWith('.generated.ts') && !f.includes('/generated/');
export const isCapability = (k) => !!k && !FLOOR.has(k) && !k.startsWith('(');
const isViewKey = (k) => /^view_|\.read$/.test(k);

export function analyze({
  ts,
  program,
  root,
  db = null,
  policy = null,
  maxDepth = 12,
  entryDirs = ['src/app/(admin)/', 'src/app/api/admin/'],
  navFile = 'src/components/admin-shell.tsx',
}) {
  const checker = program.getTypeChecker();
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
  const coverage = { callsResolved: 0, callsLibrary: 0, callsUnresolved: 0 };

  const srcFiles = new Map();
  for (const sf of program.getSourceFiles()) {
    const r = rel(sf.fileName);
    if (inScope(r)) srcFiles.set(r, sf);
  }
  const lineOf = (node) => {
    const sf = node.getSourceFile();
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  };
  const where = (node) => `${rel(node.getSourceFile().fileName)}:${lineOf(node)}`;
  const directive = (sf) => {
    const first = sf.statements[0];
    return first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) ? first.expression.text : null;
  };
  const unwrap = (e) => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression;
    return e;
  };
  const stripParens = (e) => {
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    return e;
  };
  const calleeNameNode = (call) => {
    const e = unwrap(call.expression);
    if (ts.isIdentifier(e)) return e;
    if (ts.isPropertyAccessExpression(e)) return e.name;
    return null;
  };
  const literalArg = (call, i) => {
    const a = call.arguments[i];
    if (!a) return null;
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
    return '(dynamic)';
  };

  // The declaration a name resolves to, through imports.
  function declOf(nameNode) {
    let sym = checker.getSymbolAtLocation(nameNode);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym);
      } catch {
        return null;
      }
    }
    const decl = sym.valueDeclaration ?? sym.declarations?.[0] ?? null;
    return { sym, decl, file: decl ? rel(decl.getSourceFile().fileName) : null };
  }
  const defKey = (d) => (d?.file && d.sym ? `${d.file}#${d.sym.name}` : null);

  // The function a declaration stands for: a function, or a const whose value is a function, possibly wrapped
  // (cache(async () => …)).
  function functionOf(decl) {
    if (!decl) return null;
    if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isArrowFunction(decl) || ts.isFunctionExpression(decl)) return decl.body ? decl : null;
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      let init = unwrap(decl.initializer);
      for (let i = 0; i < 3 && init && ts.isCallExpression(init); i++) {
        const fnArg = init.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (fnArg) return fnArg;
        init = init.arguments[0] && unwrap(init.arguments[0]);
      }
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init;
    }
    return null;
  }

  // A function passed as an argument (or called in place) runs from here: it is walked as part of this function.
  function isInlineCallback(fnNode) {
    let n = fnNode;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isArrayLiteralExpression(n.parent) || ts.isSpreadElement(n.parent) || ts.isAsExpression(n.parent))) n = n.parent;
    const p = n.parent;
    return !!p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && ((p.arguments ?? []).includes(n) || p.expression === n);
  }

  // Does `node` run on only some paths of the function whose body is `body`?
  function mayRun(node, body) {
    let child = node;
    for (let p = node.parent; p && p !== body; child = p, p = p.parent) {
      if (ts.isIfStatement(p) && child !== p.expression) return true;
      if (ts.isConditionalExpression(p) && child !== p.condition) return true;
      if (ts.isBinaryExpression(p) && child === p.right && LOGICAL.has(p.operatorToken.kind)) return true;
      if (ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isCatchClause(p)) return true;
      if ((ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p)) && child === p.statement) return true;
      if ((ts.isCallExpression(p) || ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.questionDotToken) return true;
      if (ts.isFunctionLike(p)) return true; // inside a callback: it may run once, many times, later, or never
    }
    return false;
  }
  function rethrows(block) {
    let found = false;
    const v = (n) => {
      if (found || (n !== block && ts.isFunctionLike(n))) return;
      if (ts.isThrowStatement(n)) found = true;
      else if (ts.isCallExpression(n) && ['unstable_rethrow', 'rethrow'].includes(calleeNameNode(n)?.text)) found = true;
      ts.forEachChild(n, v);
    };
    v(block);
    return found;
  }
  function inSwallowingTry(node, body) {
    let child = node;
    for (let p = node.parent; p && p !== body; child = p, p = p.parent) {
      // A catch that rethrows or exits (return / throw / notFound…) still stops the code after the try.
      if (ts.isTryStatement(p) && child === p.tryBlock && p.catchClause && !rethrows(p.catchClause.block) && !exits(p.catchClause.block)) return true;
      if (ts.isFunctionLike(p)) return false;
    }
    return false;
  }
  function awaited(node) {
    for (let child = node, p = node.parent; p; child = p, p = p.parent) {
      if (ts.isAwaitExpression(p) || ts.isReturnStatement(p)) return true;
      if (ts.isArrowFunction(p)) return p.body === child;
      if (ts.isVoidExpression(p) || ts.isExpressionStatement(p) || ts.isVariableStatement(p) || ts.isBlock(p) || ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  }
  function exits(stmt) {
    if (!stmt) return false;
    if (ts.isBlock(stmt)) return stmt.statements.length > 0 && exits(stmt.statements[stmt.statements.length - 1]);
    if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
    if (ts.isExpressionStatement(stmt)) {
      const e = unwrap(stmt.expression);
      return ts.isCallExpression(e) && NEXT_EXITS.has(calleeNameNode(e)?.text);
    }
    return false;
  }
  // The symbol a check's answer is bound to: `const v = await check()`, or element i of `const [a, b] = await
  // Promise.all([check(), …])`.
  function boundSymbol(call) {
    let n = call;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
    if (ts.isVariableDeclaration(n.parent) && n.parent.initializer === n && ts.isIdentifier(n.parent.name)) return checker.getSymbolAtLocation(n.parent.name);
    if (ts.isArrayLiteralExpression(n.parent)) {
      const arr = n.parent;
      const idx = arr.elements.indexOf(n);
      const all = arr.parent;
      if (all && ts.isCallExpression(all) && all.arguments[0] === arr) {
        let m = all;
        while (m.parent && (ts.isParenthesizedExpression(m.parent) || ts.isAwaitExpression(m.parent))) m = m.parent;
        if (ts.isVariableDeclaration(m.parent) && ts.isArrayBindingPattern(m.parent.name)) {
          const el = m.parent.name.elements[idx];
          if (el && ts.isBindingElement(el) && ts.isIdentifier(el.name)) return checker.getSymbolAtLocation(el.name);
        }
      }
    }
    return null;
  }
  // The `if` that turns a check into a guard, or null.
  function guardOf(call, body) {
    let n = call;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
    if (ts.isPrefixUnaryExpression(n.parent) && n.parent.operator === ts.SyntaxKind.ExclamationToken) {
      let m = n.parent;
      while (m.parent && ts.isParenthesizedExpression(m.parent)) m = m.parent;
      if (ts.isIfStatement(m.parent) && m.parent.expression === m && exits(m.parent.thenStatement)) return m.parent;
    }
    const sym = boundSymbol(call);
    if (!sym) return null;
    let found = null;
    const v = (node) => {
      if (found || (node !== body && ts.isFunctionLike(node))) return;
      if (ts.isIfStatement(node) && node.getStart() > call.getEnd() && exits(node.thenStatement)) {
        const cond = stripParens(node.expression);
        if (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken) {
          const operand = stripParens(cond.operand);
          const id = ts.isIdentifier(operand) ? operand : ts.isPropertyAccessExpression(operand) && ts.isIdentifier(operand.expression) ? operand.expression : null;
          if (id && checker.getSymbolAtLocation(id) === sym) {
            found = node;
            return;
          }
        }
      }
      ts.forEachChild(node, v);
    };
    v(body);
    return found;
  }

  // Is this expression a Supabase client? By its type, which names the library's class.
  function isSupabase(expr) {
    try {
      return /SupabaseClient|PostgrestClient/.test(checker.typeToString(checker.getTypeAtLocation(expr)));
    } catch {
      return false;
    }
  }
  function forEachReturn(body, cb) {
    const v = (n) => {
      if (n !== body && ts.isFunctionLike(n)) return;
      if (ts.isReturnStatement(n)) cb(n);
      ts.forEachChild(n, v);
    };
    v(body);
  }
  // Where a client comes from: 'service' | 'cookie' | 'param:i' (the i-th parameter of `fn`) | '?'.
  function originOf(expr, fn, depth = 0) {
    const e = unwrap(expr);
    if (!e || depth > 4) return '?';
    if (ts.isCallExpression(e)) {
      const nn = calleeNameNode(e);
      const d = nn && declOf(nn);
      const k = defKey(d);
      if (k && CLIENT_DEFS.has(k)) return CLIENT_DEFS.get(k);
      const target = d?.decl && inScope(d.file) ? functionOf(d.decl) : null;
      if (target?.body) {
        const outs = new Set();
        if (!ts.isBlock(target.body)) outs.add(originOf(target.body, target, depth + 1));
        else forEachReturn(target.body, (r) => r.expression && outs.add(originOf(r.expression, target, depth + 1)));
        const only = outs.size === 1 ? [...outs][0] : '?';
        return only.startsWith('param:') ? '?' : only;
      }
      return '?';
    }
    if (ts.isIdentifier(e)) {
      const sym = checker.getSymbolAtLocation(e);
      const d = sym?.valueDeclaration ?? sym?.declarations?.[0];
      if (!d) return '?';
      if (ts.isParameter(d)) {
        const i = fn.parameters.indexOf(d);
        return i >= 0 ? `param:${i}` : '?';
      }
      if (ts.isVariableDeclaration(d) && d.initializer) return originOf(d.initializer, fn, depth + 1);
    }
    return '?';
  }

  // The operation a query chain performs, read from the chain, or from a variable it is assigned to.
  function chainOpOf(fromCall, body) {
    let node = fromCall;
    for (let i = 0; i < 24; i++) {
      const p = node.parent;
      if (!p) break;
      if (ts.isPropertyAccessExpression(p) && p.expression === node) {
        if (CHAIN_OPS.has(p.name.text)) return p.name.text;
        node = p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p ? p.parent : p;
        continue;
      }
      if (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p)) {
        node = p;
        continue;
      }
      if (ts.isVariableDeclaration(p) && p.initializer === node && ts.isIdentifier(p.name)) {
        const sym = checker.getSymbolAtLocation(p.name);
        let op = null;
        const v = (n) => {
          if (op) return;
          if (ts.isIdentifier(n) && n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && CHAIN_OPS.has(n.parent.name.text) && checker.getSymbolAtLocation(n) === sym) {
            op = n.parent.name.text;
            return;
          }
          ts.forEachChild(n, v);
        };
        v(body);
        return op;
      }
      break;
    }
    return null;
  }
  const nextMethod = (call) => {
    const p = call.parent;
    return p && ts.isPropertyAccessExpression(p) && p.expression === call ? p.name.text : null;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Facts per function: its events in source order (memoised).
  // ---------------------------------------------------------------------------------------------------------------
  const factsCache = new Map();
  function factsOf(fn) {
    if (factsCache.has(fn)) return factsCache.get(fn);
    const facts = { events: [], checkNames: new Map() }; // symbol a check's answer is bound to → its key
    factsCache.set(fn, facts);
    const body = fn.body;
    if (!body) return facts;
    const sf = fn.getSourceFile();
    const push = (ev) => facts.events.push(ev);

    const onGate = (node, def, defName, may) => {
      const key = def.key ?? literalArg(node, def.keyArg) ?? '(no key)';
      if (def.kind === 'require') {
        const risk = inSwallowingTry(node, body) ? 'inside a try whose catch neither rethrows nor exits' : !awaited(node) ? 'not awaited' : null;
        push({ type: 'gate', key, def: defName, enforce: risk ? 'unenforced' : may ? 'may' : 'must', risk, pos: node.getStart(sf), node });
        return;
      }
      const bound = boundSymbol(node);
      if (bound) facts.checkNames.set(bound, key);
      const guard = guardOf(node, body);
      if (guard) {
        const risk = inSwallowingTry(guard, body) ? 'inside a try whose catch neither rethrows nor exits' : null;
        push({ type: 'gate', key, def: defName, via: 'guard', enforce: risk ? 'unenforced' : mayRun(guard, body) ? 'may' : 'must', risk, pos: guard.getEnd(), node: guard });
      } else {
        push({ type: 'gate', key, def: defName, enforce: 'check', pos: node.getStart(sf), node });
      }
    };

    const onCall = (node) => {
      const may = mayRun(node, body);
      const pos = node.getStart(sf);
      const nn = calleeNameNode(node);
      const d = nn ? declOf(nn) : null;
      const k = defKey(d);
      if (k && GATE_DEFS.has(k)) return onGate(node, GATE_DEFS.get(k), d.sym.name, may);
      if (k && CLIENT_DEFS.has(k)) return; // creating a client is not an operation
      const callee = unwrap(node.expression);
      const recv = ts.isPropertyAccessExpression(callee) ? callee.expression : null;
      const name = nn?.text;
      if (recv && name === 'from') {
        const r = unwrap(recv);
        if (ts.isPropertyAccessExpression(r) && r.name.text === 'storage' && isSupabase(r.expression)) {
          const m = nextMethod(node);
          push({ type: 'op', kind: 'storage', target: literalArg(node, 0) ?? '(dynamic)', op: m ?? '?', write: m ? STORAGE_WRITES.has(m) : null, origin: originOf(r.expression, fn), may, pos, node });
          return;
        }
        if (isSupabase(recv)) {
          const op = chainOpOf(node, body);
          push({ type: 'op', kind: 'table', target: literalArg(node, 0) ?? '(dynamic)', op: op ?? '?', write: op ? TABLE_WRITES.has(op) : null, origin: originOf(recv, fn), may, pos, node });
          return;
        }
      }
      if (recv && name === 'rpc' && isSupabase(recv)) {
        const target = literalArg(node, 0) ?? '(dynamic)';
        if (!GATE_RPCS.has(target)) push({ type: 'op', kind: 'rpc', target, op: 'rpc', write: null, origin: originOf(recv, fn), may, pos, node });
        return;
      }
      if (recv) {
        const r = unwrap(recv);
        if (ts.isPropertyAccessExpression(r) && r.name.text === 'admin' && ts.isPropertyAccessExpression(unwrap(r.expression)) && unwrap(r.expression).name.text === 'auth' && isSupabase(unwrap(r.expression).expression)) {
          push({ type: 'op', kind: 'auth', target: 'auth.users', op: name ?? '?', write: name ? !AUTH_ADMIN_READS.has(name) : null, origin: originOf(unwrap(r.expression).expression, fn), may, pos, node });
          return;
        }
      }
      if (name === 'fetch' && (!d?.file || !inScope(d.file))) {
        push({ type: 'op', kind: 'http', target: literalArg(node, 0) ?? '(dynamic)', op: 'fetch', write: null, origin: 'n/a', may, pos, node });
        return;
      }
      if (!nn || !d || !d.decl) {
        coverage.callsUnresolved++;
        push({ type: 'unresolved', name: nn?.text ?? node.expression.getText(sf).slice(0, 40), may, pos, node });
        return;
      }
      if (!inScope(d.file)) {
        coverage.callsLibrary++;
        return;
      }
      const target = functionOf(d.decl);
      if (!target) {
        // In src, but not a function we can follow (a variable of function type, a method signature).
        if (ts.isVariableDeclaration(d.decl) || ts.isParameter(d.decl)) {
          coverage.callsUnresolved++;
          push({ type: 'unresolved', name: nn.text, may, pos, node });
        }
        return;
      }
      coverage.callsResolved++;
      const argOrigins = node.arguments.map((a) => (isSupabase(a) ? originOf(a, fn) : null));
      push({ type: 'call', target: { fn: target, file: d.file, name: d.sym.name }, argOrigins, may, pos, node });
    };

    const onJsx = (node) => {
      const tag = node.tagName;
      if (!ts.isIdentifier(tag) || !/^[A-Z]/.test(tag.text)) return;
      const d = declOf(tag);
      if (!d?.decl || !inScope(d.file)) return;
      const target = functionOf(d.decl);
      if (!target || directive(target.getSourceFile()) === 'use client') return;
      coverage.callsResolved++;
      push({ type: 'call', target: { fn: target, file: d.file, name: d.sym.name }, argOrigins: [], may: mayRun(node, body), pos: node.getStart(sf), node, jsx: true });
    };

    const visit = (node) => {
      if (node !== body && ts.isFunctionLike(node) && !isInlineCallback(node)) return; // declared here; analysed where it is called
      if (ts.isCallExpression(node)) onCall(node);
      else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) onJsx(node);
      ts.forEachChild(node, visit);
    };
    visit(body);
    facts.events.sort((a, b) => a.pos - b.pos);
    return facts;
  }

  // The keys the conditions ABOVE a node check, in the branch that leads to it: `if (await hasPlatformPermission('k'))`,
  // `canK ? f() : null`, `canK && f()`, where canK is the bound answer of a check of k. A call reached only that way runs
  // only for someone who holds k, so a gate for k inside it is not a refusal part-way.
  function conditionKeys(node, body, facts) {
    const keys = new Set();
    const keysIn = (cond) => {
      const v = (n) => {
        if (ts.isCallExpression(n)) {
          const nn = calleeNameNode(n);
          const d = nn && declOf(nn);
          const def = GATE_DEFS.get(defKey(d) ?? '');
          if (def?.kind === 'check') keys.add(def.key ?? literalArg(n, def.keyArg) ?? '(no key)');
        }
        if (ts.isIdentifier(n)) {
          const k = facts.checkNames.get(checker.getSymbolAtLocation(n));
          if (k) keys.add(k);
        }
        ts.forEachChild(n, v);
      };
      v(cond);
    };
    let child = node;
    for (let p = node.parent; p && p !== body; child = p, p = p.parent) {
      if (ts.isIfStatement(p) && child === p.thenStatement) keysIn(p.expression);
      if (ts.isConditionalExpression(p) && child === p.whenTrue) keysIn(p.condition);
      if (ts.isBinaryExpression(p) && child === p.right && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) keysIn(p.left);
      if (ts.isFunctionLike(p) && p !== body) break;
    }
    return keys;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Paths inside one function: what is guaranteed before each of its events, and when it returns.
  // ---------------------------------------------------------------------------------------------------------------
  // A path is the set of keys checked on it so far. The walk follows the statements: an `if` splits the paths, a
  // `return` ends one and keeps it (a normal exit, the caller goes on), a `throw` or notFound() ends one with nothing
  // after it. What is guaranteed at a point is what every path reaching it has: their common keys, or — when each path
  // checked SOME capability but not the same one — `any(a|b)`: at least one of them was checked on every path
  // (src/lib/data/admin/integrations/provider-numbers.ts requireRolePermission: manage_voice on one branch,
  // manage_settings on the other). A callee's guarantee at its exit joins the caller's paths after the call.
  const MAX_PATHS = 64;
  const expandAny = (k) => (k.startsWith('any(') ? k.slice(4, -1).split('|') : [k]);
  const dedupePaths = (paths) => {
    const m = new Map();
    for (const p of paths) m.set([...p].sort().join(','), p);
    return [...m.values()].slice(0, MAX_PATHS);
  };
  const clonePaths = (paths) => paths.map((p) => new Set(p));
  function summarize(paths) {
    if (!paths.length) return [];
    let inter = new Set(paths[0]);
    for (const p of paths.slice(1)) inter = new Set([...inter].filter((k) => p.has(k)));
    const out = [...inter];
    if (!out.some(isCapability) && paths.every((p) => [...p].some(isCapability))) {
      const caps = new Set(paths.flatMap((p) => [...p].filter(isCapability).flatMap(expandAny)));
      out.push(`any(${[...caps].sort().join('|')})`);
    }
    return out;
  }
  const flowCache = new Map();
  const inFlow = new Set();
  function flowOf(fn) {
    if (flowCache.has(fn)) return flowCache.get(fn);
    if (inFlow.has(fn)) return { at: new Map(), exit: [] }; // recursion: nothing is guaranteed
    inFlow.add(fn);
    const facts = factsOf(fn);
    const at = new Map();
    const guards = new Map(facts.events.filter((e) => e.type === 'gate' && e.via === 'guard').map((e) => [e.node, e]));
    const mayWithin = (n, boundary) => n !== boundary && mayRun(n, boundary);
    const inside = (ev, node) => ev.node.getStart() >= node.getStart() && ev.node.getEnd() <= node.getEnd();
    const processSimple = (node, paths) => {
      for (const ev of facts.events) {
        if (ev.via === 'guard' || !inside(ev, node) || at.has(ev)) continue;
        at.set(ev, summarize(paths));
        if (mayWithin(ev.node, node)) continue;
        if (ev.type === 'gate' && ev.enforce !== 'unenforced' && ev.enforce !== 'check') for (const p of paths) p.add(ev.key);
        if (ev.type === 'call') {
          const ex = flowOf(ev.target.fn).exit;
          for (const p of paths) for (const k of ex) p.add(k);
        }
      }
      return paths;
    };
    const walkList = (statements, paths) => {
      let fall = paths;
      const rets = [];
      for (const st of statements) {
        const r = walk(st, fall);
        fall = r.fall;
        rets.push(...r.rets);
      }
      return { fall, rets };
    };
    function walk(stmt, paths) {
      if (!stmt || !paths.length) return { fall: paths, rets: [] };
      if (ts.isBlock(stmt)) return walkList(stmt.statements, paths);
      if (ts.isIfStatement(stmt)) {
        paths = processSimple(stmt.expression, paths);
        const guard = guards.get(stmt);
        const pass = clonePaths(paths);
        if (guard) {
          at.set(guard, summarize(paths));
          if (guard.enforce !== 'unenforced') for (const p of pass) p.add(guard.key);
        }
        // With a guard, the THEN branch is the refused one and the code after the if is the passing one.
        const t = walk(stmt.thenStatement, guard ? clonePaths(paths) : pass);
        const e = stmt.elseStatement ? walk(stmt.elseStatement, guard ? pass : clonePaths(paths)) : { fall: guard ? pass : clonePaths(paths), rets: [] };
        return { fall: dedupePaths([...t.fall, ...e.fall]), rets: [...t.rets, ...e.rets] };
      }
      if (ts.isReturnStatement(stmt)) return { fall: [], rets: stmt.expression ? processSimple(stmt.expression, paths) : paths };
      if (ts.isThrowStatement(stmt)) {
        if (stmt.expression) processSimple(stmt.expression, paths);
        return { fall: [], rets: [] };
      }
      if (ts.isTryStatement(stmt)) {
        const start = clonePaths(paths);
        const t = walk(stmt.tryBlock, paths);
        let fall = t.fall;
        const rets = [...t.rets];
        if (stmt.catchClause) {
          const c = walk(stmt.catchClause.block, start); // the catch can be entered before anything in the try ran
          fall = dedupePaths([...fall, ...c.fall]);
          rets.push(...c.rets);
        }
        if (stmt.finallyBlock) {
          const f = walk(stmt.finallyBlock, fall);
          fall = f.fall;
          rets.push(...f.rets);
        }
        return { fall, rets };
      }
      if (ts.isForStatement(stmt) || ts.isForOfStatement(stmt) || ts.isForInStatement(stmt) || ts.isWhileStatement(stmt)) {
        const head = ts.isForStatement(stmt) ? [stmt.initializer, stmt.condition].filter(Boolean) : [stmt.expression];
        for (const h of head) paths = processSimple(h, paths);
        const b = walk(stmt.statement, clonePaths(paths)); // the body may run zero times
        return { fall: dedupePaths([...paths, ...b.fall]), rets: b.rets };
      }
      if (ts.isDoStatement(stmt)) {
        const b = walk(stmt.statement, paths);
        return { fall: processSimple(stmt.expression, b.fall), rets: b.rets };
      }
      if (ts.isSwitchStatement(stmt)) {
        paths = processSimple(stmt.expression, paths);
        const fall = [];
        const rets = [];
        let hasDefault = false;
        for (const clause of stmt.caseBlock.clauses) {
          if (ts.isDefaultClause(clause)) hasDefault = true;
          else paths = processSimple(clause.expression, paths);
          const r = walkList(clause.statements, clonePaths(paths));
          fall.push(...r.fall);
          rets.push(...r.rets);
        }
        if (!hasDefault) fall.push(...clonePaths(paths));
        return { fall: dedupePaths(fall), rets };
      }
      if (ts.isLabeledStatement(stmt)) return walk(stmt.statement, paths);
      if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) return { fall: paths, rets: [] };
      processSimple(stmt, paths);
      if (exits(stmt)) return { fall: [], rets: [] }; // notFound() / redirect() …: nothing after it runs
      return { fall: paths, rets: [] };
    }
    const body = fn.body;
    const start = [new Set()];
    const res = ts.isBlock(body) ? walk(body, start) : { fall: [], rets: processSimple(body, start) };
    const out = { at, exit: summarize(dedupePaths([...res.fall, ...res.rets])) };
    flowCache.set(fn, out);
    inFlow.delete(fn);
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Entries.
  // ---------------------------------------------------------------------------------------------------------------
  const routeOf = (file) => {
    const p = file.replace(/^src\/app/, '').split('/').filter((s) => !(s.startsWith('(') && s.endsWith(')'))).join('/');
    return p.replace(/\/(page|layout|route)\.(tsx|ts)$/, '').replace(/\/[^/]+\.(tsx|ts)$/, '') || '/';
  };
  function exportedFunctions(sf) {
    const out = [];
    const has = (n, kind) => n.modifiers?.some((m) => m.kind === kind);
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && has(st, ts.SyntaxKind.ExportKeyword) && st.body) {
        out.push({ name: has(st, ts.SyntaxKind.DefaultKeyword) ? `default (${st.name?.text ?? 'anonymous'})` : st.name.text, fn: st });
      }
      if (ts.isVariableStatement(st) && has(st, ts.SyntaxKind.ExportKeyword)) {
        for (const d of st.declarationList.declarations) {
          const fn = functionOf(d);
          if (fn) out.push({ name: d.name.getText(), fn });
        }
      }
      if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) {
        const d = declOf(st.expression);
        const fn = d && functionOf(d.decl);
        if (fn) out.push({ name: `default (${d.sym.name})`, fn });
      }
      if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause) && !st.moduleSpecifier) {
        for (const el of st.exportClause.elements) {
          const d = declOf(el.propertyName ?? el.name);
          const fn = d && functionOf(d.decl);
          if (fn) out.push({ name: el.name.text, fn });
        }
      }
    }
    return out;
  }

  const entries = [];
  for (const [file, sf] of srcFiles) {
    if (!entryDirs.some((d) => file.startsWith(d))) continue;
    const base = path.posix.basename(file);
    let kind = null;
    if (/^page\.tsx?$/.test(base)) kind = 'page';
    else if (/^layout\.tsx?$/.test(base)) kind = 'layout';
    else if (/^route\.tsx?$/.test(base)) kind = 'route';
    else if (directive(sf) === 'use server') kind = 'action';
    if (!kind) continue;
    let fns = exportedFunctions(sf);
    if (kind === 'page' || kind === 'layout') fns = fns.filter((f) => f.name.startsWith('default'));
    if (kind === 'route') fns = fns.filter((f) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(f.name));
    for (const f of fns) entries.push({ file, kind, route: routeOf(file), name: f.name, fn: f.fn, id: `${routeOf(file)} · ${kind} ${f.name}` });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Walking one entry: what is proven before each operation, on its path.
  // ---------------------------------------------------------------------------------------------------------------
  function traverse(entry) {
    const out = { ops: [], gates: [], unresolved: [], truncated: [], reached: new Map() };
    const memo = new Set();
    const visit = (fn, file, name, ctx) => {
      const mk = [fn.pos, fn.end, file, [...ctx.proven].sort().join(','), ctx.may, ctx.unresolvedBefore, ctx.params.join(','), [...ctx.condKeys].sort().join(',')].join('|');
      if (memo.has(mk)) return;
      memo.add(mk);
      const prev = out.reached.get(fn);
      out.reached.set(fn, {
        file, name,
        depth: Math.min(prev?.depth ?? Infinity, ctx.depth),
        may: prev ? prev.may && ctx.may : ctx.may,
        provenOnEntry: prev ? prev.provenOnEntry : [...ctx.proven],
      });
      const flow = flowOf(fn);
      let unresolvedBefore = ctx.unresolvedBefore;
      const frame = (node) => `${where(node)} ${name}`;
      for (const ev of factsOf(fn).events) {
        const may = ctx.may || ev.may;
        const proven = [...new Set([...ctx.proven, ...(flow.at.get(ev) ?? [])])];
        if (ev.type === 'gate') {
          out.gates.push({ key: ev.key, def: ev.def, via: ev.via ?? null, enforce: ev.enforce, risk: ev.risk ?? null, depth: ctx.depth, fnName: name, file, may: ctx.may || ev.enforce !== 'must', pathMay: ctx.may, condKeys: [...ctx.condKeys], location: where(ev.node), chain: [...ctx.chain, frame(ev.node)] });
        } else if (ev.type === 'op') {
          let origin = ev.origin;
          if (origin.startsWith('param:')) origin = ctx.params[Number(origin.slice(6))] ?? '?';
          out.ops.push({ kind: ev.kind, target: ev.target, op: ev.op, write: ev.write, origin, may, proven, unresolvedBefore, fnName: name, file, location: where(ev.node), chain: [...ctx.chain, frame(ev.node)] });
        } else if (ev.type === 'unresolved') {
          out.unresolved.push({ name: ev.name, location: where(ev.node), chain: [...ctx.chain, frame(ev.node)] });
          unresolvedBefore = true;
        } else if (ev.type === 'call') {
          if (ctx.depth + 1 > maxDepth) {
            out.truncated.push({ target: ev.target.name, location: where(ev.node), chain: [...ctx.chain, frame(ev.node)] });
            unresolvedBefore = true;
            continue;
          }
          const params = ev.argOrigins.map((o) => (o?.startsWith('param:') ? ctx.params[Number(o.slice(6))] ?? '?' : o ?? '?'));
          const condKeys = new Set([...ctx.condKeys, ...(ev.may ? conditionKeys(ev.node, fn.body, factsOf(fn)) : [])]);
          visit(ev.target.fn, ev.target.file, ev.target.name, { depth: ctx.depth + 1, may, proven: new Set(proven), unresolvedBefore, params, condKeys, chain: [...ctx.chain, frame(ev.node)] });
        }
      }
    };
    visit(entry.fn, entry.file, entry.name, { depth: 0, may: false, proven: new Set(), unresolvedBefore: false, params: [], condKeys: new Set(), chain: [] });
    out.exit = new Set(flowOf(entry.fn).exit);
    return out;
  }

  for (const e of entries) Object.assign(e, traverse(e));
  const layouts = entries.filter((e) => e.kind === 'layout');
  for (const e of entries) {
    e.caps = [...e.exit].filter(isCapability);
    e.floors = [...e.exit].filter((k) => FLOOR.has(k));
    e.direct = [...new Set(e.gates.filter((g) => g.depth === 0 && g.enforce === 'must' && isCapability(g.key)).map((g) => g.key))];
    e.inherited = [];
    if (e.kind === 'page' || e.kind === 'layout') {
      const dir = path.posix.dirname(e.file);
      for (const l of layouts) {
        const ld = path.posix.dirname(l.file);
        if (l !== e && (dir === ld || dir.startsWith(`${ld}/`))) e.inherited.push(...l.exit);
      }
      e.inherited = [...new Set(e.inherited)];
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The admin menu.
  // ---------------------------------------------------------------------------------------------------------------
  const nav = [];
  const navSf = srcFiles.get(navFile);
  if (navSf) {
    const v = (n) => {
      if (ts.isObjectLiteralExpression(n)) {
        const prop = (k) => n.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === k);
        const href = prop('href');
        const perm = prop('permission');
        const label = prop('label');
        if (href && ts.isStringLiteral(href.initializer)) {
          nav.push({
            href: href.initializer.text,
            label: label && ts.isStringLiteral(label.initializer) ? label.initializer.text : '',
            permission: perm && ts.isStringLiteral(perm.initializer) ? perm.initializer.text : null,
            location: where(n),
          });
        }
      }
      ts.forEachChild(n, v);
    };
    v(navSf);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Findings.
  // ---------------------------------------------------------------------------------------------------------------
  const findings = [];
  const add = (f) => findings.push({ severity: 'normal', chain: [], found: [], expected: null, ...f });
  const catalog = db?.catalog ?? null;
  const catalogKey = (k) => catalog?.find((c) => c.key === k) ?? null;
  const viewTwin = (k) => {
    if (!isCapability(k) || isViewKey(k) || k === 'OWNER') return null;
    const base = k.replace(/^manage_/, '');
    const name = `view_${base}`;
    if (!catalog) return k.startsWith('manage_') ? name : null;
    const own = catalogKey(k);
    const twin = catalog.find((c) => c.key === name && (!own || c.category === own.category));
    return twin?.key ?? null;
  };
  // An RPC's effect, from the function's declared volatility: VOLATILE may write, STABLE / IMMUTABLE cannot.
  const rpcEffect = (target) => {
    const v = db?.fns?.get(target)?.volatility;
    return v === 'v' ? 'volatile' : v === 's' || v === 'i' ? 'read' : null;
  };
  const writeOf = (op) => (op.kind === 'rpc' ? (rpcEffect(op.target) === 'read' ? false : rpcEffect(op.target) === 'volatile' ? true : null) : op.write);
  // A table the admin code only ever inserts into (an audit log, an alert log): an insert there records, it changes
  // nothing. Measured over every operation the admin entries reach — a table updated only by the worker still counts
  // as append-only here.
  const appendOnly = new Set();
  {
    const opsByTable = new Map();
    for (const e of entries) for (const op of e.ops) if (op.kind === 'table' && op.op !== 'select') (opsByTable.get(op.target) ?? opsByTable.set(op.target, new Set()).get(op.target)).add(op.op);
    for (const [t, ops] of opsByTable) if (ops.size === 1 && ops.has('insert')) appendOnly.add(t);
  }

  for (const e of entries) {
    if (e.kind === 'layout') continue;
    const seen = new Set();
    for (const op of e.ops) {
      const write = writeOf(op);
      const sensitive = write !== false || op.origin === 'service';
      if (!sensitive || op.kind === 'http') continue;
      const caps = op.proven.filter(isCapability);
      const dedupe = `${op.location}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const what = `${op.kind} ${op.target}.${op.op}${write === null ? ' (effect unknown)' : write ? ' (write)' : ' (read)'} via ${op.origin === 'service' ? 'service role' : op.origin === 'cookie' ? 'cookie client' : 'unknown client'}`;
      if (caps.length === 0) {
        const elsewhere = [...new Set(e.gates.filter((g) => isCapability(g.key)).map((g) => `${g.key} (${g.enforce}${g.risk ? `: ${g.risk}` : ''}, ${g.location})`))];
        const tail = elsewhere.length ? ` Gates on this path that do NOT run before it on every path: ${elsewhere.join('; ')}.` : '';
        const floors = op.proven.filter((k) => FLOOR.has(k));
        const dbKeys = op.kind === 'rpc' ? [...new Set(db?.fns?.get(op.target)?.keys ?? [])] : [];
        if (dbKeys.length) {
          add({ state: 'REVIEW', rule: 'V9 protected inside the database function only', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: dbKeys, text: `${what}: no capability is checked in the code before it; the function ${op.target} checks ${dbKeys.join(' / ')} inside the database${db.fns.get(op.target).definer ? ' (SECURITY DEFINER)' : ''}.${tail}` });
        } else if (op.unresolvedBefore) {
          add({ state: 'UNRESOLVED', rule: 'U1 unresolved call before an operation', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: floors, text: `${what}: no capability is proven before it, and a call the scan could not follow runs before it.${tail}` });
        } else if (op.origin === '?' && write !== false) {
          add({ state: 'UNRESOLVED', rule: 'U2 unknown client', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: floors, text: `${what}: no capability is proven before it, and the client's source could not be traced (RLS may or may not apply).${tail}` });
        } else if (op.origin === 'cookie') {
          add({ state: 'REVIEW', rule: 'V7 protected by RLS only', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: floors, text: `${what}: no capability is checked in the code before it; only the table's RLS policies decide${db ? '' : ' (run with --db to see them)'}.${tail}` });
        } else if (floors.includes('STAFF') || floors.includes('CONSOLE_AGENT')) {
          add({ state: 'REVIEW', rule: 'V1 staff floor only', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: floors, text: `${what}: only ${floors.join(' + ')} runs before it — any staff member can reach it.${tail}` });
        } else {
          add({ state: 'MISMATCH', rule: 'M1 no gate before the operation', severity: 'critical', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: floors, text: `${what}: nothing that checks a capability runs before it.${tail}` });
        }
        continue;
      }
      if (write === true && caps.every(isViewKey) && !(op.kind === 'table' && op.op === 'insert' && appendOnly.has(op.target))) {
        add({ state: 'REVIEW', rule: 'V8 write behind only a view key', severity: 'high', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: caps, text: `${what}: the only capability before it is ${caps.join(' + ')}, a view key. Whether this role should change it is a business decision.` });
      } else if (write === null && caps.every(isViewKey)) {
        add({ state: 'UNRESOLVED', rule: 'U3 unknown effect under a view key', entry: e.id, location: op.location, fn: op.fnName, chain: op.chain, found: caps, text: `${what}: may write, behind only ${caps.join(' + ')}${op.kind === 'rpc' && !db ? ' (run with --db to read the function\'s volatility)' : ''}.` });
      }
    }
    // A gate that is there but may not enforce.
    for (const g of e.gates) {
      if (g.enforce === 'unenforced') add({ state: 'UNRESOLVED', rule: 'U4 gate that may not enforce', entry: e.id, location: g.location, fn: g.fnName, chain: g.chain, found: [g.key], text: `${g.def}(${g.key}) is ${g.risk}: it may not stop anything.` });
      if (g.key === '(dynamic)' || g.key === '(no key)') add({ state: 'UNRESOLVED', rule: 'U5 dynamic key', entry: e.id, location: g.location, fn: g.fnName, chain: g.chain, text: `${g.def} is called with a key that is not a literal.` });
    }
    for (const t of e.truncated) add({ state: 'UNRESOLVED', rule: 'U6 path cut off', entry: e.id, location: t.location, chain: t.chain, text: `the path into ${t.target} is deeper than ${maxDepth} calls and was not followed; a gate or an operation may be past it.` });
    // M2: the entry checks one key, code it always reaches requires another.
    // The owner role holds every key (has_platform_permission), so an entry gated on OWNER is never refused deeper.
    const deeper = e.caps.filter((k) => !e.direct.includes(k));
    if (e.direct.length && !e.direct.includes('OWNER') && deeper.length) {
      const g = e.gates.find((x) => deeper.includes(x.key) && x.enforce === 'must' && x.depth > 0);
      add({ state: 'MISMATCH', rule: 'M2 entry key ≠ data-layer key', severity: 'high', entry: e.id, location: g?.location ?? '', fn: g?.fnName, chain: g?.chain ?? [], found: e.direct, expected: deeper.join(' + '), text: `the entry checks ${e.direct.join(' + ')}, and code it always reaches also requires ${deeper.join(' + ')}: a role with only the first is refused part-way.` });
    }
    // M2b: on SOME paths, code the entry reaches requires another key — and the path is not chosen by a check of that
    // key (src/lib/data/event-cancellation.ts: approving a package cancellation, behind manage_billing, closes the
    // campaign through code that requires campaigns.runstate, after the refund ran).
    if (e.direct.length && !e.direct.includes('OWNER')) {
      const seenKey = new Set();
      for (const g of e.gates) {
        if (g.depth === 0 || !g.pathMay || g.enforce === 'check' || g.enforce === 'unenforced' || !isCapability(g.key) || g.key === 'OWNER') continue;
        if (e.direct.includes(g.key) || e.caps.includes(g.key) || g.condKeys.includes(g.key) || g.condKeys.includes('OWNER') || seenKey.has(g.key)) continue;
        if (g.enforce !== 'must') continue; // a branch inside a helper (one key per branch) is judged by its caller's argument, which the scan does not read
        seenKey.add(g.key);
        add({ state: 'MISMATCH', rule: 'M2b entry key ≠ data-layer key on some paths', severity: 'high', entry: e.id, location: g.location, fn: g.fnName, chain: g.chain, found: e.direct, expected: g.key, text: `the entry checks ${e.direct.join(' + ')}; on some paths it reaches code that requires ${g.key}, and that path is not chosen by a check of ${g.key}: a role with only the first is refused part-way there.` });
      }
    }
    // V2: a page that only reads, behind a manage key whose view twin exists.
    if (catalog && e.kind === 'page' && e.ops.length && e.ops.every((op) => writeOf(op) === false)) {
      for (const k of e.caps) {
        const twin = viewTwin(k);
        if (twin) add({ state: 'REVIEW', rule: 'V2 read-only candidate behind a manage key', entry: e.id, location: e.ops[0].location, found: [k], expected: twin, text: `every operation the scan found is a read, behind ${k}; the view key ${twin} exists. A read-only CANDIDATE: an operation the scan cannot see would change this.` });
      }
    }
  }

  // M4: the menu shows a link under one key, the page enforces another.
  for (const item of nav) {
    const page = entries.find((e) => e.kind === 'page' && e.route === item.href);
    if (!page) continue;
    const need = page.caps;
    if (item.permission === 'OWNER') continue;
    if (need.length && !item.permission) add({ state: 'MISMATCH', rule: 'M4 menu key ≠ page key', entry: page.id, location: item.location, found: ['(any staff)'], expected: need.join(' + '), text: `the menu shows "${item.label}" to every staff member, but the page requires ${need.join(' + ')}.` });
    else if (need.length && item.permission && !need.includes(item.permission)) add({ state: 'MISMATCH', rule: 'M4 menu key ≠ page key', entry: page.id, location: item.location, found: [item.permission], expected: need.join(' + '), text: `the menu shows "${item.label}" for ${item.permission}, but the page requires ${need.join(' + ')}.` });
    else if (!need.length && item.permission) add({ state: 'REVIEW', rule: 'V3 menu key, page proves none', entry: page.id, location: item.location, found: [], expected: item.permission, text: `the menu shows "${item.label}" for ${item.permission}, but no capability is proven on the page's own path (its layouts are not counted).` });
  }

  // V4: one table written under several keys.
  {
    const byTable = new Map();
    for (const e of entries) for (const op of e.ops) {
      if (op.kind !== 'table' || writeOf(op) !== true || appendOnly.has(op.target)) continue;
      const m = byTable.get(op.target) ?? new Map();
      for (const k of op.proven.filter(isCapability).filter((x) => x !== 'OWNER')) (m.get(k) ?? m.set(k, new Set()).get(k)).add(`${e.id} (${op.location})`);
      byTable.set(op.target, m);
    }
    for (const [table, keys] of byTable) {
      if (keys.size > 1) add({ state: 'REVIEW', rule: 'V4 one table written under several keys', entry: table, location: '', found: [...keys.keys()], text: [...keys].map(([k, w]) => `${k}: ${[...w].join('; ')}`).join(' | ') });
    }
  }

  // M5 / V5: the code's keys against the catalog. M6 / V6: RLS behind cookie-client operations.
  if (catalog) {
    const known = new Set(catalog.map((c) => c.key));
    const inCode = new Set(entries.flatMap((e) => e.gates.map((g) => g.key)).filter(isCapability).filter((k) => k !== 'OWNER'));
    for (const k of inCode) if (!known.has(k)) add({ state: 'MISMATCH', rule: 'M5 key not in the catalog', severity: 'high', entry: k, location: entries.flatMap((e) => e.gates).find((g) => g.key === k)?.location ?? '', found: [k], text: 'the code checks a key the database does not define: only the owner can ever pass it.' });
    for (const c of catalog) if (!inCode.has(c.key)) add({ state: 'REVIEW', rule: 'V5 key no admin entry checks', entry: c.key, location: '', found: [], text: `granted to ${c.roles.join(', ') || 'no role'}, but no admin entry checks it.` });
  }
  if (db?.rls) {
    const CMD = { select: 'SELECT', insert: 'INSERT', update: 'UPDATE', upsert: 'INSERT', delete: 'DELETE' };
    for (const e of entries) for (const op of e.ops) {
      if (op.kind !== 'table' || op.origin !== 'cookie') continue;
      const r = db.rls.get(op.target);
      const pols = (db.policies.get(op.target) ?? []).filter((p) => p.cmd === 'ALL' || p.cmd === CMD[op.op]);
      const forUs = pols.filter((p) => /authenticated|public/.test(p.roles));
      if (r && !r.rls) add({ state: 'MISMATCH', rule: 'M6 cookie client on a table without RLS', severity: 'critical', entry: e.id, location: op.location, chain: op.chain, text: `${op.target}.${op.op} through the cookie client, and RLS is OFF on ${op.target}.` });
      else if (r && !forUs.some((p) => p.permissive === 'PERMISSIVE')) add({ state: 'MISMATCH', rule: 'M6 cookie client, no permissive policy', entry: e.id, location: op.location, chain: op.chain, text: `${op.target}.${op.op} through the cookie client, but no PERMISSIVE policy for ${CMD[op.op] ?? op.op} applies to authenticated: it is refused or returns nothing.` });
      else if (forUs.length) {
        const polKeys = [...new Set(forUs.flatMap((p) => p.keys))].filter(isCapability).filter((k) => k !== 'OWNER');
        // The owner holds every key; an any(…) guarantee is compared by its members.
        const caps = op.proven.filter(isCapability).flatMap(expandAny);
        if (polKeys.length && caps.length && !caps.includes('OWNER') && !polKeys.some((k) => caps.includes(k))) {
          add({ state: 'REVIEW', rule: 'V6 app key and RLS key differ (possible dependency)', entry: e.id, location: op.location, chain: op.chain, found: caps, expected: polKeys.join(' / '), text: `${op.target}.${op.op}: the app proves ${caps.join(' + ')}; the policies that may apply check ${forUs.map((p) => `${p.name} (${p.permissive}, ${p.roles}: ${p.keys.join('/') || 'no key'})`).join('; ')}. Not evaluated: how PERMISSIVE and RESTRICTIVE combine, USING vs WITH CHECK — test in the database.` });
        }
      }
    }
  }

  // P: the policy file, the only source of the RIGHT key.
  if (policy) {
    const fnIndex = new Map(); // file#name → { own caps, provenOnEntry, entries }
    for (const e of entries) for (const [fn, r] of e.reached) {
      const key = `${r.file}#${r.name}`;
      const own = flowOf(fn).exit.filter(isCapability);
      const cur = fnIndex.get(key) ?? { own, onEntry: new Set(), entries: new Set(), location: where(fn) };
      for (const k of r.provenOnEntry.filter(isCapability)) cur.onEntry.add(k);
      cur.entries.add(e.id);
      fnIndex.set(key, cur);
    }
    for (const [key, expected] of Object.entries(policy.functions ?? {})) {
      const f = fnIndex.get(key);
      if (!f) {
        add({ state: 'UNRESOLVED', rule: 'P0 policy names a function no entry reaches', entry: key, location: '', expected, text: 'the policy names it, but no admin entry reaches it (renamed, moved, or unreached).' });
        continue;
      }
      const actual = f.own.length ? f.own : [...f.onEntry];
      if (actual.includes(expected)) add({ state: 'PROVEN', rule: 'P1 policy satisfied', entry: key, location: f.location, found: actual, expected, text: `requires ${expected}${f.own.length ? '' : ' (proven by its callers)'}.` });
      else add({ state: 'MISMATCH', rule: 'P2 policy violated', severity: 'high', entry: key, location: f.location, found: actual, expected, text: `requires ${actual.join(' + ') || 'no capability'}; the policy says ${expected}. Reached from ${[...f.entries].join('; ')}.` });
    }
    for (const [route, expected] of Object.entries(policy.routes ?? {})) {
      const page = entries.find((e) => e.kind === 'page' && e.route === route);
      if (!page) {
        add({ state: 'UNRESOLVED', rule: 'P0 policy names a route with no page', entry: route, location: '', expected, text: 'no page.tsx for this route.' });
        continue;
      }
      if (page.caps.includes(expected)) add({ state: 'PROVEN', rule: 'P1 policy satisfied', entry: page.id, location: page.file, found: page.caps, expected, text: `the page proves ${expected}.` });
      else add({ state: 'MISMATCH', rule: 'P2 policy violated', severity: 'high', entry: page.id, location: page.file, found: page.caps, expected, text: `the page proves ${page.caps.join(' + ') || 'no capability'}; the policy says ${expected}.` });
    }
  }

  // PROVEN (gated): an entry whose every sensitive operation is behind a capability, with nothing else against it.
  const flagged = new Set(findings.filter((f) => f.state !== 'PROVEN').map((f) => f.entry));
  for (const e of entries) {
    if (e.kind === 'layout' || flagged.has(e.id)) continue;
    const sensitive = e.ops.filter((op) => op.kind !== 'http' && (writeOf(op) !== false || op.origin === 'service'));
    if (!sensitive.length) continue;
    const keys = [...new Set(sensitive.flatMap((op) => op.proven.filter(isCapability)))];
    add({ state: 'PROVEN', rule: 'P3 gated', entry: e.id, location: e.file, found: keys, text: `${sensitive.length} sensitive operation(s), each behind ${keys.join(' / ')} before it.${policy ? '' : ' Whether that is the right key: --policy.'}` });
  }

  const order = (s) => STATES.indexOf(s);
  const sev = { critical: 0, high: 1, normal: 2 };
  findings.sort((a, b) => order(a.state) - order(b.state) || (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3) || a.rule.localeCompare(b.rule) || a.entry.localeCompare(b.entry));

  const opsAll = entries.flatMap((e) => e.ops);
  return {
    entries,
    nav,
    findings,
    coverage: {
      ...coverage,
      entries: entries.length,
      truncatedPaths: entries.reduce((n, e) => n + e.truncated.length, 0),
      unresolvedCallSites: entries.reduce((n, e) => n + e.unresolved.length, 0),
      operations: opsAll.length,
      operationsUnknownClient: opsAll.filter((o) => o.origin === '?').length,
      operationsUnknownEffect: opsAll.filter((o) => writeOf(o) === null).length,
    },
    maxDepth,
    appendOnly: [...appendOnly].sort(),
    readOnlyCandidatesChecked: !!catalog,
  };
}
