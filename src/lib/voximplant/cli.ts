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
  getAccountInfo,
  getApplications,
  getCallHistoryAsync,
  getHistoryReports,
  getRules,
} from './core';
import {
  assertKnownCommand,
  CliError,
  fetchReportWhenReady,
  helpText,
  parseArgs,
  positiveInt,
  resolveHistoryPlan,
  resolveKeyPath,
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
