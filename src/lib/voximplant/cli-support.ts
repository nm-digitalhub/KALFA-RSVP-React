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
  'credentials', // alias of --key
  'help',
  'app',
  'application-id', // alias of --app
  'days',
  'history-id',
  'output',
  'force',
  'timeout-seconds',
  'poll-interval-seconds',
  'type', // transactions: transaction_type filter
  // `history` accepts --from/--to as an explicit UTC date window.
  'to',
  'from',
  'session',
  'list-id', // call-lists: single-list filter
  'count', // audit: page size
]);

// Flag aliases, normalized immediately after parsing so every downstream
// consumer (per-command validation, plans, loadConfig) sees ONE canonical name.
const FLAG_ALIASES: Record<string, string> = {
  credentials: 'key',
  'application-id': 'app',
};

// Rewrite alias flags to their canonical names. Passing both the alias and its
// canonical form is ambiguous and rejected (same rule as a duplicate flag).
export function normalizeAliases(
  flags: Record<string, FlagValue>,
): Record<string, FlagValue> {
  const out: Record<string, FlagValue> = {};
  for (const [name, value] of Object.entries(flags)) {
    const canonical = FLAG_ALIASES[name] ?? name;
    if (canonical in out) {
      throw new CliError(
        `duplicate flag: --${canonical} was given more than once (alias)`,
      );
    }
    out[canonical] = value;
  }
  return out;
}

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

// READ-ONLY command set (owner directive): the CLI can never mutate Voximplant
// state — `start` was removed with the mutations split (the server dispatcher
// is the only dial path) and a guard test pins this list.
export const KNOWN_COMMANDS = ['account', 'autocharge', 'rules', 'history', 'numbers', 'transactions', 'recording', 'log', 'call-lists', 'media-resources', 'audit'] as const;
export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

export function assertKnownCommand(command: string): asserts command is KnownCommand {
  if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) {
    throw new CliError(`unknown command: ${command}`);
  }
}

