/**
 * Voximplant Management API — in-repo CLI runner (thin wiring over cli-support).
 *
 * ONE committed entry point for ad-hoc Management API READS, reusing
 * src/lib/voximplant/core.ts (the same JWT+fetch the Next server uses).
 * Run from the repo root via the `voximplant` npm script (tsx):
 *
 *   npm run voximplant -- --help
 *   npm run voximplant -- account
 *   npm run voximplant -- rules --application-id <id>
 *   npm run voximplant -- history --app <id> [--days 120 | --from d --to d] [--output file.csv]
 *   npm run voximplant -- call-lists [--list-id <n>] [--days <n>]
 *   npm run voximplant -- media-resources           (no credentials needed)
 *   npm run voximplant -- audit [--days <n>] [--count <n>]
 *
 * Credentials path resolution (first match wins): `--credentials`/`--key <path>`,
 * env VOXIMPLANT_CREDENTIALS_FILE, env VOX_CI_CREDENTIALS, ./vox_ci_credentials.json
 * (all gitignored). The private key is only ever read from disk — never printed.
 *
 * READ-ONLY BY DESIGN (owner directive): this CLI imports src/lib/voximplant/core
 * only. The mutating wrappers live in src/lib/voximplant/mutations.ts, which this
 * file must NEVER import — a guard test (cli-guard.test.ts) pins that, so no
 * terminal command can place a call or change account state.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { VoximplantConfig } from '../../src/lib/voximplant/core';
import {
  downloadHistoryReportRaw,
  downloadSecureUrl,
  getAccountInfo,
  getAutochargeConfig,
  getApplications,
  getAuditLog,
  getCallHistory,
  getCallHistoryAsync,
  getCallListDetails,
  getCallLists,
  getHistoryReports,
  getMediaResources,
  getPhoneNumbers,
  getUsers,
  getRules,
  getTransactionHistory,
  voxRetry,
  VoximplantApiError,
  type TransactionInfo,
} from '../../src/lib/voximplant/core';
import {
  assertKnownCommand,
  CliError,
  collectAllPages,
  fetchReportWhenReady,
  helpText,
  normalizeAliases,
  parseArgs,
  positiveInt,
  resolveAuditPlan,
  resolveCallListsPlan,
  resolveHistoryPlan,
  resolveKeyPath,
  resolveRecordingPlan,
  resolveLogPlan,
  summarizeIntoLines,
  validateCommandFlags,
  writeReportAtomic,
  type FlagValue,
  type HistoryPlan,
  type KnownCommand,
} from '../../src/lib/voximplant/cli-support';
import {
  extractIpStrings,
  normalizeAuditEntry,
  normalizeCallList,
  normalizeCallListTask,
} from '../../src/lib/validation/vox-payloads';

const DEFAULT_KEY = 'vox_ci_credentials.json';

// Retry wrapper for READ-ONLY calls (bounded backoff on 429/340/515, one JWT
// renewal on 456). Everything this CLI can run is read-only.
const retried = <T>(run: () => Promise<T>): Promise<T> => voxRetry(run);

function loadConfig(flags: Record<string, FlagValue>): VoximplantConfig {
  const keyPath = resolveKeyPath(
    flags,
    process.env.VOXIMPLANT_CREDENTIALS_FILE ?? process.env.VOX_CI_CREDENTIALS,
    DEFAULT_KEY,
  );
  const raw = JSON.parse(readFileSync(keyPath, 'utf8')) as {
    account_id: number | string;
    key_id: string;
    private_key: string;
  };
  return {
    accountId: raw.account_id,
    keyId: raw.key_id,
    privateKey: raw.private_key,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A per-run, per-write unique token so concurrent --output writes never collide.
let writeCounter = 0;
const uniqueToken = () => `${process.pid}-${Date.now()}-${writeCounter++}`;

async function cmdAccount(cfg: VoximplantConfig): Promise<void> {
  const { result: a } = await retried(() => getAccountInfo(cfg));
  console.log(`account_id    : ${a.account_id}`);
  console.log(`account_name  : ${a.account_name}`);
  console.log(`account_email : ${a.account_email}`);
  console.log(`active        : ${a.active}`);
  console.log(`currency      : ${a.currency}`);
  console.log(`balance       : ${a.balance}`);
  console.log(`created       : ${a.created}`);
}

// READ-ONLY: what automatic top-up support configured on this account. No public
// setter was found, and support configures it by ticket — but note this method is
// itself missing from the public Accounts index while being live, so that index
// is not evidence a setter is absent.
//
// Prints every returned field verbatim. Four are typed in AutochargeConfig from a
// live response; the result type publishes no exhaustive list, so filtering to an
// assumed shape would hide whatever else is actually there.
async function cmdAutocharge(cfg: VoximplantConfig): Promise<void> {
  const res = await retried(() => getAutochargeConfig(cfg));
  const r = res.result;
  if (!r || typeof r !== 'object') {
    console.log('autocharge    : (no config returned)');
    return;
  }
  for (const [k, v] of Object.entries(r)) {
    console.log(`${k.padEnd(22)}: ${v === null ? '(null)' : String(v)}`);
  }
}

// READ-ONLY: list the account's phone numbers so an operator can pick a Caller ID.
// Never purchases/attaches/modifies a number; prints no credentials or secrets.
async function cmdNumbers(cfg: VoximplantConfig): Promise<void> {
  const { result, total_count } = await retried(() => getPhoneNumbers(cfg));
  console.log(`phone numbers : ${total_count}`);
  if (result.length === 0) {
    console.log(
      '  (none — a Caller ID number must be purchased/verified before outbound calls)',
    );
    return;
  }
  for (const n of result) {
    const status = n.deactivated
      ? 'deactivated'
      : n.can_be_used === false
        ? 'unusable'
        : 'active';
    console.log(`  ${n.phone_number}`);
    console.log(`    phone_id       : ${n.phone_id}`);
    if (n.phone_name) console.log(`    phone_name     : ${n.phone_name}`);
    console.log(`    country        : ${n.phone_country_code ?? '—'}`);
    console.log(`    status         : ${status}`);
    console.log(`    application_id : ${n.application_id ?? '—'}`);
    console.log(`    rule_id        : ${n.rule_id ?? '—'}`);
  }
}

// READ-ONLY: the account's SDK/SIP users. Answers the one question our own
// database cannot: whether a console agent's `vox_username` corresponds to a
// user that actually exists on Voximplant. A name stored here with no user there
// fails only at the app's login, with nothing on our side to see.
async function cmdUsers(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  // Users are scoped PER APPLICATION — GetUsers rejects a call without
  // application_id — so walk the applications unless one was named.
  const only = flags.app !== undefined ? positiveInt('app', flags.app) : undefined;
  const apps = await retried(() => getApplications(cfg));
  const targets = only
    ? apps.result.filter((a) => a.application_id === only)
    : apps.result;
  if (targets.length === 0) {
    console.log(only ? `no such application: ${only}` : 'no applications on the account');
    return;
  }
  let total = 0;
  for (const app of targets) {
    const { result } = await retried(() =>
      getUsers(cfg, app.application_id),
    );
    console.log(`=== ${app.application_name} (app_id=${app.application_id}) — ${result.length} user(s)`);
    total += result.length;
    for (const u of result) {
      console.log(`  ${u.user_name}`);
      console.log(`    user_id : ${u.user_id}`);
      if (u.user_display_name) console.log(`    display : ${u.user_display_name}`);
      console.log(`    active  : ${u.user_active}`);
    }
  }
  if (total === 0) {
    console.log('(no SDK/SIP users anywhere — no console agent can log in yet)');
  }
}

// READ-ONLY: what the account balance is spent on. Summarizes the billing ledger
// by transaction type over a --days window (default 90). Never charges/refunds.
async function cmdTransactions(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const days = flags.days ? positiveInt('days', flags.days, { max: 365 }) : 90;
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // Management API wants "YYYY-MM-DD HH:MM:SS" (UTC is accepted).
  const fmt = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');
  const type = typeof flags.type === 'string' ? flags.type : undefined;

  // Paginate through the FULL window so the summary reflects EVERY transaction,
  // not just the first page (collectAllPages caps at maxRows as a backstop).
  let timezone: string | null | undefined;
  const { rows: result, totalCount: total_count } = await collectAllPages<TransactionInfo>(
    async (offset, count) => {
      const page = await retried(() =>
        getTransactionHistory(cfg, {
          from_date: fmt(from),
          to_date: fmt(now),
          transaction_type: type,
          count,
          offset,
        }),
      );
      timezone = page.timezone;
      return page;
    },
    { pageSize: 1000, maxRows: 100_000 },
  );

  console.log(
    `transactions (last ${days}d${type ? `, type=${type}` : ''}): ${total_count} total, ${result.length} aggregated${timezone ? `  [tz ${timezone}]` : ''}`,
  );

  // Net spend grouped by type (most-spent first). Charges are negative amounts.
  const byType = new Map<string, { sum: number; count: number }>();
  for (const t of result) {
    const e = byType.get(t.transaction_type) ?? { sum: 0, count: 0 };
    e.sum += t.amount;
    e.count += 1;
    byType.set(t.transaction_type, e);
  }
  console.log('by type (net amount, count):');
  for (const [t, e] of [...byType.entries()].sort((a, b) => a[1].sum - b[1].sum)) {
    console.log(`  ${t.padEnd(30)} ${e.sum.toFixed(4)}  (${e.count})`);
  }

  console.log('recent:');
  for (const t of result.slice(0, 25)) {
    console.log(
      `  ${t.performed_at}  ${t.transaction_type.padEnd(26)} ${t.amount.toFixed(4)}  ${t.transaction_description ?? ''}`,
    );
  }
}

async function cmdRules(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const appId =
    flags.app !== undefined ? positiveInt('app', flags.app) : undefined;
  const apps = await retried(() => getApplications(cfg));
  console.log('=== APPLICATIONS ===');
  for (const a of apps.result) {
    console.log(`app_id=${a.application_id}  name=${a.application_name}`);
  }
  const target = appId
    ? apps.result.find((a) => a.application_id === appId)
    : apps.result[0];
  if (!target) {
    console.log('(no application to list rules for)');
    return;
  }
  console.log(
    `\n=== RULES for app_id=${target.application_id} (${target.application_name}) ===`,
  );
  const rules = await retried(() => getRules(cfg, target.application_id));
  for (const r of rules.result) {
    const sc = (r.scenarios ?? [])
      .map((s) => `${s.scenario_name}(#${s.scenario_id})`)
      .join(', ');
    console.log(
      `rule_id=${r.rule_id}  name=${r.rule_name}  pattern=${r.rule_pattern}  scenarios=[${sc}]`,
    );
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtUTC = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

function pollDeps(cfg: VoximplantConfig) {
  return {
    getStatus: async (id: number) => {
      const st = await retried(() => getHistoryReports(cfg, id));
      return st.result[0];
    },
    download: (id: number) => retried(() => downloadHistoryReportRaw(cfg, id)),
    now: () => Date.now(),
    sleep,
  };
}

function emit(csv: string, plan: HistoryPlan): void {
  if (plan.output) {
    writeReportAtomic(
      plan.output,
      csv,
      { force: plan.force, uniqueToken: uniqueToken() },
      {
        mkdirp: (dir) => {
          if (dir) mkdirSync(dir, { recursive: true });
        },
        exists: existsSync,
        writeFile: writeFileSync,
        rename: renameSync,
        remove: unlinkSync,
        dirname,
        basename,
        join,
      },
    );
    const rows = csv.split(/\r?\n/).filter((l) => l.length > 0).length - 1;
    console.log(
      `wrote ${Buffer.byteLength(csv)} bytes (${Math.max(rows, 0)} rows) → ${plan.output}`,
    );
  } else {
    for (const line of summarizeIntoLines(csv)) console.log(line);
  }
}

async function cmdHistory(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const plan = resolveHistoryPlan(flags);
  const opts = {
    timeoutSeconds: plan.timeoutSeconds,
    pollIntervalSeconds: plan.pollIntervalSeconds,
  };

  let reportId: number;
  if (plan.mode === 'existing') {
    reportId = plan.historyReportId;
    console.log(`=== history report #${reportId} ===`);
  } else {
    // Explicit --from/--to window when given; otherwise a --days lookback.
    let fromStr: string;
    let toStr: string;
    if (plan.fromDate !== undefined && plan.toDate !== undefined) {
      fromStr = plan.fromDate;
      toStr = plan.toDate;
    } else {
      const to = new Date();
      const from = new Date(to.getTime() - plan.days * 24 * 3600 * 1000);
      fromStr = fmtUTC(from);
      toStr = fmtUTC(to);
    }
    const start = await retried(() =>
      getCallHistoryAsync(cfg, {
        from_date: fromStr,
        to_date: toStr,
        application_id: plan.applicationId,
        with_calls: true,
        with_records: true,
        output: 'csv',
        timezone: 'UTC',
      }),
    );
    if (!start.history_report_id) {
      throw new CliError('GetCallHistoryAsync returned no history_report_id');
    }
    reportId = start.history_report_id;
    console.log(
      `queued report #${reportId} for ${fromStr} .. ${toStr} UTC — polling…`,
    );
  }

  const csv = await fetchReportWhenReady(reportId, opts, pollDeps(cfg));
  emit(csv, plan);
}

// READ-ONLY: resolve a call's secure recording URL (sync GetCallHistory) and save
// it as an mp3. The secure URL 401s to an anonymous GET, so downloadSecureUrl signs
// the Management-API JWT. Never places a call; never logs the token.
async function cmdRecording(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const plan = resolveRecordingPlan(flags);
  const to = new Date();
  const from = new Date(to.getTime() - plan.days * 24 * 3600 * 1000);
  const hist = await retried(() =>
    getCallHistory(cfg, {
      from_date: fmtUTC(from),
      to_date: fmtUTC(to),
      call_session_history_id: plan.sessionId,
      with_records: true,
    }),
  );
  const url = (hist.result ?? [])
    .flatMap((s) => s.records ?? [])
    .map((r) => r.record_url)
    .find((u): u is string => typeof u === 'string' && u.length > 0);
  if (!url) {
    throw new CliError(
      `no recording found for session ${plan.sessionId} (within ${plan.days}d). ` +
        'The call may have ended before recording started, or the window is too small (--days).',
    );
  }
  console.log(`=== recording for session ${plan.sessionId} ===`);
  const buf = await downloadSecureUrl(cfg, url);
  writeFileSync(plan.output, buf);
  console.log(`saved ${buf.length} bytes → ${plan.output}`);
}

// Download a session's scenario LOG (everything Logger.write emitted during the
// call). Like a recording, the URL 401s to an anonymous GET, so downloadSecureUrl
// signs it with the Management-API JWT.
//
// This is the only way to see what a scenario actually did: which branches ran,
// which client tools fired, whether a command sent to the live session was
// applied. The scenario cannot report that anywhere else — AppEvents.HttpRequest
// has no response channel.
//
// CONTAINS GUEST CONTENT. A scenario logs what it chooses to, and the RSVP flows
// log transcript lines. Treat a downloaded log as personal data: do not paste it
// into an issue, and delete it when done.
async function cmdLog(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const plan = resolveLogPlan(flags);
  const to = new Date();
  const from = new Date(to.getTime() - plan.days * 24 * 3600 * 1000);
  const hist = await retried(() =>
    getCallHistory(cfg, {
      from_date: fmtUTC(from),
      to_date: fmtUTC(to),
      call_session_history_id: plan.sessionId,
      with_other_resources: true,
    }),
  );
  const url = (hist.result ?? [])
    .map((s) => (s as { log_file_url?: string | null }).log_file_url)
    .find((u): u is string => typeof u === 'string' && u.length > 0);
  if (!url) {
    throw new CliError(
      `no log found for session ${plan.sessionId} (within ${plan.days}d). ` +
        'Logs appear a short while after the session ends; widen --days or retry.',
    );
  }
  console.log(`=== session log for ${plan.sessionId} ===`);
  const buf = await downloadSecureUrl(cfg, url);
  writeFileSync(plan.output, buf);
  console.log(`saved ${buf.length} bytes → ${plan.output}`);
}

// READ-ONLY (A1): observe server-side dialing campaigns. Output is PII-safe by
// construction — rows pass through normalizeCallList/Task, which reduce
// custom_data/result_data to {present, bytes} metadata.
async function cmdCallLists(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const plan = resolveCallListsPlan(flags);
  const to = new Date();
  const from = new Date(to.getTime() - plan.days * 24 * 3600 * 1000);
  const res = await retried(() =>
    getCallLists(cfg, {
      ...(plan.listId !== undefined
        ? { list_id: plan.listId }
        : { from_date: fmtUTC(from), to_date: fmtUTC(to) }),
      count: 100,
    }),
  );
  const lists = (res.result ?? []).map(normalizeCallList);
  console.log(
    `call lists: ${res.total_count ?? lists.length} total, showing ${lists.length}${plan.listId === undefined ? ` (window ${plan.days}d)` : ''}`,
  );
  if (lists.length === 0) {
    console.log('  (none — the CallList track is not in use yet)');
    return;
  }
  for (const l of lists) {
    console.log(
      `  #${l.listId ?? '?'}  ${l.name ?? '(unnamed)'}  status=${l.status}  attempts=${l.numAttempts ?? '—'}  max_sim=${l.maxSimultaneous ?? '—'}  submitted=${l.submittedAt ?? '—'}  completed=${l.completedAt ?? '—'}`,
    );
  }
  if (plan.listId !== undefined) {
    const listId = plan.listId;
    const det = await retried(() => getCallListDetails(cfg, listId));
    const tasks = (det.result ?? []).map(normalizeCallListTask);
    const byStatus = new Map<string, number>();
    for (const t of tasks) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    console.log(`  tasks: ${det.total_count ?? tasks.length} total, ${tasks.length} fetched`);
    console.log(
      `  by status: ${[...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`,
    );
    const withResult = tasks.filter((t) => t.resultData.present).length;
    console.log(`  result_data present: ${withResult}/${tasks.length} (content withheld — PII)`);
  }
}

// A2: Voximplant IP inventory for the IONOS firewall allowlist. PUBLIC endpoint —
// runs with no credentials at all (dispatched before loadConfig).
async function cmdMediaResources(): Promise<void> {
  const raw = await getMediaResources({ with_jsservers: true });
  const ips = extractIpStrings(raw);
  console.log(`jsservers (scenario-origin IPs for the firewall allowlist): ${ips.length}`);
  for (const ip of ips) console.log(`  ${ip}`);
  if (ips.length === 0) {
    console.log('  (no IP strings recognized in the response — inspect manually)');
  }
}

// READ-ONLY (A3): account audit log. GetAuditLog is Owner-only per the docs —
// with the service-account key expect a clean degraded message, not a crash.
async function cmdAudit(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const plan = resolveAuditPlan(flags);
  const to = new Date();
  const from = new Date(to.getTime() - plan.days * 24 * 3600 * 1000);
  let res;
  try {
    res = await retried(() =>
      getAuditLog(cfg, {
        from_date: fmtUTC(from),
        to_date: fmtUTC(to),
        count: plan.count,
      }),
    );
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      console.log(
        `audit log unavailable with this key (API code ${e.code ?? '?'}). ` +
          'GetAuditLog is Owner-only — use an owner-level key or the control panel.',
      );
      return;
    }
    throw e;
  }
  const entries = (res.result ?? []).map(normalizeAuditEntry);
  console.log(
    `audit entries (last ${plan.days}d): ${res.total_count ?? entries.length} total, showing ${entries.length}`,
  );
  for (const e of entries) {
    console.log(`  ${e.at ?? '—'}  ${e.command ?? '?'}  actor=${e.actorType}  ip=${e.ipMasked ?? '—'}`);
  }
}

async function dispatch(
  command: KnownCommand,
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  switch (command) {
    case 'account':
      return cmdAccount(cfg);
    case 'autocharge':
      return cmdAutocharge(cfg);
    case 'rules':
      return cmdRules(cfg, flags);
    case 'history':
      return cmdHistory(cfg, flags);
    case 'numbers':
      return cmdNumbers(cfg);
    case 'users':
      return cmdUsers(cfg, flags);
    case 'transactions':
      return cmdTransactions(cfg, flags);
    case 'recording':
      return cmdRecording(cfg, flags);
    case 'log':
      return cmdLog(cfg, flags);
    case 'call-lists':
      return cmdCallLists(cfg, flags);
    case 'audit':
      return cmdAudit(cfg, flags);
    case 'media-resources':
      // handled before loadConfig in main() — unreachable here
      return cmdMediaResources();
  }
}

async function main(): Promise<void> {
  const { command, flags: rawFlags } = parseArgs(process.argv.slice(2));
  // Canonicalize aliases (--credentials→--key, --application-id→--app) BEFORE
  // validation so every downstream consumer sees one canonical flag name.
  const flags = normalizeAliases(rawFlags);

  // --help and the no-command case must work WITHOUT credentials.
  if (flags.help === true) {
    console.log(helpText(command)); // command may be undefined → main help
    return;
  }
  if (command === undefined) {
    console.log(helpText());
    process.exitCode = 1;
    return;
  }

  // Validate the command + its flags BEFORE touching credentials, so an unknown
  // command / bad flag fails cleanly even with no key present.
  assertKnownCommand(command);
  validateCommandFlags(command, flags);

  // media-resources is a PUBLIC endpoint — no credentials required.
  if (command === 'media-resources') {
    await cmdMediaResources();
    return;
  }

  const cfg = loadConfig(flags);
  await dispatch(command, cfg, flags);
}

main().catch((e: unknown) => {
  if (e instanceof CliError) {
    console.error(`ERROR: ${e.message}`);
  } else {
    console.error('ERROR:', e instanceof Error ? e.message : String(e));
  }
  process.exitCode = 1;
});
