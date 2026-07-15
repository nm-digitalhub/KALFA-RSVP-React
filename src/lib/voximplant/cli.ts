/**
 * Voximplant Management API — in-repo CLI runner (thin wiring over ./cli-support).
 *
 * ONE committed entry point for ad-hoc Management API calls, reusing ./core (the
 * same JWT+fetch the Next server uses) instead of hand-rolling throwaway scripts.
 * Run from the repo root via the `voximplant` npm script (tsx):
 *
 *   npm run voximplant -- --help
 *   npm run voximplant -- account
 *   npm run voximplant -- rules --app <applicationId>
 *   npm run voximplant -- history --app <id> [--days 120] [--output file.csv]
 *   npm run voximplant -- history --history-id <id> [--output file.csv] [--force]
 *   npm run voximplant -- start --rule <id> --to <number> [--bytes n] --confirm  (PLACES A REAL CALL)
 *
 * Credentials: `--key <path>`, env VOX_CI_CREDENTIALS, or ./vox_ci_credentials.json
 * (all gitignored). The private key is only ever read from disk — never printed.
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
import type { VoximplantConfig } from './core';
import {
  downloadHistoryReportRaw,
  downloadSecureUrl,
  getAccountInfo,
  getApplications,
  getCallHistory,
  getCallHistoryAsync,
  getHistoryReports,
  getPhoneNumbers,
  getRules,
  getTransactionHistory,
  startScenarios,
  type TransactionInfo,
} from './core';
import {
  assertKnownCommand,
  buildStartCustomData,
  CliError,
  fetchReportWhenReady,
  helpText,
  parseArgs,
  positiveInt,
  resolveHistoryPlan,
  resolveKeyPath,
  resolveRecordingPlan,
  resolveStartPlan,
  summarizeIntoLines,
  validateCommandFlags,
  writeReportAtomic,
  type FlagValue,
  type HistoryPlan,
  type KnownCommand,
} from './cli-support';

const DEFAULT_KEY = 'vox_ci_credentials.json';

function loadConfig(flags: Record<string, FlagValue>): VoximplantConfig {
  const keyPath = resolveKeyPath(flags, process.env.VOX_CI_CREDENTIALS, DEFAULT_KEY);
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
  const { result: a } = await getAccountInfo(cfg);
  console.log(`account_id    : ${a.account_id}`);
  console.log(`account_name  : ${a.account_name}`);
  console.log(`account_email : ${a.account_email}`);
  console.log(`active        : ${a.active}`);
  console.log(`currency      : ${a.currency}`);
  console.log(`balance       : ${a.balance}`);
  console.log(`created       : ${a.created}`);
}

// READ-ONLY: list the account's phone numbers so an operator can pick a Caller ID.
// Never purchases/attaches/modifies a number; prints no credentials or secrets.
async function cmdNumbers(cfg: VoximplantConfig): Promise<void> {
  const { result, total_count } = await getPhoneNumbers(cfg);
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
  // not just the first page. PAGE is the per-request cap; MAX_ROWS is a safety
  // backstop against an unbounded loop.
  const PAGE = 1000;
  const MAX_ROWS = 100_000;
  const result: TransactionInfo[] = [];
  let total_count = 0;
  let timezone: string | null | undefined;
  let offset = 0;
  for (;;) {
    const page = await getTransactionHistory(cfg, {
      from_date: fmt(from),
      to_date: fmt(now),
      transaction_type: type,
      count: PAGE,
      offset,
    });
    total_count = page.total_count;
    timezone = page.timezone;
    result.push(...page.result);
    offset += page.result.length;
    if (
      page.result.length === 0 ||
      result.length >= total_count ||
      result.length >= MAX_ROWS
    ) {
      break;
    }
  }

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
  const apps = await getApplications(cfg);
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
  const rules = await getRules(cfg, target.application_id);
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
      const st = await getHistoryReports(cfg, id);
      return st.result[0];
    },
    download: (id: number) => downloadHistoryReportRaw(cfg, id),
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
    const to = new Date();
    const from = new Date(to.getTime() - plan.days * 24 * 3600 * 1000);
    const start = await getCallHistoryAsync(cfg, {
      from_date: fmtUTC(from),
      to_date: fmtUTC(to),
      application_id: plan.applicationId,
      with_calls: true,
      with_records: true,
      output: 'csv',
      timezone: 'UTC',
    });
    if (!start.history_report_id) {
      throw new CliError('GetCallHistoryAsync returned no history_report_id');
    }
    reportId = start.history_report_id;
    console.log(
      `queued report #${reportId} for ${fmtUTC(from)} .. ${fmtUTC(to)} UTC — polling…`,
    );
  }

  const csv = await fetchReportWhenReady(reportId, opts, pollDeps(cfg));
  emit(csv, plan);
}

// MANUAL, GUARDED one-shot StartScenarios trigger — the ONLY path in this repo
// that intentionally places a live call. It is reachable solely by running
// `start --confirm` at the terminal: resolveStartPlan() throws unless --confirm
// is present, so no test, default invocation, or other command can ever reach
// the startScenarios() call below. Never print the payload (byte count only).
async function cmdStart(
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  const plan = resolveStartPlan(flags); // throws without --confirm
  const { payload, bytes } = buildStartCustomData(plan);
  console.log('=== StartScenarios — LIVE CALL (byte-cap probe) ===');
  console.log(`rule_id                 : ${plan.ruleId}`);
  console.log(`to                      : ${plan.to}`);
  if (plan.from) console.log(`from                    : ${plan.from}`);
  console.log(`script_custom_data bytes: ${bytes}`); // count only — never the payload
  const resp = await startScenarios(
    cfg,
    { rule_id: plan.ruleId, script_custom_data: payload },
    30_000,
  );
  console.log(`result                  : ${resp.result}`);
  console.log(
    `call_session_history_id : ${resp.call_session_history_id ?? '(none)'}`,
  );
  if (resp.result !== 1 || !resp.call_session_history_id) {
    throw new CliError(
      'StartScenarios did not confirm a started call (result !== 1 or missing call_session_history_id)',
    );
  }
  console.log(
    'next: `npm run voximplant -- history --app <id>` and inspect ' +
      'call_session_history_custom_data to verify whether the full payload arrived.',
  );
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
  const hist = await getCallHistory(cfg, {
    from_date: fmtUTC(from),
    to_date: fmtUTC(to),
    call_session_history_id: plan.sessionId,
    with_records: true,
  });
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

async function dispatch(
  command: KnownCommand,
  cfg: VoximplantConfig,
  flags: Record<string, FlagValue>,
): Promise<void> {
  switch (command) {
    case 'account':
      return cmdAccount(cfg);
    case 'rules':
      return cmdRules(cfg, flags);
    case 'history':
      return cmdHistory(cfg, flags);
    case 'numbers':
      return cmdNumbers(cfg);
    case 'transactions':
      return cmdTransactions(cfg, flags);
    case 'start':
      return cmdStart(cfg, flags);
    case 'recording':
      return cmdRecording(cfg, flags);
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

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
