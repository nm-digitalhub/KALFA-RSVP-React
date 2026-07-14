/**
 * Pure, testable support logic for the Voximplant CLI (`./cli`).
 *
 * Everything here is IO-free or IO-injected so it can be unit-tested without a
 * network, clock, or filesystem. `cli.ts` is a thin wiring layer over this.
 */

// A user-facing CLI error: printed as a clean message, no stack trace.
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = new Set([
  'key',
  'help',
  'app',
  'days',
  'history-id',
  'output',
  'force',
  'timeout-seconds',
  'poll-interval-seconds',
  // `start` subcommand (manual, guarded — places a REAL call)
  'rule',
  'to',
  'from',
  'confirm',
  'bytes',
]);

// Flags that never take a value (presence = true).
const BOOLEAN_FLAGS = new Set(['help', 'force', 'confirm']);

export type FlagValue = string | true;
export interface ParsedArgs {
  command?: string;
  flags: Record<string, FlagValue>;
}

// Parse `command --flag value --bool` into a command + flags map. Rejects unknown
// flags, duplicate flags, and stray extra positionals (the only positional is the
// command). A value-taking flag with no value is stored as `true` (rejected later
// by the value validators).
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!KNOWN_FLAGS.has(name)) throw new CliError(`unknown flag: --${name}`);
      if (seen.has(name)) throw new CliError(`duplicate flag: --${name}`);
      seen.add(name);
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true; // value-less value-flag → invalid, caught downstream
      }
    } else {
      positionals.push(a);
    }
  }

  if (positionals.length > 1) {
    throw new CliError(
      `unexpected extra arguments: ${positionals.slice(1).join(' ')}`,
    );
  }
  return { command: positionals[0], flags };
}

// ---------------------------------------------------------------------------
// Commands + per-command flag validation
// ---------------------------------------------------------------------------

export const KNOWN_COMMANDS = ['account', 'rules', 'history', 'numbers', 'transactions', 'start'] as const;
export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

export function assertKnownCommand(command: string): asserts command is KnownCommand {
  if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) {
    throw new CliError(`unknown command: ${command}`);
  }
}

const ALLOWED_FLAGS: Record<KnownCommand, Set<string>> = {
  account: new Set(['key']),
  rules: new Set(['key', 'app']),
  history: new Set([
    'key',
    'app',
    'days',
    'history-id',
    'output',
    'force',
    'timeout-seconds',
    'poll-interval-seconds',
  ]),
  // READ-ONLY list of the account's phone numbers (find a usable Caller ID).
  // Never purchases/attaches/modifies — only --key (credentials path).
  numbers: new Set(['key']),
  // READ-ONLY billing ledger — what the balance is spent on. --days window,
  // --type CSV filter. Never charges/refunds/modifies anything.
  transactions: new Set(['key', 'days', 'type']),
  // A manual, one-shot StartScenarios trigger (byte-cap probe). `--confirm` is a
  // mandatory safety interlock — see resolveStartPlan; nothing runs without it.
  start: new Set(['key', 'rule', 'to', 'from', 'confirm', 'bytes']),
};

