import { describe, expect, it } from 'vitest';

import {
  assertKnownCommand,
  classifyReportResponse,
  CliError,
  collectAllPages,
  resolveAuditPlan,
  resolveCallListsPlan,
  fetchReportWhenReady,
  helpText,
  looksLikeReport,
  normalizeAliases,
  parseArgs,
  parseCsv,
  positiveInt,
  requireStringValue,
  resolveHistoryPlan,
  resolveKeyPath,
  summarizeIntoLines,
  tempPathFor,
  utcDateTime,
  validateCommandFlags,
  writeReportAtomic,
  type AtomicWriteDeps,
  type ReportPollDeps,
} from './cli-support';

const REPORT_HEADER = 'session_id;call_successful;call_cost';
const REPORT_CSV = `${REPORT_HEADER}\n"s1";"yes";"0.5"`;

describe('parseArgs', () => {
  it('captures command + value flags', () => {
    const { command, flags } = parseArgs(['history', '--app', '123', '--force']);
    expect(command).toBe('history');
    expect(flags.app).toBe('123');
    expect(flags.force).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['account', '--bogus'])).toThrow(/unknown flag/);
  });

  it('rejects duplicate flags', () => {
    expect(() => parseArgs(['history', '--app', '1', '--app', '2'])).toThrow(
      /duplicate flag/,
    );
  });

  it('rejects extra positionals', () => {
    expect(() => parseArgs(['history', 'extra'])).toThrow(/extra arguments/);
  });
});

describe('command validation (before credentials)', () => {
  it('assertKnownCommand rejects an unknown command', () => {
    expect(() => assertKnownCommand('frobnicate')).toThrow(/unknown command/);
  });

  it('assertKnownCommand accepts known commands', () => {
    expect(() => assertKnownCommand('account')).not.toThrow();
    expect(() => assertKnownCommand('rules')).not.toThrow();
    expect(() => assertKnownCommand('history')).not.toThrow();
  });

  it('validateCommandFlags rejects a flag not valid for the command', () => {
    expect(() => validateCommandFlags('account', { app: '1' })).toThrow(
      /--app is not a valid flag for 'account'/,
    );
    expect(() => validateCommandFlags('rules', { 'history-id': '1' })).toThrow(
      /not a valid flag for 'rules'/,
    );
  });

  it('validateCommandFlags accepts valid flags', () => {
    expect(() => validateCommandFlags('account', { key: 'k' })).not.toThrow();
    expect(() => validateCommandFlags('rules', { key: 'k', app: '1' })).not.toThrow();
    expect(() =>
      validateCommandFlags('history', {
        'history-id': '1',
        output: 'f',
        force: true,
      }),
    ).not.toThrow();
  });
});

describe('validators', () => {
  it('positiveInt rejects non-positive / non-integer / over-max', () => {
    expect(() => positiveInt('x', '0')).toThrow(CliError);
    expect(() => positiveInt('x', '-3')).toThrow(CliError);
    expect(() => positiveInt('x', 'abc')).toThrow(/positive integer/);
    expect(() => positiveInt('x', true)).toThrow(/integer value/);
    expect(() => positiveInt('x', '10', { max: 5 })).toThrow(/between 1 and 5/);
    expect(positiveInt('x', '7')).toBe(7);
  });

  it('positiveInt rejects an unsafe integer', () => {
    expect(() => positiveInt('x', '99999999999999999999')).toThrow(/safe integer/);
  });

  it('requireStringValue rejects boolean / empty / whitespace', () => {
    expect(() => requireStringValue('output', true)).toThrow(/requires a value/);
    expect(() => requireStringValue('output', '')).toThrow(/must not be empty/);
    expect(() => requireStringValue('output', '   ')).toThrow(/must not be empty/);
    expect(requireStringValue('output', './f.csv')).toBe('./f.csv');
  });
});

describe('resolveKeyPath', () => {
  it('rejects --key with no value (does NOT fall back to default)', () => {
    expect(() => resolveKeyPath({ key: true }, 'env.json', 'def.json')).toThrow(
      /--key requires a value/,
    );
  });

  it('uses --key value when present', () => {
    expect(resolveKeyPath({ key: 'k.json' }, 'env.json', 'def.json')).toBe('k.json');
  });

  it('falls back to env then default when --key absent', () => {
    expect(resolveKeyPath({}, 'env.json', 'def.json')).toBe('env.json');
    expect(resolveKeyPath({}, undefined, 'def.json')).toBe('def.json');
  });
});

