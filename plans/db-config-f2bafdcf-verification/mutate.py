#!/usr/bin/env python3
"""Mutation verification of the DB-config protection (27 mutants). See README.md.

Runs ONLY in an isolated copy of the repository, never in the working tree:
  W=<copy> OUT=<evidence dir> GUARD=<abs path to guard.cjs> python3 mutate.py [MUTANT_ID ...]

Per mutant: sha256 before -> apply (pattern must match exactly once; the worker sites exactly
three times) -> vitest with a JSON reporter (full stdout/stderr/exit code kept) -> classify
(load failure vs assertion failure, and whether the EXPECTED test is among the failures) ->
restore -> sha256 after == before -> verification run passes. No secrets (env -i), network
blocked except loopback, no database.
"""
import hashlib, json, os, re, subprocess, sys, time

W = os.environ['W']                      # isolated copy
OUT = os.environ['OUT']                  # evidence directory
GUARD = os.environ['GUARD']              # network-blocking preload
TESTS = ['src/lib/relocation/env-validation.test.ts', 'src/lib/queue/web-sender.test.ts',
         'src/instrumentation.test.ts', 'src/lib/relocation/worker-db-sites.test.ts',
         'src/lib/queue/session-slots.test.ts']
EV, WS, OA, WK, IN = ('src/lib/relocation/env-validation.ts', 'src/lib/queue/web-sender.ts',
                      'src/lib/owner-agent/consumer/main.ts', 'worker/main.ts', 'src/instrumentation.ts')
OLDPORT = 'port: Number(process.env.SUPABASE_DB_PORT || 5432),'
SITE = 'port: supabaseDbPort(process.env),'

