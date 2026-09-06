import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getSearchConsoleConfigStatus,
  getSearchConsoleSiteUrl,
  rangeToSearchConsoleDates,
  SEARCH_CONSOLE_LAG_DAYS,
} from './search-console';

const ORIGINAL = {
  siteUrl: process.env.SEARCH_CONSOLE_SITE_URL,
  credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
};

let tempDir: string;
let readableFile: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'search-console-test-'));
  readableFile = join(tempDir, 'creds.json');
  writeFileSync(readableFile, '{}');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  if (ORIGINAL.siteUrl === undefined) delete process.env.SEARCH_CONSOLE_SITE_URL;
  else process.env.SEARCH_CONSOLE_SITE_URL = ORIGINAL.siteUrl;
  if (ORIGINAL.credentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  else process.env.GOOGLE_APPLICATION_CREDENTIALS = ORIGINAL.credentials;
});

describe('getSearchConsoleSiteUrl', () => {
  it('accepts a domain property', () => {
    process.env.SEARCH_CONSOLE_SITE_URL = 'sc-domain:beta.kalfa.me';
    expect(getSearchConsoleSiteUrl()).toBe('sc-domain:beta.kalfa.me');
  });

  it('accepts a URL-prefix property', () => {
    process.env.SEARCH_CONSOLE_SITE_URL = 'https://beta.kalfa.me/';
    expect(getSearchConsoleSiteUrl()).toBe('https://beta.kalfa.me/');
  });

  it('rejects anything that is neither shape, including a bare hostname', () => {
    // A bare host is the likeliest typo, and it would produce a 403 from the
    // API rather than an obvious config error — better to refuse it here.
    for (const bad of ['beta.kalfa.me', 'sc-domain:', '', '   ', 'ftp://x.com']) {
      process.env.SEARCH_CONSOLE_SITE_URL = bad;
      expect(getSearchConsoleSiteUrl(), bad).toBeUndefined();
    }
  });

  it('is undefined when unset', () => {
    delete process.env.SEARCH_CONSOLE_SITE_URL;
    expect(getSearchConsoleSiteUrl()).toBeUndefined();
  });
});

describe('getSearchConsoleConfigStatus', () => {
  it('reports the missing property before anything else', async () => {
    delete process.env.SEARCH_CONSOLE_SITE_URL;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = readableFile;
    await expect(getSearchConsoleConfigStatus()).resolves.toEqual({
      ok: false,
      issue: 'missing_site_url',
    });
  });

  it('reports a missing credentials path', async () => {
    process.env.SEARCH_CONSOLE_SITE_URL = 'sc-domain:beta.kalfa.me';
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    await expect(getSearchConsoleConfigStatus()).resolves.toEqual({
      ok: false,
      issue: 'missing_credentials_path',
    });
  });

  it('reports an unreadable credentials file rather than assuming presence is enough', async () => {
    process.env.SEARCH_CONSOLE_SITE_URL = 'sc-domain:beta.kalfa.me';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = join(tempDir, 'does-not-exist.json');
    await expect(getSearchConsoleConfigStatus()).resolves.toEqual({
      ok: false,
      issue: 'credentials_unreadable',
    });
  });

  it('passes when both are present and the file is readable', async () => {
    process.env.SEARCH_CONSOLE_SITE_URL = 'sc-domain:beta.kalfa.me';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = readableFile;
    await expect(getSearchConsoleConfigStatus()).resolves.toEqual({ ok: true });
  });
});

describe('rangeToSearchConsoleDates', () => {
  const dayMs = 86_400_000;
  const daysBetween = (a: string, b: string) =>
    Math.round((Date.parse(b) - Date.parse(a)) / dayMs);

  it('never reaches today — Search Console lags and the last day is partial', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const range of ['today', '7d', '30d', '90d'] as const) {
      const { endDate } = rangeToSearchConsoleDates(range);
      expect(endDate < today, range).toBe(true);
      expect(daysBetween(endDate, today), range).toBe(SEARCH_CONSOLE_LAG_DAYS);
    }
  });

  it('spans the requested number of days', () => {
    expect(daysBetween(...(Object.values(rangeToSearchConsoleDates('7d')) as [string, string]))).toBe(7);
    expect(daysBetween(...(Object.values(rangeToSearchConsoleDates('30d')) as [string, string]))).toBe(30);
    expect(daysBetween(...(Object.values(rangeToSearchConsoleDates('90d')) as [string, string]))).toBe(90);
  });

  it("maps 'today' to a 7-day window instead of an empty one", () => {
    // The freshest Search Console day is already 2 days old and partial, so a
    // literal "today" range would render an empty card that reads as a traffic
    // collapse rather than as "this source has no same-day data".
    const t = rangeToSearchConsoleDates('today');
    expect(daysBetween(t.startDate, t.endDate)).toBe(7);
  });

  it('returns plain YYYY-MM-DD, which is the only date format the API takes', () => {
    const { startDate, endDate } = rangeToSearchConsoleDates('30d');
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