describe('resolveHistoryPlan', () => {
  it('resolves an existing-report plan', () => {
    const plan = resolveHistoryPlan(parseArgs(['history', '--history-id', '318807']).flags);
    expect(plan).toMatchObject({
      mode: 'existing',
      historyReportId: 318807,
      timeoutSeconds: 120,
      pollIntervalSeconds: 3,
      force: false,
    });
  });

  it('resolves a create plan with defaults', () => {
    const plan = resolveHistoryPlan(parseArgs(['history', '--app', '11107202']).flags);
    expect(plan).toMatchObject({ mode: 'create', applicationId: 11107202, days: 120 });
  });

  it('rejects ambiguous mode (history-id + app)', () => {
    const { flags } = parseArgs(['history', '--history-id', '1', '--app', '2']);
    expect(() => resolveHistoryPlan(flags)).toThrow(/choose ONE mode/);
  });

  it('rejects no mode', () => {
    expect(() => resolveHistoryPlan(parseArgs(['history']).flags)).toThrow(
      /--history-id .* or --app/,
    );
  });

  it('rejects invalid --history-id', () => {
    const { flags } = parseArgs(['history', '--history-id', 'abc']);
    expect(() => resolveHistoryPlan(flags)).toThrow(/positive integer/);
  });

  it('rejects --output with no value', () => {
    const { flags } = parseArgs(['history', '--history-id', '1', '--output']);
    expect(() => resolveHistoryPlan(flags)).toThrow(/--output requires a value/);
  });

  it('rejects an empty --output value', () => {
    const flags = { 'history-id': '1', output: '' } as const;
    expect(() => resolveHistoryPlan(flags)).toThrow(/--output must not be empty/);
  });

  it('rejects --force without --output', () => {
    const { flags } = parseArgs(['history', '--history-id', '1', '--force']);
    expect(() => resolveHistoryPlan(flags)).toThrow(/--force only applies/);
  });
});

describe('parseCsv', () => {
  it('parses a delimiter inside a quoted field', () => {
    const rows = parseCsv('a;b\n"x;y";z');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x;y', 'z'],
    ]);
  });

  it('parses a newline inside a quoted field', () => {
    const rows = parseCsv('a;b\n"line1\nline2";z');
    expect(rows).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'z'],
    ]);
  });

  it('parses escaped quotes ("")', () => {
    const rows = parseCsv('a\n"he said ""hi"""');
    expect(rows).toEqual([['a'], ['he said "hi"']]);
  });
});

describe('looksLikeReport', () => {
  it('accepts a header with session_id', () => {
    expect(looksLikeReport(REPORT_CSV)).toBe(true);
  });
  it('rejects arbitrary text', () => {
    expect(looksLikeReport('hello world\nnot a report')).toBe(false);
  });
});

describe('classifyReportResponse', () => {
  it('code 356 (application/json) → retry', () => {
    expect(
      classifyReportResponse('application/json', '{"error":{"code":356,"msg":"not ready"}}'),
    ).toEqual({ kind: 'retry' });
  });

  it('code 356 with BOM + whitespace + octet-stream → retry', () => {
    const body = '\uFEFF   \n{"errors":[{"code":356,"msg":"not ready"}]}';
    expect(classifyReportResponse('application/octet-stream', body)).toEqual({
      kind: 'retry',
    });
  });

  it('non-356 API error → error', () => {
    const c = classifyReportResponse('application/json', '{"error":{"code":400,"msg":"bad"}}');
    expect(c.kind).toBe('error');
    if (c.kind === 'error') expect(c.message).toMatch(/400.*bad/);
  });

  it('valid report CSV (text/csv) → csv', () => {
    expect(classifyReportResponse('text/csv', REPORT_CSV)).toEqual({
      kind: 'csv',
      csv: REPORT_CSV,
    });
  });

  it('valid report CSV (application/octet-stream) → csv', () => {
    expect(classifyReportResponse('application/octet-stream', REPORT_CSV)).toEqual({
      kind: 'csv',
      csv: REPORT_CSV,
    });
  });

  it('text/plain that is NOT a report → error', () => {
    const c = classifyReportResponse('text/plain', 'just some text, not a report');
    expect(c.kind).toBe('error');
    if (c.kind === 'error') expect(c.message).toMatch(/not a Voximplant call-history report/);
  });

  it('empty body → error', () => {
    const c = classifyReportResponse('text/csv', '   ');
    expect(c.kind).toBe('error');
    if (c.kind === 'error') expect(c.message).toMatch(/empty body/);
  });

  it('unexpected Content-Type → error', () => {
    const c = classifyReportResponse('image/png', 'binary');
    expect(c.kind).toBe('error');
    if (c.kind === 'error') expect(c.message).toMatch(/unexpected Content-Type/);
  });

  it('malformed JSON → error', () => {
    const c = classifyReportResponse('application/json', '{not json');
    expect(c.kind).toBe('error');
    if (c.kind === 'error') expect(c.message).toMatch(/malformed JSON/);
  });
});

