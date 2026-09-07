import 'server-only';

import { execFile } from 'node:child_process';

import { sendSlackAlert, type SlackAlertInput } from '@/lib/alerts/slack';
import {
  getSearchConsoleConfigStatus,
  getSearchConsoleSiteUrl,
} from '@/lib/analytics/search-console';
import { getAppOrigin } from '@/lib/url';

// Weekly SEO technical watch (pg-boss `seo-technical-watch`, Monday 09:00 IL).
//
// Runs the `seo` CLI's technical-watch workflow against the live site and
// turns its structured JSON into ONE decision: silent, or a Slack alert. The
// CLI does three things in one run — a crawl diffed against the previous
// saved crawl, Google URL Inspection of every sitemap URL diffed against the
// saved index snapshot, and a "link recovery" pass over URLs that used to earn
// search clicks. All three are read-only against the site; the only external
// write is the CLI's own local state under ~/.local/state/seo.
//
// Why a pg-boss job and not Plesk cron: the worker already owns every other
// scheduled sweep, wraps it in guardedWorker (Slack on failure) and shows it
// on /admin/jobs with staleness colouring. A cron line would be a second
// scheduler whose only output is a log file nobody reads.
//
// Why this does not replace scripts/seo-audit.mjs: that gate runs at deploy
// time and grades every page's rendered HTML. This one runs between deploys
// and watches the two things a deploy-time crawl cannot see — whether Google
// still indexes the pages, and whether anything drifted since the last run.
//
// The CLI is the same globally-installed `seo` package the deploy gate's
// sibling (`lacspace-seo`) is resolved through: `npx --no-install`, never a
// hardcoded home path. Its Google auth is the SAME service-account key the
// app's own GA4 / Search Console readers use (GOOGLE_APPLICATION_CREDENTIALS),
// passed under the CLI's own variable name for this child process only.

export const SEO_TECHNICAL_WATCH_TIMEOUT_MS = 10 * 60_000;
// URL Inspection + a 50-page crawl fit comfortably; the JSON is a few KB.
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export interface TechnicalWatchStep {
  tool: string;
  status: string;
  summary: string;
}

// The counters the decision reads. Every field is optional: the CLI's schema
// is its own, and a missing counter must degrade to "not observed", never to
// a crash that hides the whole report.
export interface TechnicalWatchReport {
  summary?: string;
  steps?: TechnicalWatchStep[];
  output?: {
    crawl?: {
      summary?: Partial<{
        crawled: number;
        added: number;
        removed: number;
        changed: number;
        newErrors: number;
        indexabilityFlips: number;
        highPriorityRecommendations: number;
      }>;
    };
    index?: {
      summary?: Partial<{
        inventoryUrls: number;
        inspected: number;
        failed: number;
        quotaBlocked: number;
        currentIssues: number;
        regressions: number;
        recoveries: number;
        alerts: number;
      }>;
    };
    recovery?: {
      summary?: Partial<{
        checked: number;
        recoverable: number;
        high: number;
      }>;
    };
  };
}

export type TechnicalWatchDecision = Omit<SlackAlertInput, 'category'> & {
  category: 'errors';
};

function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseReport(stdout: string): TechnicalWatchReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('seo technical-watch printed no parseable JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('seo technical-watch JSON was not an object.');
  }
  return parsed as TechnicalWatchReport;
}

/**
 * Pure decision: null when the run is clean, otherwise the alert to post.
 *
 * "Clean" means every step completed AND no counter that describes a
 * regression is non-zero. A skipped step is a warning, not silence — the run
 * that skipped URL Inspection because no sitemap was passed looks identical to
 * a healthy one in the summary line, and that is exactly the failure this
 * job exists to notice.
 */