const ALLOWED_FLAGS: Record<KnownCommand, Set<string>> = {
  account: new Set(['key']),
  autocharge: new Set(['key']),
  rules: new Set(['key', 'app']),
  history: new Set([
    'key',
    'app',
    'days',
    'from',
    'to',
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
  // READ-ONLY: fetch a call's secure recording by session id → save an mp3.
  // Never places a call or modifies anything; only --key + which session/output.
  recording: new Set(['key', 'session', 'output', 'days']),
  // Same shape as `recording`: both fetch a session asset whose URL 401s to an
  // anonymous GET and is signed with the Management-API JWT.
  log: new Set(['key', 'session', 'output', 'days']),
  // READ-ONLY: observe server-side dialing campaigns (A1). PII-safe output only.
  'call-lists': new Set(['key', 'list-id', 'days']),
  // Public firewall-allowlist inventory (A2) — needs NO credentials at all.
  'media-resources': new Set([]),
  // READ-ONLY account audit log (A3). Owner-role-only per docs — prints a clean
  // degraded message when the service-account key is refused.
  audit: new Set(['key', 'days', 'count']),
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

// Validate a UTC date/datetime flag: `YYYY-MM-DD` (normalized to midnight) or
// `YYYY-MM-DD HH:MM:SS`. Returns the Management-API form "YYYY-MM-DD HH:MM:SS".
export function utcDateTime(name: string, v: FlagValue | undefined): string {
  const s = requireStringValue(name, v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(s);
  if (!m) {
    throw new CliError(
      `--${name} must be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" (UTC), got "${s}"`,
    );
  }
  const normalized = m[4] !== undefined ? s : `${s} 00:00:00`;
  const parsed = Date.parse(`${normalized.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed)) {
    throw new CliError(`--${name} is not a real date: "${s}"`);
  }
  // Round-trip guard: rejects e.g. 2026-02-30 which Date.parse would roll over.
  const rt = new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
  if (rt !== normalized) {
    throw new CliError(`--${name} is not a real date: "${s}"`);
  }
  return normalized;
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
  | ({
      mode: 'create';
      applicationId: number;
      // EITHER a --days lookback (window computed at run time) OR an explicit
      // --from/--to UTC window (both normalized "YYYY-MM-DD HH:MM:SS").
      days: number;
      fromDate?: string;
      toDate?: string;
    } & HistoryOutputPlan);

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
  const hasWindow = flags.from !== undefined || flags.to !== undefined;
  const hasCreate = flags.app !== undefined || flags.days !== undefined || hasWindow;
  if (hasExisting && hasCreate) {
    throw new CliError(
      'choose ONE mode: --history-id <id> (existing) OR --app <id> [--days n | --from/--to] (new report)',
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
    if (hasWindow) {
      if (flags.days !== undefined) {
        throw new CliError('choose ONE window: --days n OR --from/--to');
      }
      if (flags.from === undefined || flags.to === undefined) {
        throw new CliError('--from and --to must be given together');
      }
      const fromDate = utcDateTime('from', flags.from);
      const toDate = utcDateTime('to', flags.to);
      if (fromDate >= toDate) {
        throw new CliError('--from must be earlier than --to');
      }
      return {
        mode: 'create',
        applicationId: positiveInt('app', flags.app),
        days: HISTORY_DEFAULTS.days, // unused when an explicit window is set
        fromDate,
        toDate,
        ...common,
      };
    }
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
    'history requires either --history-id <id> or --app <id> [--days n | --from/--to]',
  );
}

// ---------------------------------------------------------------------------
// call-lists / audit command plans (A1 + A3)
// ---------------------------------------------------------------------------
// The former `start` command (live-dial byte-cap probe) was REMOVED with the
// read-only/mutations split — the server dispatcher is the only dial path.

export interface CallListsPlan {
  listId?: number;
  days: number;
}

export function resolveCallListsPlan(flags: Record<string, FlagValue>): CallListsPlan {
  return {
    listId:
      flags['list-id'] !== undefined ? positiveInt('list-id', flags['list-id']) : undefined,
    days:
      flags.days !== undefined ? positiveInt('days', flags.days, { max: 365 }) : 30,
  };
}

export interface AuditPlan {
  days: number;
  count: number;
}

export function resolveAuditPlan(flags: Record<string, FlagValue>): AuditPlan {
  return {
    days: flags.days !== undefined ? positiveInt('days', flags.days, { max: 365 }) : 30,
    count:
      flags.count !== undefined ? positiveInt('count', flags.count, { max: 1000 }) : 50,
  };
}

// ---------------------------------------------------------------------------
// recording command plan — fetch a call's secure recording by session id
// ---------------------------------------------------------------------------

export interface RecordingPlan {
  sessionId: number;
  output: string;
  days: number; // lookback window for the GetCallHistory query (default 7)
}

// Validate the `recording` arguments. READ-ONLY — never places a call.
export function resolveRecordingPlan(flags: Record<string, FlagValue>): RecordingPlan {
  const sessionId = positiveInt('session', flags.session);
  const output =
    flags.output !== undefined
      ? requireStringValue('output', flags.output)
      : `recording-${sessionId}.mp3`;
  const days =
    flags.days !== undefined ? positiveInt('days', flags.days, { max: 120 }) : 7;
  return { sessionId, output, days };
}

// The session LOG (scenario Logger.write output), same resolution as a recording
// but defaulting to a .log filename.
export function resolveLogPlan(flags: Record<string, FlagValue>): RecordingPlan {
  const sessionId = positiveInt('session', flags.session);
  const output =
    flags.output !== undefined
      ? requireStringValue('output', flags.output)
      : `session-${sessionId}.log`;
  const days =
    flags.days !== undefined ? positiveInt('days', flags.days, { max: 120 }) : 7;
  return { sessionId, output, days };
}

// ---------------------------------------------------------------------------
// Offset pagination (IO injected)
// ---------------------------------------------------------------------------

export interface PageResult<T> {
  result: T[];
  total_count: number;
}

// Collect ALL rows of an offset-paginated Management API listing. Stops when a
// page comes back empty, when `total_count` rows were gathered, or at the
// `maxRows` safety backstop (guards against an API that keeps returning rows).
export async function collectAllPages<T>(
  fetchPage: (offset: number, count: number) => Promise<PageResult<T>>,
  opts: { pageSize: number; maxRows: number },
): Promise<{ rows: T[]; totalCount: number }> {
  const rows: T[] = [];
  let totalCount = 0;
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, opts.pageSize);
    totalCount = page.total_count;
    rows.push(...page.result);
    offset += page.result.length;
    if (
      page.result.length === 0 ||
      rows.length >= totalCount ||
      rows.length >= opts.maxRows
    ) {
      return { rows, totalCount };
    }
  }
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

commands (ALL read-only — the CLI cannot mutate Voximplant state):
  account                    Show account identity + balance
  rules [--app <id>]         List applications and one app's routing rules
  history <mode> [flags]     Fetch a call-history report (async → CSV)
  numbers                    List the account's phone numbers (find a Caller ID)
  transactions [--days <n>]  Billing ledger — what the balance is spent on
  recording --session <id>   Download a call's secure recording as mp3
  log --session <id>         Download a call's scenario log (Logger.write output)
  call-lists [--list-id <n>] [--days <n>]  Observe dialing campaigns (PII-safe aggregates)
  media-resources            Voximplant IP inventory for the firewall allowlist (no credentials)
  audit [--days <n>] [--count <n>]  Account audit log (Owner-only; degrades cleanly)

history modes:
  --history-id <id>          Download an existing report by id
  --app <id> [--days <n>]    Create a new report (default days ${HISTORY_DEFAULTS.days}, max ${HISTORY_DEFAULTS.maxDays})
  --app <id> --from <d> --to <d>  Explicit UTC window ("YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS")

history flags:
  --output <file>            Write CSV to file (atomic; refuses overwrite)
  --force                    Allow --output to overwrite an existing file
  --timeout-seconds <n>      Poll deadline (default ${HISTORY_DEFAULTS.timeoutSeconds}, max ${HISTORY_DEFAULTS.maxTimeoutSeconds})
  --poll-interval-seconds <n> Poll interval (default ${HISTORY_DEFAULTS.pollIntervalSeconds})

global flags:
  --credentials <path>       Service-account JSON (alias: --key). Default: env
                             VOXIMPLANT_CREDENTIALS_FILE, then VOX_CI_CREDENTIALS,
                             then ./vox_ci_credentials.json
  --application-id <id>      Alias of --app (rules / history)
  --help                     Show this help (no credentials required)

Management-API calls retry automatically on 429 / API 340 / API 515 (bounded
backoff) and renew the JWT once on API 456.`;

const HISTORY_HELP = `npm run voximplant -- history <mode> [flags]

modes (exactly one):
  --history-id <id>          Download an existing report by id
  --app <id> [--days <n>]    Create a new report for an application
  --app <id> --from <d> --to <d>  Explicit UTC window ("YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS");
                             --application-id is accepted as an alias of --app

flags:
  --output <file>            Write CSV to file (atomic; refuses overwrite without --force)
  --force                    Allow --output to overwrite
  --timeout-seconds <n>      Poll deadline in seconds (default ${HISTORY_DEFAULTS.timeoutSeconds})
  --poll-interval-seconds <n> Poll interval in seconds (default ${HISTORY_DEFAULTS.pollIntervalSeconds})`;

const RECORDING_HELP = `npm run voximplant -- recording --session <id> [--output file.mp3] [--days <n>]

Downloads a call's secure recording (voxdata-*-rec-secure) as an mp3. READ-ONLY —
never places a call. The recording is fetched with the Management-API JWT (the
secure URL 401s to an anonymous GET).

flags:
  --session <id>            call_session_history_id (required; from call history)
  --output <file>           Output mp3 path (default: recording-<session>.mp3)
  --days <n>                Lookback window for the history lookup (default 7, max 120)`;

export function helpText(command?: string): string {
  if (command === 'history') return HISTORY_HELP;
  if (command === 'recording') return RECORDING_HELP;
  return MAIN_HELP;
}