describe('fetchReportWhenReady', () => {
  const opts = { timeoutSeconds: 120, pollIntervalSeconds: 1 };

  it('retries on 356 then returns the CSV', async () => {
    let calls = 0;
    const deps: ReportPollDeps = {
      getStatus: async () => ({ completed: 'yes' }),
      download: async () => {
        calls++;
        return calls === 1
          ? { status: 200, contentType: 'application/json', body: '{"error":{"code":356}}' }
          : { status: 200, contentType: 'text/csv', body: REPORT_CSV };
      },
      now: () => 1000,
      sleep: async () => {},
    };
    await expect(fetchReportWhenReady(1, opts, deps)).resolves.toBe(REPORT_CSV);
    expect(calls).toBe(2);
  });

  it('throws a timeout error when 356 never clears', async () => {
    let t = 0;
    const deps: ReportPollDeps = {
      getStatus: async () => ({ completed: 'yes' }),
      download: async () => ({
        status: 200,
        contentType: 'application/json',
        body: '{"error":{"code":356}}',
      }),
      now: () => {
        const v = t;
        t += 600;
        return v;
      },
      sleep: async () => {},
    };
    await expect(
      fetchReportWhenReady(42, { timeoutSeconds: 1, pollIntervalSeconds: 1 }, deps),
    ).rejects.toThrow(/report #42 was not ready after 1 seconds/);
  });

  it('throws immediately on a non-356 API error', async () => {
    const deps: ReportPollDeps = {
      getStatus: async () => ({ completed: 'yes' }),
      download: async () => ({
        status: 200,
        contentType: 'application/json',
        body: '{"error":{"code":401,"msg":"denied"}}',
      }),
      now: () => 0,
      sleep: async () => {},
    };
    await expect(fetchReportWhenReady(7, opts, deps)).rejects.toThrow(/401.*denied/);
  });
});

describe('writeReportAtomic + tempPathFor', () => {
  function fakeDeps(overrides: Partial<AtomicWriteDeps> = {}): {
    deps: AtomicWriteDeps;
    log: string[];
  } {
    const log: string[] = [];
    const deps: AtomicWriteDeps = {
      mkdirp: (d) => log.push(`mkdirp ${d}`),
      exists: () => false,
      writeFile: (p, data) => log.push(`write ${p}=${data}`),
      rename: (from, to) => log.push(`rename ${from}->${to}`),
      remove: (p) => log.push(`remove ${p}`),
      dirname: () => 'out',
      basename: () => 'r.csv',
      join: (...parts) => parts.join('/'),
      ...overrides,
    };
    return { deps, log };
  }

  it('writes to a per-run temp file then renames atomically', () => {
    const { deps, log } = fakeDeps();
    writeReportAtomic('out/r.csv', 'DATA', { force: false, uniqueToken: 'T1' }, deps);
    expect(log).toEqual([
      'mkdirp out',
      'write out/.r.csv.T1.partial=DATA',
      'rename out/.r.csv.T1.partial->out/r.csv',
    ]);
  });

  it('two concurrent writes do NOT share a temp path', () => {
    const { deps } = fakeDeps();
    const a = tempPathFor('out/r.csv', 'PID1-T1-0', deps);
    const b = tempPathFor('out/r.csv', 'PID1-T2-1', deps);
    expect(a).not.toBe(b);
  });

  it('refuses to overwrite without --force', () => {
    const { deps, log } = fakeDeps({ exists: (p) => p === 'out/r.csv' });
    expect(() =>
      writeReportAtomic('out/r.csv', 'DATA', { force: false, uniqueToken: 'T' }, deps),
    ).toThrow(/refusing to overwrite/);
    expect(log.some((l) => l.startsWith('write'))).toBe(false);
  });

  it('overwrites with --force', () => {
    const { deps, log } = fakeDeps({ exists: (p) => p === 'out/r.csv' });
    writeReportAtomic('out/r.csv', 'DATA', { force: true, uniqueToken: 'T' }, deps);
    expect(log).toContain('rename out/.r.csv.T.partial->out/r.csv');
  });

  it('removes the temp file when the write fails', () => {
    const { deps, log } = fakeDeps({
      exists: (p) => p === 'out/.r.csv.T.partial',
      writeFile: () => {
        throw new Error('disk full');
      },
    });
    expect(() =>
      writeReportAtomic('out/r.csv', 'DATA', { force: false, uniqueToken: 'T' }, deps),
    ).toThrow(/disk full/);
    expect(log).toContain('remove out/.r.csv.T.partial');
  });
});

describe('summarizeIntoLines', () => {
  it('shows row count, cost, and raw status distribution (no verdict)', () => {
    const csv = [
      '"session_id";"session_start_date (UTC)";"call_successful";"call_cost"',
      '"s1";"2026-04-07 10:00:00";"yes";"0.12"',
      '"s2";"2026-06-14 07:00:00";"no";"0.03"',
      '"s3";"2026-05-01 09:00:00";"";"0.05"',
    ].join('\n');
    const lines = summarizeIntoLines(csv);
    expect(lines).toContain('rows        : 3');
    expect(lines.some((l) => l.includes('$0.2000'))).toBe(true);
    // distribution line, NOT a "failed" verdict
    expect(lines.some((l) => l.includes('yes=1') && l.includes('no=1') && l.includes('(empty)=1'))).toBe(true);
    expect(lines.some((l) => /failed/i.test(l))).toBe(false);
    expect(lines.some((l) => l.includes('2026-04-07 10:00:00  …  2026-06-14 07:00:00'))).toBe(true);
  });
});

describe('helpText (no credentials required)', () => {
  it('returns distinct main and history help', () => {
    const { command, flags } = parseArgs(['--help']);
    expect(command).toBeUndefined();
    expect(flags.help).toBe(true);
    const main = helpText(command);
    const history = helpText('history');
    expect(main).toMatch(/usage: npm run voximplant/);
    expect(history).toMatch(/history <mode>/);
    expect(main).not.toBe(history);
  });
});

it('fetchReportWhenReady surfaces CliError instances', async () => {
  const deps: ReportPollDeps = {
    getStatus: async () => ({ completed: 'yes' }),
    download: async () => ({ status: 200, contentType: 'image/png', body: 'x' }),
    now: () => 0,
    sleep: async () => {},
  };
  await expect(
    fetchReportWhenReady(1, { timeoutSeconds: 5, pollIntervalSeconds: 1 }, deps),
  ).rejects.toBeInstanceOf(CliError);
});

describe('normalizeAliases', () => {
  it('maps --credentials to --key and --application-id to --app', () => {
    expect(
      normalizeAliases({ credentials: '/tmp/k.json', 'application-id': '7' }),
    ).toEqual({ key: '/tmp/k.json', app: '7' });
  });

  it('keeps canonical names untouched', () => {
    expect(normalizeAliases({ key: 'a', app: '1', force: true })).toEqual({
      key: 'a',
      app: '1',
      force: true,
    });
  });

  it('rejects an alias given together with its canonical form', () => {
    expect(() => normalizeAliases({ key: 'a', credentials: 'b' })).toThrow(CliError);
    expect(() => normalizeAliases({ app: '1', 'application-id': '2' })).toThrow(
      CliError,
    );
  });
});

describe('utcDateTime', () => {
  it('normalizes a bare date to midnight UTC', () => {
    expect(utcDateTime('from', '2026-07-01')).toBe('2026-07-01 00:00:00');
  });

  it('accepts a full datetime unchanged', () => {
    expect(utcDateTime('from', '2026-07-01 13:45:00')).toBe('2026-07-01 13:45:00');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => utcDateTime('from', '01/07/2026')).toThrow(CliError);
    expect(() => utcDateTime('from', '2026-02-30')).toThrow(CliError);
    expect(() => utcDateTime('from', '2026-07-01 25:00:00')).toThrow(CliError);
    expect(() => utcDateTime('from', true)).toThrow(CliError);
  });
});

