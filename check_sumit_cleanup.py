#!/usr/bin/env python3
"""Read-only check for task 6.1 of openspec/changes/retire-sumit-campaign-columns.

Finds references to the SUMIT diagnostics removed on 27.10.2026 (files, routes, exports and the
sumit_test_transactions table) and to the five campaigns columns dropped with them. It never writes a
file, never uses the network and never queries a database (the column scanner runs without --db).

Scope: tracked files (`git ls-files`) are the repository. Untracked, not-ignored files are scanned too,
but reported in their own bucket unless they sit in a source path (an untracked src/ file still builds).
Gitignored files are not scanned. Symlinks are skipped (every tracked one points inside the repo).

Every hit gets one category:
  LIVE          code, configuration or agent instructions that still name a removed item
  NEEDS_REVIEW  tracked prose or dumps (docs, other OpenSpec changes) - a person decides
  HISTORICAL    a reviewed history location or a reviewed line on the ALLOW list
  AMBIGUOUS     a test fixture the column scanner could not tie to a table, whose name also exists on
                payment_operations / sumit_customers
  UNTRACKED     an untracked file outside a source path (scratch dumps); counted per file only

Output: JSON on stdout (summary first) and one verdict line on stderr.
Exit: 0 = no LIVE finding, 1 = at least one LIVE finding, 2 = the scan itself failed.
"""
import collections, json, os, re, subprocess, sys

# --- what was removed ---------------------------------------------------------------------------------
TERMS = ('sumit-test', 'safe-preview', 'charge-response', 'sumit-doc-check', '/admin/sumit-test', '/api/admin/sumit-test',
         'listChargeableCampaigns', 'resolveSavedCardForCampaign', 'listTestHolds', 'recordSumitTestTransaction',
         'getTestHoldForCapture', 'summarizeSumitRequest', 'summarizeSumitResponse', 'mapSumitChargeResponse',
         'sumit_test_transactions',
         # exported types of the removed modules. asObj/Obj/SavedCard are left out on purpose: probe.ts and
         # package-refund.ts own unrelated local ones, and an import of the removed ones names the module path.
         'ChargeableCampaign', 'TestHoldOption', 'TestHoldForCapture', 'RecordTestTransactionInput', 'SumitResponseColumns')
# Case-sensitive terms, plus one case-insensitive form for SumitTest / "SUMIT test page" / sumit_test.
# (charge-response stays case-sensitive: folded, it matches every generated *ChargeResponse model.)
TERM_RE = re.compile('|'.join([re.escape(t) for t in sorted(TERMS, key=len, reverse=True)] + [r'(?i:sumit[-_ ]?test)']))
PATH_TERMS = ('sumit-test', 'safe-preview', 'charge-response', 'sumit-doc-check')
COLUMNS = ('card_token_ref', 'card_exp_month', 'card_exp_year', 'card_citizen_id', 'sumit_customer_id')
COL_RE = re.compile(r'(?<![A-Za-z0-9_])(?:' + '|'.join(COLUMNS) + r')(?![A-Za-z0-9_])')
SCANNER = 'scripts/find-legacy-campaign-payment-columns.mjs'
JS_EXT = ('.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs')  # columns in these: the AST scanner
CODE_EXT = JS_EXT + ('.sh', '.py', '.sql', '.json', '.jsonc', '.yml', '.yaml', '.toml')
CHECKERS = ('check_sumit_cleanup.py', 'check-sumit-cleanup.sh')  # both name every term themselves

# --- reviewed classification --------------------------------------------------------------------------
DROP_VERSION = '20261027092539'  # the last drop migration; an older migration is applied history
HISTORICAL_PREFIXES = ('openspec/changes/retire-sumit-campaign-columns/', 'openspec/changes/archive/',
                       'docs/superpowers/plans/', 'plans/', 'handoffs/', '.hermes/plans/')
