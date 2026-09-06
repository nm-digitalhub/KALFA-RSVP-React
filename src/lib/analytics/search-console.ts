import 'server-only';

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

import { GoogleAuth } from 'google-auth-library';

import type { AnalyticsRange } from './ga4-types';

// Google Search Console reader — the ORGANIC half of the analytics picture.
//
// Why this exists next to the GA4 stack rather than inside it: GA4 answers
// "who visited and what did they do", Search Console answers "did Google show
// us at all, for which query, and at what position". Those are different
// questions and only the second one can tell an unranked site apart from an
// unindexed one. GA4 alone reported organic ≈ 0 for 90 days and could not say
// which of the two it was.
//
// It also survives a condition that blanks GA4: Search Console counts what
// GOOGLE recorded on its own results page, so it keeps reporting even when the
// cookie-consent mechanism is off and no visitor is measured. The dashboard
// says so, because otherwise the two panels look contradictory.
//
// Credentials: the SAME service account the GA4 dashboard already uses
// (GOOGLE_APPLICATION_CREDENTIALS). It was made a verified siteOwner of
// `sc-domain:beta.kalfa.me` on 2026-09-06 via the Site Verification API + a
// DNS TXT record. Removing that TXT record revokes this reader.

export type SearchConsoleConfigIssue =
  | 'missing_credentials_path'
  | 'credentials_unreadable'
  | 'missing_site_url';

// Read-only scope on purpose: this module must never be able to add, remove or
// modify a Search Console property, only read one.
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

// Search Console's own reporting delay. Its data is final only after ~2 days,
// and the most recent day is always partial — a range ending "today" would
// show a fake decline at the right edge of every chart.
export const SEARCH_CONSOLE_LAG_DAYS = 2;

export function getSearchConsoleSiteUrl(): string | undefined {
  const raw = process.env.SEARCH_CONSOLE_SITE_URL?.trim();
  if (!raw) return undefined;
  // Both Search Console property shapes are legal here: a domain property
  // (`sc-domain:example.com`) or a URL-prefix property
  // (`https://example.com/`). Anything else is a typo, not a property.
  if (raw.startsWith('sc-domain:') && raw.length > 'sc-domain:'.length) return raw;
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw;
  return undefined;
}

export async function getSearchConsoleConfigStatus(): Promise<
  { ok: true } | { ok: false; issue: SearchConsoleConfigIssue }
> {
  if (!getSearchConsoleSiteUrl()) return { ok: false, issue: 'missing_site_url' };

  // Same credential check the GA4 config gate performs, and for the same
  // reason: presence of the env var is not proof the file can be read, and the
  // path itself must never appear in a log, an error or the UI.
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialsPath) return { ok: false, issue: 'missing_credentials_path' };
  try {
    await access(credentialsPath, constants.R_OK);
  } catch {
    return { ok: false, issue: 'credentials_unreadable' };
  }
  return { ok: true };
}

// One shared auth object: GoogleAuth caches the signed token internally, so a
// dashboard render that fetches three reports performs one token exchange.
let auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  auth ??= new GoogleAuth({ scopes: [SCOPE] });
  return auth;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Search Console takes explicit YYYY-MM-DD dates — it has no equivalent of
// GA4's "30daysAgo" tokens — and every range ends LAG days back, never today.
export function rangeToSearchConsoleDates(range: AnalyticsRange): {
  startDate: string;
  endDate: string;
} {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - SEARCH_CONSOLE_LAG_DAYS);
  const start = new Date(end);
  // 'today' has no meaningful Search Console equivalent (the freshest day is
  // already 2 days old and partial), so it reads as the last 7 days instead of
  // rendering an empty card the operator would read as "we lost all traffic".
  const days = range === '90d' ? 90 : range === '30d' ? 30 : 7;
  start.setUTCDate(start.getUTCDate() - days);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

export type SearchAnalyticsApiRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

type SearchAnalyticsApiResponse = { rows?: SearchAnalyticsApiRow[] };

export class SearchConsoleQuotaError extends Error {}

// Raw query against searchAnalytics.query. Throws on a non-OK response so the
// DAL can classify it into a section state; the body is never surfaced to a
// user (it can echo the property URL and the service-account identity).
export async function querySearchAnalytics(params: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
}): Promise<SearchAnalyticsApiRow[]> {
  const client = await getAuth().getClient();
  const token = (await client.getAccessToken()).token;
  if (!token) throw new Error('search console: no access token');

  const endpoint =
    'https://searchconsole.googleapis.com/webmasters/v3/sites/' +
    `${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: params.startDate,
      endDate: params.endDate,
      ...(params.dimensions ? { dimensions: params.dimensions } : {}),
      // Max 25,000, default 1,000 (verified against the live reference,
      // 2026-09-06) — the dashboard only ever shows a short table.
      rowLimit: params.rowLimit ?? 10,
      // 'final' = finalized data only; 'all' would also include fresh, still
      // -moving data. It is ALSO the API's default, so this is stated
      // explicitly to document the choice, not to change behaviour: it is the
      // same reason the window ends SEARCH_CONSOLE_LAG_DAYS back, and the two
      // must not drift apart.
      //
      // It does NOT filter anonymised rows — Google withholds the query string
      // for rare searches regardless, and no request parameter controls that.
      // mapRows drops those blank-key rows on the way out instead.
      dataState: 'final',
    }),
    // The dashboard renders per-section states; a hung request must not hold
    // the whole page open.
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 429) throw new SearchConsoleQuotaError('search console quota');
  if (!res.ok) throw new Error(`search console: HTTP ${res.status}`);

  const body = (await res.json()) as SearchAnalyticsApiResponse;
  return body.rows ?? [];
}