// Reject any flag that does not belong to the given command (--help is global and
// already handled before this runs).
export function validateCommandFlags(
  command: KnownCommand,
  flags: Record<string, FlagValue>,
): void {
  const allowed = ALLOWED_FLAGS[command];
  for (const name of Object.keys(flags)) {
    if (name === 'help') continue;
    if (!allowed.has(name)) {
      throw new CliError(`--${name} is not a valid flag for '${command}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Value validators
// ---------------------------------------------------------------------------

export function requireStringValue(name: string, v: FlagValue | undefined): string {
  if (v === undefined) throw new CliError(`--${name} is required`);
  if (v === true) throw new CliError(`--${name} requires a value`);
  if (v.trim().length === 0) throw new CliError(`--${name} must not be empty`);
  return v;
}

export function positiveInt(
  name: string,
  v: FlagValue | undefined,
  opts: { max?: number } = {},
): number {
  if (v === undefined) throw new CliError(`--${name} is required`);
  if (v === true) throw new CliError(`--${name} requires an integer value`);
  if (!/^\d+$/.test(v)) {
    throw new CliError(`--${name} must be a positive integer (got "${v}")`);
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new CliError(`--${name} must be a positive, safe integer`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new CliError(`--${name} must be between 1 and ${opts.max}`);
  }
  return n;
}

// Resolve the service-account key path. An explicit `--key` MUST carry a value —
// it never silently falls through to the env/default.
export function resolveKeyPath(
  flags: Record<string, FlagValue>,
  env: string | undefined,
  defaultPath: string,
): string {
  if (flags.key !== undefined) return requireStringValue('key', flags.key);
  return env ?? defaultPath;
}

// ---------------------------------------------------------------------------
// history command plan (validated arguments)
// ---------------------------------------------------------------------------

export const HISTORY_DEFAULTS = {
  days: 120,
  maxDays: 3650,
  timeoutSeconds: 120,
  maxTimeoutSeconds: 3600,
  pollIntervalSeconds: 3,
  maxPollIntervalSeconds: 3600,
} as const;

export interface HistoryOutputPlan {
  output?: string;
  force: boolean;
  timeoutSeconds: number;
  pollIntervalSeconds: number;
}

export type HistoryPlan =
  | ({ mode: 'existing'; historyReportId: number } & HistoryOutputPlan)
  | ({ mode: 'create'; applicationId: number; days: number } & HistoryOutputPlan);

export function resolveHistoryPlan(flags: Record<string, FlagValue>): HistoryPlan {
  const output =
    flags.output !== undefined ? requireStringValue('output', flags.output) : undefined;
  if (flags.force === true && output === undefined) {
    throw new CliError('--force only applies together with --output');
  }
  const common: HistoryOutputPlan = {
    output,
    force: flags.force === true,
    timeoutSeconds:
      flags['timeout-seconds'] !== undefined
        ? positiveInt('timeout-seconds', flags['timeout-seconds'], {
            max: HISTORY_DEFAULTS.maxTimeoutSeconds,
          })
        : HISTORY_DEFAULTS.timeoutSeconds,
    pollIntervalSeconds:
      flags['poll-interval-seconds'] !== undefined
        ? positiveInt('poll-interval-seconds', flags['poll-interval-seconds'], {
            max: HISTORY_DEFAULTS.maxPollIntervalSeconds,
          })
        : HISTORY_DEFAULTS.pollIntervalSeconds,
  };

  const hasExisting = flags['history-id'] !== undefined;
  const hasCreate = flags.app !== undefined || flags.days !== undefined;
  if (hasExisting && hasCreate) {
    throw new CliError(
      'choose ONE mode: --history-id <id> (existing) OR --app <id> [--days n] (new report)',
    );
  }
  if (hasExisting) {
    return {
      mode: 'existing',
      historyReportId: positiveInt('history-id', flags['history-id']),
      ...common,
    };
  }
  if (flags.app !== undefined) {
    return {
      mode: 'create',
      applicationId: positiveInt('app', flags.app),
      days:
        flags.days !== undefined
          ? positiveInt('days', flags.days, { max: HISTORY_DEFAULTS.maxDays })
          : HISTORY_DEFAULTS.days,
      ...common,
    };
  }
  throw new CliError(
    'history requires either --history-id <id> or --app <id> [--days n]',
  );
}

// ---------------------------------------------------------------------------
// start command plan — manual, guarded StartScenarios byte-cap probe
// ---------------------------------------------------------------------------

// Upper bound for the synthetic --bytes padding: comfortably above the real
// payload (~450-550B) and Voximplant's documented cap, while refusing absurd
// values. This is a diagnostic size, never a production payload.
export const START_MAX_BYTES = 4096;

export interface StartPlan {
  ruleId: number;
  to: string;
  from?: string;
  // When set, the synthetic script_custom_data is padded to ~this many UTF-8
  // bytes so the operator can probe exactly where the scenario truncates it.
  targetBytes?: number;
}

// Validate the arguments for `start`. This does NOT place a call — it only
// produces a plan. The `--confirm` interlock is enforced HERE so that every
// path to a live dial (CLI dispatch OR any future caller) must pass it; the
// command can never fire by default, from a test, or from a bare invocation.
export function resolveStartPlan(flags: Record<string, FlagValue>): StartPlan {
  if (flags.confirm !== true) {
    throw new CliError(
      'start places a REAL outbound call and is disabled by default. ' +
        'Re-run with --confirm ONLY after balance top-up and explicit approval.',
    );
  }
  const ruleId = positiveInt('rule', flags.rule);
  const to = requireStringValue('to', flags.to);
  const from =
    flags.from !== undefined ? requireStringValue('from', flags.from) : undefined;
  const targetBytes =
    flags.bytes !== undefined
      ? positiveInt('bytes', flags.bytes, { max: START_MAX_BYTES })
      : undefined;
  return { ruleId, to, from, targetBytes };
}

// Build a synthetic script_custom_data mirroring the production payload SHAPE
// (to/from/iid/cb/ctx/gk) but with placeholder values only — no real signed
// tokens or Groq key ever appear here. When `targetBytes` is set the payload is
// padded to approximately that UTF-8 size to probe the scenario's byte cap.
// Returns the payload AND its exact byte length so callers log only the count.
export function buildStartCustomData(plan: StartPlan): {
  payload: string;
  bytes: number;
} {
  const base: Record<string, string> = {
    to: plan.to,
    from: plan.from ?? '',
    iid: 'cli-cap-test',
    cb: 'https://example.invalid/api/voximplant/cb/CAP_TEST',
    ctx: 'https://example.invalid/api/voximplant/ctx/CAP_TEST',
    gk: 'CAP_TEST',
  };
  if (plan.targetBytes === undefined) {
    const payload = JSON.stringify(base);
    return { payload, bytes: Buffer.byteLength(payload, 'utf8') };
  }
  const empty = JSON.stringify({ ...base, pad: '' });
  const current = Buffer.byteLength(empty, 'utf8');
  const padLen = plan.targetBytes > current ? plan.targetBytes - current : 0;
  const payload = JSON.stringify({ ...base, pad: 'x'.repeat(padLen) });
  return { payload, bytes: Buffer.byteLength(payload, 'utf8') };
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180-style, quote/delimiter/newline-in-field aware)
// ---------------------------------------------------------------------------

// Parse CSV text into rows of string fields. Handles quoted fields containing the
// delimiter, CR/LF newlines, and escaped quotes (""). Voximplant uses ';'.
export function parseCsv(input: string, delimiter = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAny = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      sawAny = true;
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAny = false;
      continue;
    }
    field += ch;
    sawAny = true;
  }
  if (sawAny || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// A body only counts as a call-history report if its header row carries the
// anchor Voximplant columns — never trust an arbitrary text/plain body.
const REQUIRED_REPORT_COLUMNS = ['session_id'];

export function looksLikeReport(csv: string): boolean {
  const rows = parseCsv(csv);
  const header = rows.find((r) => r.some((c) => c.trim().length > 0));
  if (!header) return false;
  const cols = header.map((h) => h.trim().toLowerCase());
  return REQUIRED_REPORT_COLUMNS.every((req) => cols.some((c) => c.includes(req)));
}

// ---------------------------------------------------------------------------
// DownloadHistoryReport response classification
// ---------------------------------------------------------------------------

export type ReportClassification =
  | { kind: 'csv'; csv: string }
  | { kind: 'retry' }
  | { kind: 'error'; message: string };

function errorCodes(payload: unknown): number[] {
  const out: number[] = [];
  if (payload && typeof payload === 'object') {
    const p = payload as {
      error?: { code?: unknown };
      errors?: Array<{ code?: unknown } | null>;
    };
    if (p.error && typeof p.error.code === 'number') out.push(p.error.code);
    if (Array.isArray(p.errors)) {
      for (const e of p.errors) {
        if (e && typeof e.code === 'number') out.push(e.code);
      }
    }
  }
  return out;
}

function firstErrorMessage(payload: unknown): { code?: number; msg: string } {
  if (payload && typeof payload === 'object') {
    const p = payload as {
      error?: { code?: number; msg?: string };
      errors?: Array<{ code?: number; msg?: string } | null>;
    };
    if (p.error) return { code: p.error.code, msg: p.error.msg ?? 'API error' };
    const first = Array.isArray(p.errors) ? p.errors.find(Boolean) : undefined;
    if (first) return { code: first.code, msg: first.msg ?? 'API error' };
  }
  return { msg: 'API error' };
}

const REPORT_CONTENT_TYPES = ['text/csv', 'application/octet-stream', 'text/plain'];

// Decide whether a DownloadHistoryReport response is the CSV report, a
// still-generating "retry" (code 356), or a hard error. A JSON envelope is
// detected by Content-Type OR by the body starting with `{`/`[` (after stripping
// a BOM/leading whitespace) — so a JSON error is never mistaken for CSV. A
// non-JSON body must also carry a report-like Content-Type AND a report header.
export function classifyReportResponse(
  contentType: string,
  body: string,
): ReportClassification {
  const stripped = body.replace(/^\uFEFF/, '').replace(/^\s+/, '');
  const ct = contentType.toLowerCase();
  const ctJson = ct.includes('application/json');
  const looksJson = stripped.startsWith('{') || stripped.startsWith('[');

  if (ctJson || looksJson) {
    let payload: unknown;
    try {
      payload = JSON.parse(stripped);
    } catch {
      return {
        kind: 'error',
        message: 'DownloadHistoryReport returned malformed JSON',
      };
    }
    if (errorCodes(payload).includes(356)) return { kind: 'retry' };
    const p = payload as { error?: unknown; errors?: unknown[] };
    if (p.error || (Array.isArray(p.errors) && p.errors.length > 0)) {
      const { code, msg } = firstErrorMessage(payload);
      return {
        kind: 'error',
        message: `DownloadHistoryReport error${
          code != null ? ` (code ${code})` : ''
        }: ${msg}`,
      };
    }
    return {
      kind: 'error',
      message: 'DownloadHistoryReport returned JSON with no report body',
    };
  }

  const reportLike = ct === '' || REPORT_CONTENT_TYPES.some((t) => ct.includes(t));
  if (!reportLike) {
    return {
      kind: 'error',
      message: `DownloadHistoryReport returned unexpected Content-Type: ${contentType}`,
    };
  }
  if (stripped.length === 0) {
    return { kind: 'error', message: 'DownloadHistoryReport returned an empty body' };
  }
  if (!looksLikeReport(body)) {
    return {
      kind: 'error',
      message:
        'DownloadHistoryReport body is not a Voximplant call-history report (missing expected columns)',
    };
  }
  return { kind: 'csv', csv: body };
}

// ---------------------------------------------------------------------------
// Deadline-based report polling (IO injected)
// ---------------------------------------------------------------------------

export interface ReportPollDeps {
  getStatus: (id: number) => Promise<{ completed?: string | null } | undefined>;
  download: (
    id: number,
  ) => Promise<{ status: number; contentType: string; body: string }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export async function fetchReportWhenReady(
  historyReportId: number,
  opts: { timeoutSeconds: number; pollIntervalSeconds: number },
  deps: ReportPollDeps,
): Promise<string> {
  const deadline = deps.now() + opts.timeoutSeconds * 1000;
  const intervalMs = opts.pollIntervalSeconds * 1000;

  for (;;) {
    const row = await deps.getStatus(historyReportId);
    if (row?.completed) {
      const resp = await deps.download(historyReportId);
      const cls = classifyReportResponse(resp.contentType, resp.body);
      if (cls.kind === 'csv') {
        if (resp.status >= 400) {
          throw new CliError(`DownloadHistoryReport HTTP ${resp.status}`);
        }
        return cls.csv;
      }
      if (cls.kind === 'error') throw new CliError(cls.message);
      // kind === 'retry' → fall through to deadline check + sleep
    }
    if (deps.now() >= deadline) {
      throw new CliError(
        `report #${historyReportId} was not ready after ${opts.timeoutSeconds} seconds`,
      );
    }
    await deps.sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Atomic --output write (IO injected)
// ---------------------------------------------------------------------------

export interface AtomicWriteDeps {
  mkdirp: (dir: string) => void;
  exists: (p: string) => boolean;
  writeFile: (p: string, data: string) => void;
  rename: (from: string, to: string) => void;
  remove: (p: string) => void;
  dirname: (p: string) => string;
  basename: (p: string) => string;
  join: (...parts: string[]) => string;
}

// Derive the sibling temp path for an atomic write. `uniqueToken` MUST vary per
// run so concurrent writes to the same output never collide on the temp file.
export function tempPathFor(
  output: string,
  uniqueToken: string,
  deps: Pick<AtomicWriteDeps, 'dirname' | 'basename' | 'join'>,
): string {
  const dir = deps.dirname(output);
  return deps.join(dir, `.${deps.basename(output)}.${uniqueToken}.partial`);
}

// Write `csv` to `output` atomically: ensure the parent dir exists, refuse to
// clobber an existing file without `force`, write to a per-run temp file first,
// then rename into place. On any failure the temp file is removed.
export function writeReportAtomic(
  output: string,
  csv: string,
  opts: { force: boolean; uniqueToken: string },
  deps: AtomicWriteDeps,
): void {
  const dir = deps.dirname(output);
  deps.mkdirp(dir);
  if (deps.exists(output) && !opts.force) {
    throw new CliError(
      `refusing to overwrite existing file: ${output} (use --force)`,
    );
  }
  const tmp = tempPathFor(output, opts.uniqueToken, deps);
  try {
    deps.writeFile(tmp, csv);
    deps.rename(tmp, output);
  } catch (e) {
    try {
      if (deps.exists(tmp)) deps.remove(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// CSV summary (PII-free aggregate of a call-history report)
// ---------------------------------------------------------------------------

// Columns whose RAW value distribution is worth showing. We deliberately do NOT
// collapse these into a "successful/failed" verdict — the meaning of e.g.
// call_successful (yes/no/blank) is shown as-is for the operator to interpret.
const STATUS_COLUMN_HINTS = [
  'successful',
  'call_end_code',
  'call_end_details',
  'result',
  'status',
  'termination',
  'disconnect',
  'reason',
];

// Summarize a Voximplant call-history CSV into PII-free aggregate lines: row
// count, call_cost sum, date span, and the raw value distribution of status-like
// columns (no verdict). Uses the real CSV parser.
export function summarizeIntoLines(csv: string): string[] {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim().length > 0));
  if (rows.length === 0) return ['(empty report)'];
  const headerRaw = rows[0];
  const header = headerRaw.map((h) => h.trim().toLowerCase());
  const data = rows.slice(1);

  const out: string[] = [
    `columns     : ${header.length}`,
    `rows        : ${data.length}`,
  ];

  const costIdx = header.findIndex((h) => h.includes('call_cost'));
  if (costIdx !== -1) {
    let cost = 0;
    for (const r of data) cost += Number((r[costIdx] ?? '').trim()) || 0;
    out.push(`call_cost sum: $${cost.toFixed(4)}`);
  }

  const startIdx = header.findIndex((h) => h.includes('session_start_date'));
  if (startIdx !== -1 && data.length) {
    const dates = data
      .map((r) => (r[startIdx] ?? '').trim())
      .filter((d) => d.length > 0)
      .sort();
    if (dates.length) {
      out.push(`date span   : ${dates[0]}  …  ${dates[dates.length - 1]}`);
    }
  }

  const shown = new Set<number>();
  for (const hint of STATUS_COLUMN_HINTS) {
    for (let i = 0; i < header.length; i++) {
      if (shown.has(i) || !header[i].includes(hint)) continue;
      shown.add(i);
      const counts = new Map<string, number>();
      for (const r of data) {
        const raw = (r[i] ?? '').trim();
        const key = raw === '' ? '(empty)' : raw;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const dist = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      out.push(`${headerRaw[i].trim()}: ${dist}`);
    }
  }
  out.push('note: raw value distribution shown; column meaning is not assumed.');
  return out;
}

// ---------------------------------------------------------------------------
// Help (available without credentials)
// ---------------------------------------------------------------------------

const MAIN_HELP = `Voximplant Management API CLI

usage: npm run voximplant -- <command> [flags]

commands:
  account                    Show account identity + balance (read-only)
  rules [--app <id>]         List applications and one app's routing rules
  history <mode> [flags]     Fetch a call-history report (async → CSV)
  numbers                    List the account's phone numbers (read-only; find a Caller ID)
  transactions [--days <n>]  Billing ledger — what the balance is spent on (read-only)
  start <flags> --confirm    Fire ONE StartScenarios call (byte-cap probe; PLACES A REAL CALL)

history modes:
  --history-id <id>          Download an existing report by id
  --app <id> [--days <n>]    Create a new report (default days ${HISTORY_DEFAULTS.days}, max ${HISTORY_DEFAULTS.maxDays})

history flags:
  --output <file>            Write CSV to file (atomic; refuses overwrite)
  --force                    Allow --output to overwrite an existing file
  --timeout-seconds <n>      Poll deadline (default ${HISTORY_DEFAULTS.timeoutSeconds}, max ${HISTORY_DEFAULTS.maxTimeoutSeconds})
  --poll-interval-seconds <n> Poll interval (default ${HISTORY_DEFAULTS.pollIntervalSeconds})

start flags (manual byte-cap probe — PLACES A REAL CALL):
  --rule <id>                OutCall rule id bound to the RSVP scenario (StartScenarios)
  --to <number>             Single destination number to dial (embedded in script_custom_data)
  --from <number>           Optional caller id embedded in the payload
  --bytes <n>               Pad the synthetic script_custom_data to ~n UTF-8 bytes (max ${START_MAX_BYTES})
  --confirm                  REQUIRED interlock — without it 'start' refuses to run

global flags:
  --key <path>               Service-account JSON (default: env VOX_CI_CREDENTIALS or ./vox_ci_credentials.json)
  --help                     Show this help (no credentials required)`;

const HISTORY_HELP = `npm run voximplant -- history <mode> [flags]

modes (exactly one):
  --history-id <id>          Download an existing report by id
  --app <id> [--days <n>]    Create a new report for an application

flags:
  --output <file>            Write CSV to file (atomic; refuses overwrite without --force)
  --force                    Allow --output to overwrite
  --timeout-seconds <n>      Poll deadline in seconds (default ${HISTORY_DEFAULTS.timeoutSeconds})
  --poll-interval-seconds <n> Poll interval in seconds (default ${HISTORY_DEFAULTS.pollIntervalSeconds})`;

const START_HELP = `npm run voximplant -- start --rule <id> --to <number> [--from <number>] [--bytes <n>] --confirm

⚠ This PLACES A REAL OUTBOUND CALL via StartScenarios. It exists solely to probe
the script_custom_data byte cap. Requires account balance and explicit approval.
Nothing runs without --confirm.

flags:
  --rule <id>                OutCall rule id bound to the RSVP scenario (required)
  --to <number>             Single destination number to dial (required)
  --from <number>           Optional caller id embedded in the payload
  --bytes <n>               Pad synthetic script_custom_data to ~n UTF-8 bytes (max ${START_MAX_BYTES})
  --confirm                  REQUIRED interlock — without it 'start' refuses to run

After it returns a call_session_history_id, use:
  npm run voximplant -- history --app <id>
and inspect call_session_history_custom_data to see whether the full payload arrived.`;

export function helpText(command?: string): string {
  if (command === 'history') return HISTORY_HELP;
  if (command === 'start') return START_HELP;
  return MAIN_HELP;
}
