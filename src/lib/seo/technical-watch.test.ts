import { beforeEach, describe, expect, it, vi } from 'vitest';

// technical-watch.ts begins with `import 'server-only'` — stub it (established
// convention: voximplant-balance.test.ts). Collaborators are mocked so the
// tests exercise the decision and the job body, never the CLI or Google.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.example.test') }));
vi.mock('@/lib/analytics/search-console', () => ({
  getSearchConsoleConfigStatus: vi.fn(),
  getSearchConsoleSiteUrl: vi.fn(),
}));

import {
  getSearchConsoleConfigStatus,
  getSearchConsoleSiteUrl,
} from '@/lib/analytics/search-console';
import { sendSlackAlert, type SlackAlertInput } from '@/lib/alerts/slack';
import {
  evaluateTechnicalWatch,
  runSeoTechnicalWatch,
  type TechnicalWatchReport,
} from './technical-watch';

// Shape copied from a real `seo technical-watch --json` run (7.9.2026): three
// completed steps, every counter zero.
const CLEAN: TechnicalWatchReport = {
  summary: '0 material technical findings; 0 incomplete URL Inspection checks.',
  steps: [
    { tool: 'seo_crawl_diff', status: 'completed', summary: 'Crawled 16 URLs; 0 changed' },
    { tool: 'seo_index_monitor', status: 'completed', summary: 'Inspected 12 selected URLs' },
    { tool: 'seo_link_recover', status: 'completed', summary: 'Checked 0 search-value URLs' },
  ],
  output: {
    crawl: {
      summary: {
        crawled: 16,
        added: 0,
        removed: 0,
        changed: 0,
        newErrors: 0,
        indexabilityFlips: 0,
        highPriorityRecommendations: 0,
      },
    },
    index: {
      summary: {
        inventoryUrls: 12,
        inspected: 12,
        failed: 0,
        quotaBlocked: 0,
        currentIssues: 0,
        regressions: 0,
        recoveries: 0,
        alerts: 0,
      },
    },
    recovery: { summary: { checked: 0, recoverable: 0, high: 0 } },
  },
};

function withCounters(patch: {
  crawl?: Partial<NonNullable<NonNullable<TechnicalWatchReport['output']>['crawl']>['summary']>;
  index?: Partial<NonNullable<NonNullable<TechnicalWatchReport['output']>['index']>['summary']>;
  recovery?: Partial<NonNullable<NonNullable<TechnicalWatchReport['output']>['recovery']>['summary']>;
}): TechnicalWatchReport {
  return {
    ...CLEAN,
    output: {
      crawl: { summary: { ...CLEAN.output?.crawl?.summary, ...patch.crawl } },
      index: { summary: { ...CLEAN.output?.index?.summary, ...patch.index } },
      recovery: { summary: { ...CLEAN.output?.recovery?.summary, ...patch.recovery } },
    },
  };
}

describe('evaluateTechnicalWatch', () => {
  it('is silent on a clean run', () => {
    expect(evaluateTechnicalWatch(CLEAN)).toBeNull();
  });

  it('errors on an index regression', () => {
    const d = evaluateTechnicalWatch(withCounters({ index: { regressions: 1 } }));
    expect(d).toMatchObject({ level: 'error', category: 'errors', source: 'seo-technical-watch' });
    expect(d?.fields?.index_regressions).toBe(1);
  });

  it('errors when a page flipped to non-indexable or disappeared', () => {
    expect(evaluateTechnicalWatch(withCounters({ crawl: { indexabilityFlips: 1 } }))?.level).toBe('error');
    expect(evaluateTechnicalWatch(withCounters({ crawl: { removed: 2 } }))?.level).toBe('error');
    expect(evaluateTechnicalWatch(withCounters({ crawl: { newErrors: 1 } }))?.level).toBe('error');
  });

  it('warns (not errors) on review-only signals', () => {
    expect(evaluateTechnicalWatch(withCounters({ crawl: { highPriorityRecommendations: 1 } }))?.level).toBe('warn');
    expect(evaluateTechnicalWatch(withCounters({ index: { currentIssues: 1 } }))?.level).toBe('warn');
    expect(evaluateTechnicalWatch(withCounters({ recovery: { recoverable: 1 } }))?.level).toBe('warn');
  });

  it('warns when a step did not complete — a skipped URL Inspection looks clean otherwise', () => {
    const d = evaluateTechnicalWatch({
      ...CLEAN,
      steps: [
        CLEAN.steps![0],
        { tool: 'seo_index_monitor', status: 'skipped', summary: 'No inspection URLs or sitemaps passed.' },
        CLEAN.steps![2],
      ],
    });
    expect(d?.level).toBe('warn');
    expect(d?.fields?.incomplete_steps).toBe('seo_index_monitor');
  });

  it('treats missing counters as not observed rather than crashing', () => {
    expect(evaluateTechnicalWatch({ steps: [] })).toBeNull();
    expect(evaluateTechnicalWatch({})).toBeNull();
  });
});

describe('runSeoTechnicalWatch', () => {
  beforeEach(() => {
    vi.mocked(sendSlackAlert).mockReset();
    vi.mocked(getSearchConsoleConfigStatus).mockResolvedValue({ ok: true });
    vi.mocked(getSearchConsoleSiteUrl).mockReturnValue('sc-domain:example.test');
  });

  it('skips without running the CLI when Search Console is not configured', async () => {
    vi.mocked(getSearchConsoleConfigStatus).mockResolvedValue({
      ok: false,
      issue: 'missing_credentials_path',
    });
    const exec = vi.fn();
    const r = await runSeoTechnicalWatch({ exec });
    expect(r).toEqual({ status: 'skipped', reason: 'missing_credentials_path' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes the property, origin and sitemap to the CLI and maps the key under its own name', async () => {
    const exec = vi.fn(async () => JSON.stringify(CLEAN));
    const prev = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/keys/test.json';
    try {
      const r = await runSeoTechnicalWatch({ exec });
      expect(r.status).toBe('clean');
      const [args, env] = exec.mock.calls[0] as unknown as [string[], NodeJS.ProcessEnv];
      expect(args).toEqual([
        'technical-watch',
        '--site',
        'sc-domain:example.test',
        '--url',
        'https://beta.example.test',
        '--sitemaps',
        'https://beta.example.test/sitemap.xml',
        '--json',
      ]);
      expect(env.SEO_GOOGLE_SERVICE_ACCOUNT_FILE).toBe('/keys/test.json');
      expect(env.npm_config_global_ignore_file).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = prev;
    }
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('alerts through the injected sink when the run has findings', async () => {
    const exec = vi.fn(async () => JSON.stringify(withCounters({ index: { regressions: 2 } })));
    const alert = vi.fn<(input: SlackAlertInput) => Promise<unknown>>(async () => null);
    const r = await runSeoTechnicalWatch({ exec, alert });
    expect(r.status).toBe('alerted');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toMatchObject({ level: 'error', category: 'errors' });
  });

  it('throws (so guardedWorker alerts) when the CLI output is not JSON', async () => {
    const exec = vi.fn(async () => 'AUTH_REQUIRED');
    await expect(runSeoTechnicalWatch({ exec })).rejects.toThrow(/no parseable JSON/);
  });

  it('propagates a CLI failure', async () => {
    const exec = vi.fn(async () => {
      throw new Error('seo technical-watch failed: exit 2');
    });
    await expect(runSeoTechnicalWatch({ exec })).rejects.toThrow(/exit 2/);
  });
});
