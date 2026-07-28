import 'server-only';

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

import { BetaAnalyticsDataClient } from '@google-analytics/data';

import type { Ga4ConfigIssue } from './ga4-types';

// Safe config validation (v2 plan §2.2). Presence is NOT enough: the property
// id must be digits-only and the ADC credentials file must actually be
// readable. Paths and file contents are NEVER logged, thrown, or returned —
// callers only ever see the issue code.
export async function getGa4ConfigStatus(): Promise<
  { ok: true } | { ok: false; issue: Ga4ConfigIssue }
> {
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  if (!propertyId) return { ok: false, issue: 'missing_property_id' };
  if (!/^\d+$/.test(propertyId)) return { ok: false, issue: 'invalid_property_id' };

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialsPath) return { ok: false, issue: 'missing_credentials_path' };
  try {
    await access(credentialsPath, constants.R_OK);
  } catch {
    return { ok: false, issue: 'credentials_unreadable' };
  }
  return { ok: true };
}

// Call only after getGa4ConfigStatus() returned ok.
export function getGa4Property(): string {
  return `properties/${process.env.GA4_PROPERTY_ID?.trim() ?? ''}`;
}

// Optional stream scoping (streamId filter on every report): the property
// still carries deleted-old-stream history, so the dashboard queries are
// pinned to the beta stream. Unset/malformed → no filter (whole property).
export function getGa4StreamId(): string | undefined {
  const streamId = process.env.GA4_STREAM_ID?.trim();
  return streamId && /^\d+$/.test(streamId) ? streamId : undefined;
}

// Optional custom channel-group scoping ("ערוצי KALFA") — the numeric id of
// the property's custom channel group. Unset/malformed → the kalfaChannels
// card renders as not-configured (batch D simply omits that report).
export function getGa4ChannelGroupId(): string | undefined {
  const id = process.env.GA4_CHANNEL_GROUP_ID?.trim();
  return id && /^\d+$/.test(id) ? id : undefined;
}

// Lazy module-level singleton. No explicit credentials — ADC reads
// GOOGLE_APPLICATION_CREDENTIALS itself. fallback:'rest' keeps gRPC (and its
// bundling problems) entirely out of the runtime.
let client: BetaAnalyticsDataClient | null = null;

export function getGa4Client(): BetaAnalyticsDataClient {
  client ??= new BetaAnalyticsDataClient({ fallback: 'rest' });
  return client;
}