SOURCE_PREFIXES = ('src/', 'scripts/', 'supabase/', 'voxfiles/', 'agent_configs/', 'public/', '.github/', '.claude/')
DATED = re.compile(r'(?<!\d)20\d{2}-?[01]\d-?[0-3]\d(?!\d)')
# (path, text on the line, reason). Matched per line, never per file.
ALLOW = (
    ('src/app/(admin)/admin/integrations/sumit/page.test.ts', "not.toContain('/admin/sumit-test')",
     'negative assertion: the integration page must not link to the removed page'),
    ('src/lib/data/event-stats.test.ts', "card_token_ref: 'card-ref'", 'PII negative fixture: the stats output must not carry card fields'),
    ('src/lib/data/event-stats.test.ts', "card_citizen_id: '123456789'", 'PII negative fixture: the stats output must not carry card fields'),
    ('src/lib/data/event-stats.test.ts', "'card_token_ref',", 'PII negative fixture: pattern the stats output must not contain'),
    ('src/lib/data/event-stats.test.ts', "'card_citizen_id',", 'PII negative fixture: pattern the stats output must not contain'),
    ('.claude/agents/sumit-billing-expert.md', 'the `/admin/sumit-test` diagnostic page were removed', 'agent doc records the removal'),
    ('.claude/agents/sumit-billing-expert.md', 'There is no SUMIT test surface in the app any more', 'agent doc records the removal'),
    ('.claude/agents/sumit-billing-expert.md', '`/admin/sumit-test` page was retired, owner, 27.10.2026', 'agent doc records the removal'),
    ('.claude/agents/shared/tax-catalog-israel.md', 'דף הבדיקה `/admin/sumit-test` הוסר', 'agent doc records the removal'),
    ('.claude/agents/shared/tax-catalog-israel.md', '`scripts/sumit-doc-check.ts`, הוסר ב-27.10.2026', 'agent doc records the removal'),
)


def is_source(path, tracked):
    # A root-level file counts as source only when tracked: untracked root files are scratch dumps.
    top = tracked and '/' not in path
    return path.startswith(SOURCE_PREFIXES) or (top and (path.endswith(CODE_EXT) or path in ('CLAUDE.md', 'AGENTS.md')))


def classify(path, text, tracked):
    """(category, reason) for one hit. Pure: depends only on its arguments."""
    for p, needle, why in ALLOW:
        if path == p and needle in text:
            return 'HISTORICAL', why
    m = re.match(r'supabase/migrations/(\d+)_', path)
    if m:
        if m.group(1).ljust(len(DROP_VERSION), '0') <= DROP_VERSION:
            return 'HISTORICAL', 'migration applied up to the drop'
        return 'LIVE', 'a migration newer than the drop names a removed item'
    if path.startswith(HISTORICAL_PREFIXES):
        return 'HISTORICAL', 'history location (this change, archive, plans, handoffs)'
    if is_source(path, tracked):
        return 'LIVE', 'code, configuration or agent instructions'
    if not tracked:
        return 'UNTRACKED', 'untracked file outside a source path'
    if DATED.search(path):
        return 'HISTORICAL', 'dated record'
    return 'NEEDS_REVIEW', 'tracked prose or dump: does it describe the removed item as present?'


def classify_scanner_ref(r, tracked):
    cat, why = classify(r['file'], r['text'], tracked)
    if cat in ('HISTORICAL', 'UNTRACKED'):
        return cat, why
    conf = r['confidence']
    if conf == 'confirmed':
        return 'LIVE', 'the query chain or the type resolves to campaigns'
    if conf == 'ambiguous':
        return ('AMBIGUOUS', 'test fixture; the name also exists on payment_operations / sumit_customers') if r['test'] \
            else ('NEEDS_REVIEW', 'table not resolved; the name also exists on another table')
    if conf == 'likely' and not r['test']:
        return 'LIVE', 'the name exists on no other table (the column is dropped)'
    return 'NEEDS_REVIEW', f'{conf}: the name exists on no other table; check the fixture or file'


def snippet(text, start):
    s = max(0, start - 80)
    return ('…' if s else '') + text[s:s + 200].strip() + ('…' if len(text) > s + 200 else '')


def git_files(*args):
    return [f for f in subprocess.check_output(['git', 'ls-files', '-z', *args]).decode('utf-8', 'replace').split('\0') if f]


def read_text(path, skipped, lossy, errors):
    if os.path.islink(path):
        skipped['symlink'] += 1; return None
    if not os.path.isfile(path):
        skipped['missing_or_not_file'] += 1; return None
    try:
        with open(path, 'rb') as f:
            head = f.read(8000)
            if b'\0' in head:
                skipped['binary'] += 1; return None
            raw = head + f.read()
    except OSError as e:
        errors.append(f'{path}: {e}'); return None
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        lossy.append(path); return raw.decode('utf-8', 'replace')