export function evaluateTechnicalWatch(report: TechnicalWatchReport): TechnicalWatchDecision | null {
  const crawl = report.output?.crawl?.summary ?? {};
  const index = report.output?.index?.summary ?? {};
  const recovery = report.output?.recovery?.summary ?? {};
  const steps = report.steps ?? [];

  const incompleteSteps = steps.filter((s) => s.status !== 'completed').map((s) => s.tool);

  const fields: Record<string, number | string> = {
    crawled: num(crawl.crawled),
    changed: num(crawl.changed),
    removed: num(crawl.removed),
    new_errors: num(crawl.newErrors),
    indexability_flips: num(crawl.indexabilityFlips),
    high_priority: num(crawl.highPriorityRecommendations),
    inspected: num(index.inspected),
    index_failed: num(index.failed),
    index_quota_blocked: num(index.quotaBlocked),
    index_issues: num(index.currentIssues),
    index_regressions: num(index.regressions),
    index_alerts: num(index.alerts),
    recoverable_links: num(recovery.recoverable),
  };

  const errorSignals =
    num(crawl.newErrors) +
    num(crawl.indexabilityFlips) +
    num(crawl.removed) +
    num(index.regressions) +
    num(index.failed);
  const warnSignals =
    num(crawl.highPriorityRecommendations) +
    num(index.currentIssues) +
    num(index.alerts) +
    num(index.quotaBlocked) +
    num(recovery.recoverable) +
    incompleteSteps.length;

  if (errorSignals === 0 && warnSignals === 0) return null;

  if (incompleteSteps.length > 0) fields.incomplete_steps = incompleteSteps.join(', ');

  return {
    level: errorSignals > 0 ? 'error' : 'warn',
    title: errorSignals > 0 ? 'SEO technical watch: regression' : 'SEO technical watch: review',
    detail: report.summary ?? 'seo technical-watch reported findings.',
    source: 'seo-technical-watch',
    fields,
    category: 'errors',
  };
}

export interface RunSeoTechnicalWatchDeps {
  // Injected for tests: returns the CLI's stdout. Rejects on non-zero exit.
  exec?: (args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
  alert?: (input: SlackAlertInput) => Promise<unknown>;
}

function defaultExec(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['--no-install', 'seo', ...args],
      { env, timeout: SEO_TECHNICAL_WATCH_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          // stderr is the CLI's own diagnostics (no guest data — it crawls
          // public pages only). Trim so a Slack alert stays readable.
          const tail = String(stderr ?? '').trim().slice(-600);
          reject(new Error(`seo technical-watch failed: ${error.message}${tail ? `\n${tail}` : ''}`));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

export interface SeoTechnicalWatchResult {
  status: 'skipped' | 'clean' | 'alerted';
  reason?: 'missing_site_url' | 'missing_credentials_path' | 'credentials_unreadable';
  summary?: string;
}

/**
 * The job body. Refuses (skips, with a logged reason) rather than runs when the
 * Search Console configuration the app itself depends on is absent — the same
 * gate /admin/analytics uses, so the two can never disagree about readiness.
 */
export async function runSeoTechnicalWatch(
  deps: RunSeoTechnicalWatchDeps = {},
): Promise<SeoTechnicalWatchResult> {
  const config = await getSearchConsoleConfigStatus();
  if (!config.ok) {
    console.warn(`[seo-technical-watch] skipped: ${config.issue}`);
    return { status: 'skipped', reason: config.issue };
  }
  const site = getSearchConsoleSiteUrl();
  if (!site) return { status: 'skipped', reason: 'missing_site_url' };

  const origin = await getAppOrigin();
  const args = [
    'technical-watch',
    '--site',
    site,
    '--url',
    origin,
    '--sitemaps',
    `${origin}/sitemap.xml`,
    '--json',
  ];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SEO_GOOGLE_SERVICE_ACCOUNT_FILE: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    // Same reason as scripts/seo-audit.mjs: the machine-wide npm config file
    // would otherwise be forced onto the child npx.
    npm_config_global_ignore_file: undefined,
  };

  const stdout = await (deps.exec ?? defaultExec)(args, env);
  const report = parseReport(stdout);
  const decision = evaluateTechnicalWatch(report);
  const summary = report.summary ?? '(no summary)';

  if (!decision) {
    console.log(`[seo-technical-watch] clean: ${summary}`);
    return { status: 'clean', summary };
  }
  console.warn(`[seo-technical-watch] ${decision.level}: ${summary}`);
  await (deps.alert ?? sendSlackAlert)(decision);
  return { status: 'alerted', summary };
}