describe('resolveHistoryPlan — explicit --from/--to window', () => {
  it('resolves a create plan with a normalized UTC window', () => {
    const plan = resolveHistoryPlan({
      app: '111',
      from: '2026-07-01',
      to: '2026-07-15 12:00:00',
    });
    expect(plan).toMatchObject({
      mode: 'create',
      applicationId: 111,
      fromDate: '2026-07-01 00:00:00',
      toDate: '2026-07-15 12:00:00',
    });
  });

  it('rejects --from without --to (and vice versa)', () => {
    expect(() => resolveHistoryPlan({ app: '1', from: '2026-07-01' })).toThrow(
      /given together/,
    );
    expect(() => resolveHistoryPlan({ app: '1', to: '2026-07-01' })).toThrow(
      /given together/,
    );
  });

  it('rejects --from/--to combined with --days', () => {
    expect(() =>
      resolveHistoryPlan({
        app: '1',
        days: '30',
        from: '2026-07-01',
        to: '2026-07-02',
      }),
    ).toThrow(/ONE window/);
  });

  it('rejects an inverted window', () => {
    expect(() =>
      resolveHistoryPlan({ app: '1', from: '2026-07-02', to: '2026-07-01' }),
    ).toThrow(/earlier than/);
  });

  it('rejects --from/--to together with --history-id', () => {
    expect(() =>
      resolveHistoryPlan({ 'history-id': '5', from: '2026-07-01', to: '2026-07-02' }),
    ).toThrow(/ONE mode/);
  });
});