def main():
    root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
    os.chdir(root)
    tracked, untracked = git_files(), git_files('-o', '--exclude-standard')
    tracked_set = set(tracked)
    me = os.path.relpath(os.path.realpath(__file__), root).replace(os.sep, '/')
    excluded = set(CHECKERS) | {me}
    findings, errors, lossy = [], [], []
    skipped = collections.Counter()

    def add(path, line, source, matches, text, start, cat_why, **extra):
        cat, why = cat_why
        findings.append({'category': cat, 'file': path, 'line': line, 'source': source, 'matches': matches,
                         'reason': why, 'text': snippet(text, start), **extra})

    for path in tracked + untracked:
        if path in excluded:
            continue
        is_tracked = path in tracked_set
        if any(t in path for t in PATH_TERMS):
            add(path, 0, 'path', [t for t in PATH_TERMS if t in path], path, 0, classify(path, path, is_tracked))
        content = read_text(path, skipped, lossy, errors)
        if content is None:
            continue
        scan_cols = not path.endswith(JS_EXT)
        for no, line in enumerate(content.split('\n'), 1):
            hits = list(TERM_RE.finditer(line))
            if hits:
                add(path, no, 'term', sorted({h.group(0) for h in hits}), line, hits[0].start(), classify(path, line, is_tracked))
            if scan_cols:
                cols = list(COL_RE.finditer(line))
                if cols:
                    add(path, no, 'column', sorted({c.group(0) for c in cols}), line, cols[0].start(), classify(path, line, is_tracked))

    scanner_summary = None
    if not os.path.isfile(SCANNER):
        errors.append(f'missing column scanner: {SCANNER}')
    else:
        try:
            proc = subprocess.run(['node', SCANNER, '--columns', ','.join(COLUMNS), '--json'],
                                  capture_output=True, text=True, timeout=900)
            if proc.returncode != 0:
                errors.append(f'column scanner exited {proc.returncode}: {proc.stderr.strip()[-500:]}')
            else:
                data = json.loads(proc.stdout)
                refs = data['references']
                if sorted(data['columns']) != sorted(COLUMNS):
                    errors.append(f"column scanner checked {data['columns']}, expected {list(COLUMNS)}")
                for r in refs:
                    add(r['file'], r['line'], 'scanner', [r['column']], r['text'], 0,
                        classify_scanner_ref(r, r['file'] in tracked_set),
                        access=r['access'], confidence=r['confidence'], via=r['via'], test=r['test'])
                scanner_summary = {'references': len(refs),
                                   'by_confidence': dict(collections.Counter(r['confidence'] for r in refs)),
                                   'in_tests': sum(1 for r in refs if r['test'])}
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError, KeyError, TypeError) as e:
            errors.append(f'column scanner failed: {e!r}')

    by_cat = collections.defaultdict(list)
    for f in findings:
        by_cat[f['category']].append(f)
    per_file = lambda cat: dict(collections.Counter(f['file'] for f in by_cat[cat]).most_common())
    cats = ('LIVE', 'NEEDS_REVIEW', 'AMBIGUOUS', 'HISTORICAL', 'UNTRACKED')
    code = 2 if errors else (1 if by_cat['LIVE'] else 0)
    summary = {
        'exit_code': code,
        'verdict': 'scan failed' if errors else (f"{len(by_cat['LIVE'])} LIVE finding(s)" if by_cat['LIVE'] else 'no LIVE finding'),
        'findings': {c: len(by_cat[c]) for c in cats},
        'files': {c: len(per_file(c)) for c in cats},
        'scanned': {'tracked': len(tracked), 'untracked': len(untracked), 'excluded': sorted(excluded),
                    'skipped': dict(skipped), 'decoded_lossily': lossy},
        'column_scanner': scanner_summary,
        'needs_review_by_file': per_file('NEEDS_REVIEW'),
    }
    out = {'summary': summary, 'live': by_cat['LIVE'], 'needs_review': by_cat['NEEDS_REVIEW'],
           'ambiguous_by_file': per_file('AMBIGUOUS'), 'historical_by_file': per_file('HISTORICAL'),
           'untracked_by_file': per_file('UNTRACKED'), 'errors': errors,
           'limitations': ['Gitignored files are not scanned (build output, caches, local notes such as .remember/).',
                           'Symlinks are skipped; the tracked ones point inside the repository and their targets are scanned.',
                           'Categories come from location and reviewed lines, not meaning: NEEDS_REVIEW needs a reader.',
                           'Column names in JS/TS are graded by the AST scanner, which skips docs/, voxfiles/, .claude/ and '
                           'generated types (see its header); every other file is text-matched.',
                           'No database and no external consumer is checked (the scanner runs without --db).']}
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8', errors='backslashreplace')
    print(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"[{summary['verdict']}] " + ' · '.join(f'{c} {summary["findings"][c]}' for c in cats) + f' → exit {code}', file=sys.stderr)
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:  # any crash is a failed scan (2), never "LIVE found" (1)
        print(f'[X] Scan failed: {e!r}', file=sys.stderr)
        sys.exit(2)