# (id, title, file, old, new, nth occurrence or None, expected detecting test (substring of fullName))
M = [
 # ── B: the eight original mutants ──
 ('B1', 'pooler host matched by substring', EV,
  'return labels.length >= 3 && labels.slice(-3).join(".") === "pooler.supabase.com";',
  'return h.includes("pooler.supabase.com");', None, 'recognises pooler hosts on label boundaries only'),
 ('B2', '54322 added to the allowed ports', EV,
  'export const SUPABASE_POOLER_PORTS: readonly number[] = [5432, 6543];',
  'export const SUPABASE_POOLER_PORTS: readonly number[] = [5432, 6543, 54322];', None,
  '54322 (the incident) and every other port fail'),
 ('B3', 'rule applied outside production', EV,
  'if (env.NODE_ENV !== "production" || !isSupabasePoolerHost', 'if (!isSupabasePoolerHost', None,
  'development, test and non-pooler hosts keep the existing behaviour'),
 ('B4', 'probe connects before the rule (check removed)', EV, '  if (!target.ok) return target;\n', '', None,
  'refuses the target without opening a connection'),
 ('B5', 'refusal message leaks the host', EV,
  '`SUPABASE_DB_PORT=${shown} with a Supabase pooler host in production; `',
  '`SUPABASE_DB_PORT=${shown} with ${env.SUPABASE_DB_HOST} in production; `', None,
  'message carries no host, user, password or connection string'),
 ('B6', 'web-sender bypasses supabaseDbPort (old port expression) [= C-W1]', WS,
  'port: supabaseDbPort(env),', 'port: Number(env.SUPABASE_DB_PORT || 5432),', None,
  'is a rejection before any PgBoss exists'),
 ('B7', 'web-sender throws synchronously (options outside the promise chain)', WS,
  'sender ??= Promise.resolve()\n    .then(() => createWebJobSender(webSenderOptions()))\n    .catch(',
  'sender ??= createWebJobSender(webSenderOptions())\n    .catch(', None,
  'is a rejection before any PgBoss exists'),
 ('B8', 'owner-agent bypasses supabaseDbPort', OA, SITE, OLDPORT, None,
  'every source connection site takes its port through supabaseDbPort'),
 # ── C: effectiveDbPort ──
 ('C1', 'supabaseDbPort returns the OLD port computation', EV,
  '  if (!outcome.ok) throw new DbConfigError(outcome.reason);\n  return effectiveDbPort(env.SUPABASE_DB_PORT);',
  '  if (!outcome.ok) throw new DbConfigError(outcome.reason);\n  return Number(env.SUPABASE_DB_PORT || DEFAULT_DB_PORT);', None,
  'whitespace around SUPABASE_DB_PORT is normalised ONCE'),
 ('C2', 'whitespace-only becomes 0 (old normalisation inside effectiveDbPort)', EV,
  '  const v = (raw ?? "").trim();\n  if (v === "") return DEFAULT_DB_PORT;\n  return /^\\d+$/.test(v) ? Number(v) : Number.NaN;',
  '  return Number(raw || DEFAULT_DB_PORT);', None, 'whitespace around SUPABASE_DB_PORT is normalised ONCE'),
 ('C3', 'un-normalised port returned after validation', EV,
  '  if (!outcome.ok) throw new DbConfigError(outcome.reason);\n  return effectiveDbPort(env.SUPABASE_DB_PORT);',
  '  if (!outcome.ok) throw new DbConfigError(outcome.reason);\n  return Number(env.SUPABASE_DB_PORT);', None,
  'whitespace around SUPABASE_DB_PORT is normalised ONCE'),
 ('C4', 'probe connects to a port other than the one validated (old probe expression)', EV,
  'port: effectiveDbPort(env.SUPABASE_DB_PORT), // the value the rule above judged',
  'port: Number(env.SUPABASE_DB_PORT ?? "5432"),', None, 'connects to the same normalised port the rule judged'),
 # ── P: probeSupabaseDb ──
 ('P1', 'old NODE_ENV spread order {NODE_ENV: process, ...env}', EV,
  '  const nodeEnv = process.env.NODE_ENV === "production" ? "production" : env.NODE_ENV;\n  const target = checkSupabaseDbTarget({ ...env, NODE_ENV: nodeEnv });',
  '  const target = checkSupabaseDbTarget({ NODE_ENV: process.env.NODE_ENV, ...env });', None,
  'cannot switch the production rule off'),
 ('P2', 'map NODE_ENV=development weakens production', EV,
  'const nodeEnv = process.env.NODE_ENV === "production" ? "production" : env.NODE_ENV;',
  'const nodeEnv = env.NODE_ENV === "development" ? "development" : process.env.NODE_ENV === "production" ? "production" : env.NODE_ENV;',
  None, 'cannot switch the production rule off'),
 ('P3', 'map NODE_ENV=test weakens production', EV,
  'const nodeEnv = process.env.NODE_ENV === "production" ? "production" : env.NODE_ENV;',
  'const nodeEnv = env.NODE_ENV === "test" ? "test" : process.env.NODE_ENV === "production" ? "production" : env.NODE_ENV;',
  None, 'cannot switch the production rule off'),
 ('P4', 'probe connects to a fixed port, not the validated one', EV,
  'port: effectiveDbPort(env.SUPABASE_DB_PORT), // the value the rule above judged',
  'port: DEFAULT_DB_PORT,', None, 'connects to the same normalised port the rule judged'),
 # ── D: instrumentation register() ──
 ('D1', 'NEXT_RUNTIME === "nodejs" guard removed', IN,
  "  if (process.env.NEXT_RUNTIME !== 'nodejs') return;\n", '', None, 'does nothing outside the Node.js server runtime'),
 ('D2', 'run-once flag removed', IN,
  '  if (flags[DB_CONFIG_CHECKED]) return;\n', '', None, 'runs once per process'),
 ('D3', 'checkSupabaseDbTarget not consulted', IN,
  '    const outcome = checkSupabaseDbTarget(process.env);',
  '    void checkSupabaseDbTarget;\n    const outcome = { ok: true as const } as ReturnType<typeof checkSupabaseDbTarget>;', None,
  'a refused target is logged and alerted once'),
 ('D4', 'failure log suppressed', IN,
  '    console.error(\n      `[db-config] startup check FAILED',
  '    void (() => undefined)(\n      `[db-config] startup check FAILED', None, 'a refused target is logged and alerted once'),
 ('D5', 'sendSlackAlert call removed', IN,
  '      .then(({ sendSlackAlert }) =>\n        sendSlackAlert({',
  '      .then(({ sendSlackAlert }) =>\n        void sendSlackAlert && ({', None, 'a refused target is logged and alerted once'),
 ('D6', 'alert awaited (delays register)', IN,
  "    void import('@/lib/alerts/slack')", "    await import('@/lib/alerts/slack')", None,
  'the alert is fired, not awaited'),
 ('D7', 'register throws when the check fails', IN,
  "    console.error(\n      `[db-config] startup check FAILED",
  "    throw new Error('db-config refused');\n    console.error(\n      `[db-config] startup check FAILED", None,
  'a refused target is logged and alerted once'),
 ('D8', 'register opens a database client', IN,
  '  flags[DB_CONFIG_CHECKED] = true;\n',
  "  flags[DB_CONFIG_CHECKED] = true;\n  { const { Client } = await import('pg'); new Client({}); }\n", None,
  'a valid target logs one clear pass line'),
 # ── E: the three worker connection sites, one at a time ──
 ('E1', 'worker withCallbackSchedulingLock: old port expression', WK, SITE, OLDPORT, 1,
  'withCallbackSchedulingLock: PgClient'),
 ('E2', 'worker startCallbackWorkListener (LISTEN): old port expression', WK, SITE, OLDPORT, 2,
  'startCallbackWorkListener: PgClient'),
 ('E3', 'worker main (PgBoss): old port expression', WK, SITE, OLDPORT, 3, 'main: PgBoss'),
]