describe('collectAllPages (offset pagination)', () => {
  const page = (rows: number[], total: number) => ({
    result: rows,
    total_count: total,
  });

  it('walks pages until total_count rows are gathered', async () => {
    const calls: Array<[number, number]> = [];
    const { rows, totalCount } = await collectAllPages<number>(
      async (offset, count) => {
        calls.push([offset, count]);
        if (offset === 0) return page([1, 2], 5);
        if (offset === 2) return page([3, 4], 5);
        return page([5], 5);
      },
      { pageSize: 2, maxRows: 100 },
    );
    expect(rows).toEqual([1, 2, 3, 4, 5]);
    expect(totalCount).toBe(5);
    expect(calls).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  it('stops on an empty page even when total_count over-reports', async () => {
    const { rows } = await collectAllPages<number>(
      async (offset) => (offset === 0 ? page([1], 10) : page([], 10)),
      { pageSize: 1, maxRows: 100 },
    );
    expect(rows).toEqual([1]);
  });

  it('honors the maxRows backstop against a runaway listing', async () => {
    const { rows } = await collectAllPages<number>(
      async () => page([1, 1, 1], 1_000_000),
      { pageSize: 3, maxRows: 7 },
    );
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.length).toBeLessThanOrEqual(9);
  });
});

describe('resolveCallListsPlan (A1)', () => {
  it('defaults to a 30-day window with no list filter', () => {
    expect(resolveCallListsPlan({})).toEqual({ listId: undefined, days: 30 });
  });
  it('accepts --list-id and --days within bounds', () => {
    expect(resolveCallListsPlan({ 'list-id': '318', days: '90' })).toEqual({
      listId: 318,
      days: 90,
    });
  });
  it('rejects invalid values', () => {
    expect(() => resolveCallListsPlan({ 'list-id': 'abc' })).toThrow(CliError);
    expect(() => resolveCallListsPlan({ days: '400' })).toThrow(/between 1 and 365/);
  });
});

describe('resolveAuditPlan (A3)', () => {
  it('defaults to 30 days / 50 entries', () => {
    expect(resolveAuditPlan({})).toEqual({ days: 30, count: 50 });
  });
  it('caps --count at 1000', () => {
    expect(() => resolveAuditPlan({ count: '5000' })).toThrow(/between 1 and 1000/);
    expect(resolveAuditPlan({ count: '1000', days: '7' })).toEqual({ days: 7, count: 1000 });
  });
});

describe('new read-only commands — flag validation', () => {
  it('accepts the documented flags per command', () => {
    expect(() => validateCommandFlags('call-lists', { key: 'k', 'list-id': '1' })).not.toThrow();
    expect(() => validateCommandFlags('media-resources', {})).not.toThrow();
    expect(() => validateCommandFlags('audit', { days: '7', count: '10' })).not.toThrow();
  });
  it('rejects out-of-scope flags (incl. credentials on media-resources)', () => {
    expect(() => validateCommandFlags('media-resources', { key: 'k' })).toThrow(
      /not a valid flag/,
    );
    expect(() => validateCommandFlags('call-lists', { output: 'f' })).toThrow(
      /not a valid flag/,
    );
    expect(() => validateCommandFlags('audit', { 'list-id': '2' })).toThrow(/not a valid flag/);
  });
  it('the former start command is gone', () => {
    expect(() => assertKnownCommand('start')).toThrow(/unknown command/);
  });
});