def sha(path): return hashlib.sha256(open(os.path.join(W, path), 'rb').read()).hexdigest()

def run(tag):
    d = os.path.join(OUT, tag); os.makedirs(d, exist_ok=True)
    env = {'PATH': '/usr/bin:/bin', 'HOME': W, 'NODE_OPTIONS': f'--require {GUARD}', 'NET_LOG': os.path.join(d, 'net.log')}
    open(env['NET_LOG'], 'w').close()
    t0 = time.time()
    r = subprocess.run(['./node_modules/.bin/vitest', 'run', *TESTS, '--reporter=default', '--reporter=json',
                        f'--outputFile.json={d}/result.json'], cwd=W, env=env, capture_output=True, text=True, timeout=600)
    open(f'{d}/stdout.txt', 'w').write(r.stdout); open(f'{d}/stderr.txt', 'w').write(r.stderr)
    open(f'{d}/exit_code.txt', 'w').write(str(r.returncode))
    res = json.load(open(f'{d}/result.json')) if os.path.exists(f'{d}/result.json') else None
    failed, load = [], []
    if res:
        for f in res['testResults']:
            fa = [a for a in f['assertionResults'] if a['status'] == 'failed']
            if f['status'] == 'failed' and not fa:
                load.append({'file': os.path.relpath(f['name'], W), 'message': (f.get('message') or '')[:400]})
            for a in fa:
                msg = (a['failureMessages'] or [''])[0]
                first = next((l.strip() for l in msg.splitlines() if l.strip()), '')
                failed.append({'file': os.path.relpath(f['name'], W), 'test': a['fullName'], 'assertion': first[:300],
                               'is_assertion': bool(re.search(r'AssertionError|expected', msg))})
    net = [l for l in open(env['NET_LOG']).read().splitlines() if l]
    return {'exit': r.returncode, 'seconds': round(time.time() - t0, 1), 'failed': failed, 'load_failures': load,
            'net_blocked': net, 'total': res['numTotalTests'] if res else None,
            'passed': res['numPassedTests'] if res else None}

def apply(text, old, new, nth):
    if nth is None:
        assert text.count(old) == 1, f'pattern count {text.count(old)}'
        return text.replace(old, new, 1)
    idx = -1
    for _ in range(nth):
        idx = text.index(old, idx + 1)
    assert text.count(old) == 3, f'worker site count {text.count(old)}'
    return text[:idx] + new + text[idx + len(old):]

report = {'baseline': run('00-baseline'), 'mutants': []}
assert report['baseline']['exit'] == 0 and not report['baseline']['failed'], 'baseline not green'
only = set(sys.argv[1:])
for mid, title, path, old, new, nth, expected in M:
    if only and mid not in only: continue
    p = os.path.join(W, path); orig = open(p).read(); before = sha(path)
    entry = {'id': mid, 'title': title, 'file': path, 'expected_test': expected, 'sha_before': before}
    try:
        open(p, 'w').write(apply(orig, old, new, nth))
        entry['sha_mutated'] = sha(path)
        entry['detection'] = run(f'{mid}-mutant')
    finally:
        open(p, 'w').write(orig)
    entry['sha_after'] = sha(path)
    entry['restored'] = entry['sha_after'] == before
    entry['verification'] = run(f'{mid}-verify')
    det = entry['detection']
    entry['expected_failed'] = any(expected in f['test'] for f in det['failed'])
    entry['all_assertions'] = bool(det['failed']) and all(f['is_assertion'] for f in det['failed'])
    entry['verdict'] = ('CAUGHT' if det['exit'] != 0 and not det['load_failures'] and entry['all_assertions']
                        and entry['expected_failed'] and entry['restored'] and entry['verification']['exit'] == 0
                        and not entry['verification']['failed'] else 'NOT-PROVEN')
    report['mutants'].append(entry)
    print(f"{mid} {entry['verdict']} | failed={len(det['failed'])} load={len(det['load_failures'])} "
          f"expected={entry['expected_failed']} restored={entry['restored']} verify_exit={entry['verification']['exit']}", flush=True)
json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1, ensure_ascii=False)
