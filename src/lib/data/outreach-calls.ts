import 'server-only';

import { randomBytes } from 'node:crypto';

import { getAppOrigin } from '@/lib/url';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { getOutreachEnabled } from '@/lib/data/outreach-config';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import {
  createCallAttempt,
  getCallAttemptByTouchpoint,
  recordDialConfirmed,
  markFailedToStart,
  markStartUnknown,
  countActiveCalls,
  countCampaignCallsSince,
} from '@/lib/data/call-attempts';
import {
  getCampaignContext,
  hasCallConsent,
  isContactReached,
  isDncListed,
} from '@/lib/data/outreach-engine';
import { getGuestsForContact, insertInteraction, setContactOpStatus } from '@/lib/data/interactions';
import {
  getAccountInfo,
  VoximplantApiError,
  VoximplantNetworkError,
} from '@/lib/voximplant/core';
// The dial mutation lives in the separated mutations module (never imported by
// the CLI); this dispatcher is its only worker-side consumer.
import { startScenarios } from '@/lib/voximplant/mutations';
import type { OutreachCallRequest } from '@/lib/queue/queues';

// Stage 3 — the outbound AI-call dispatcher. Consumed by worker/main.ts's
// QUEUES.callRequest handler. Branch B, DARK-SAFE: no live call is EVER placed
// unless config.liveCallsEnabled is true, independent of whether credentials are
// configured. Request-FREE (service-role only) so the worker bundle can import it.
// The scenario payload carries ONLY {to, from, tok, u} — an opaque per-call access
// token and the app origin; the invitation context is served by the token-gated ctx endpoint
// instead (never in call history). NEVER logs the token or the full payload —
// only ids/bytes.

const CALL_TOKEN_TTL_SEC = 2 * 60 * 60; // matches call_attempts.token_expires_at intent (created_at + 2h)
const BALANCE_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 25_000;

export type CallDispatchResult =
  | { kind: 'skipped'; reason: 'outreach_disabled' | 'no_call_consent' | 'dnc_listed' | 'already_reached' | 'campaign_not_active' | 'concurrent_owner' | 'max_concurrency' | 'campaign_hour_cap' }
  | { kind: 'blocked'; reason: 'config_missing' | 'live_calls_disabled' | 'balance_below_reserve' }
  | { kind: 'transient_error'; reason: 'balance_check_failed' } // the ONLY retryable kind
  | { kind: 'already_dispatched'; attemptId: string }
  | { kind: 'already_concluded'; attemptId: string; status: string }
  | { kind: 'dialed'; attemptId: string; callSessionHistoryId: number }
  | { kind: 'failed_to_start'; attemptId: string; code: number | null }
  | { kind: 'start_unknown'; attemptId: string };

// Single source of truth for the scenario payload (Branch B). Returns the JSON AND
// its exact UTF-8 byte length so callers log ONLY the byte count — never the token.
// The payload is deliberately tiny (~110 B, well under VoxEngine.customData()'s
// 200-byte cap) and carries NO secrets: the scenario builds the ctx/cb URLs from
// {u}/api/voximplant/{ctx,cb}/{tok} and fetches the invitation context from ctx.
//   to  — normalized destination E.164
//   from— verified caller id
//   tok — opaque per-call access token (call_attempts.access_token)
//   u   — app origin (scheme+host) for building the ctx/cb URLs
export function buildScriptCustomData(args: {
  to: string;
  from: string;
  tok: string;
  u: string;
}): { payload: string; bytes: number } {
  const payload = JSON.stringify({
    to: args.to,
    from: args.from,
    tok: args.tok,
    u: args.u,
  });
  return { payload, bytes: Buffer.byteLength(payload, 'utf8') };
}

async function alert(
  level: 'warn' | 'error',
  title: string,
  fields: Record<string, string | number>,
): Promise<void> {
  await sendSlackAlert({ level, title, source: 'voximplant-dispatch', category: 'send_health', fields });
}

// Complete the post-dial bookkeeping (idempotent) after a confirmed start — used
// both by the winner and by a lost-race reconcile whose row already has a history id.
async function finishDialed(
  job: OutreachCallRequest,
  callSessionHistoryId: number,
): Promise<void> {
  await insertInteraction({
    event_id: job.eventId,
    campaign_id: job.campaignId,
    contact_id: job.contactId,
    channel: 'call',
    direction: 'out',
    kind: 'call_dialed',
    provider_id: String(callSessionHistoryId),
    billable: false,
  });
  await setContactOpStatus(job.contactId, 'call_dialed');
}

export async function dispatchOutreachCall(
  job: OutreachCallRequest,
): Promise<CallDispatchResult> {
  const { campaignId, eventId, contactId, normalizedPhone, touchpointIndex } = job;

  // 1. Master outreach switch (defense-in-depth — the job may have sat queued).
  if (!(await getOutreachEnabled())) return { kind: 'skipped', reason: 'outreach_disabled' };

  // 2. Credentials complete? (does NOT by itself permit a dial — see #3.)
  //    The Groq key is no longer part of "complete": the dialogue brain is the
  //    ElevenLabs agent inside the bridge scenario, which never reads it. Keeping
  //    it here blocked every dial on a credential nothing consumed.
  const config = await getVoximplantConfig();
  if (!config || !config.callbackSecret) {
    return { kind: 'blocked', reason: 'config_missing' };
  }

  // 3. Independent live-dial gate: the admin DB toggle AND the env not force-off
  //    (config.liveCallsEnabled). Filling credentials must NEVER by itself dial —
  //    an admin must explicitly enable live calls. No alert — expected steady state.
  if (!config.liveCallsEnabled) return { kind: 'blocked', reason: 'live_calls_disabled' };

  // 4. Fresh gating (never trust the enqueue-time snapshot).
  if (!(await hasCallConsent(contactId))) return { kind: 'skipped', reason: 'no_call_consent' };
  if (await isDncListed(normalizedPhone)) return { kind: 'skipped', reason: 'dnc_listed' };
  if (await isContactReached(eventId, contactId)) return { kind: 'skipped', reason: 'already_reached' };
  const cctx = await getCampaignContext(campaignId);
  if (!cctx || cctx.status !== 'active' || !cctx.allowed_channels.includes('call')) {
    return { kind: 'skipped', reason: 'campaign_not_active' };
  }

  // 5. Bind a guest ONLY when the contact backs exactly one (else RSVP is skipped
  //    later; the call still dials).
  const guests = await getGuestsForContact(eventId, contactId);
  const guestId = guests.length === 1 ? guests[0].id : null;

  // 5b. Rate-limit caps (durable DB counters) — enforced BEFORE the balance
  //     precheck so no API call or attempt row happens when over a cap. Soft
  //     caps: a small count↔INSERT race is possible under load; the hard
  //     guarantee stays the UNIQUE(campaign,contact,touchpoint) atomic create.
  const active = await countActiveCalls();
  if (active >= config.maxConcurrentCalls) {
    await alert('warn', 'Voximplant max concurrency reached — deferring', {
      campaignId, active, cap: config.maxConcurrentCalls,
    });
    return { kind: 'skipped', reason: 'max_concurrency' };
  }
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if ((await countCampaignCallsSince(campaignId, sinceIso)) >= config.maxCallsPerCampaignHour) {
    return { kind: 'skipped', reason: 'campaign_hour_cap' };
  }

  // 6. Balance precheck BEFORE any attempt row is created (so no orphaned row).
  let balance: number;
  try {
    const info = await getAccountInfo(config.auth, BALANCE_TIMEOUT_MS);
    balance = info.result.balance;
  } catch {
    // Read-only, no side effect occurred → safe to retry (correction #6).
    return { kind: 'transient_error', reason: 'balance_check_failed' };
  }
  if (balance < config.minCallReserve) {
    await alert('error', 'Voximplant balance below reserve — call blocked', {
      campaignId, contactId, balance, minReserve: config.minCallReserve,
    });
    return { kind: 'blocked', reason: 'balance_below_reserve' };
  }
  if (balance < config.lowBalanceThreshold) {
    await alert('warn', 'Voximplant balance low', {
      campaignId, balance, lowThreshold: config.lowBalanceThreshold,
    });
    // proceed — warn only.
  }

  // 7. ATOMIC create — the ONLY concurrency mechanism (INSERT ... ON CONFLICT DO
  //    NOTHING against UNIQUE(campaign,contact,touchpoint); never read-then-insert).
  //    access_token is the opaque per-call bearer (Branch B): it satisfies the NOT
  //    NULL UNIQUE column AND is sent to the scenario as `tok` — the ctx/cb
  //    endpoints authenticate by looking this value up server-side.
  const accessToken = randomBytes(16).toString('hex');
  // NON-authorizing correlation nonce (item-2 link vector): stamped at creation so
  // every attempt is ready to link an ElevenLabs-bridged conversation back to this
  // row. Distinct from access_token (a capability bearer) — leaking it exposes
  // nothing. The legacy DTMF scenario never read it; it is inert there.
  const elCorrelationNonce = randomBytes(16).toString('hex');
  const tokenExpiresAt = new Date(Date.now() + CALL_TOKEN_TTL_SEC * 1000).toISOString();
  const created = await createCallAttempt({
    eventId, campaignId, contactId, guestId, touchpointIndex, accessToken, tokenExpiresAt,
    elCorrelationNonce,
  });

  if (created === null) {
    // Lost the race. RECONCILE — never redial, and NEVER write the row's status
    // (a racing loser must not corrupt the in-flight winner).
    const existing = await getCallAttemptByTouchpoint(campaignId, contactId, touchpointIndex);
    if (!existing) return { kind: 'skipped', reason: 'concurrent_owner' }; // fail-closed
    if (existing.vox_call_session_history_id) {
      // Winner already confirmed a start — complete the missing idempotent
      // bookkeeping (e.g. it crashed after recordDialConfirmed).
      await finishDialed(job, Number(existing.vox_call_session_history_id));
      return { kind: 'already_dispatched', attemptId: existing.id };
    }
    if (
      existing.status === 'queued' ||
      existing.status === 'dialing' ||
      existing.status === 'in_progress'
    ) {
      // The winner is presumably still in-flight (between INSERT and
      // balance/payload/StartScenarios, or a pg-boss re-delivery of a slow
      // winner). Do NOT touch the status; do NOT dial. A genuinely stuck row is
      // resolved by a separate time-based reconciler, never here.
      return { kind: 'skipped', reason: 'concurrent_owner' };
    }
    // Already concluded (failed_to_start / start_unknown / terminal).
    return { kind: 'already_concluded', attemptId: existing.id, status: existing.status };
  }
  const attemptId = created.id;

  // 8. Resolve the app origin — the scenario builds the ctx/cb URLs from it +
  //    the opaque access token (Branch B). No signed token, no key in the payload.
  const origin = await getAppOrigin();

  // 9. Assemble the payload (single source of truth) — log ONLY the byte count.
  const { payload, bytes } = buildScriptCustomData({
    to: normalizedPhone,
    from: config.callerId,
    tok: accessToken,
    u: origin,
  });
  console.log('[outreach-calls] dispatching', { campaignId, contactId, attemptId, payloadBytes: bytes });

  // 10. StartScenarios — definite vs ambiguous classification (correction #3).
  try {
    const res = await startScenarios(config.auth, { rule_id: config.ruleId, script_custom_data: payload }, START_TIMEOUT_MS);
    if (res.result === 1 && res.call_session_history_id != null) {
      await recordDialConfirmed(attemptId, {
        callSessionHistoryId: res.call_session_history_id,
        mediaSessionAccessUrl: res.media_session_access_url ?? null,
      });
      await finishDialed(job, res.call_session_history_id);
      return { kind: 'dialed', attemptId, callSessionHistoryId: res.call_session_history_id };
    }
    // result!==1, or result===1 without a history id → ambiguous, no redial.
    await markStartUnknown(attemptId, 'ambiguous_start_response');
    return { kind: 'start_unknown', attemptId };
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      // Definite provider rejection — non-retryable (no verified-transient code yet).
      await markFailedToStart(attemptId, e.message);
      await alert('warn', 'Voximplant StartScenarios rejected (failed_to_start)', {
        campaignId, contactId, attemptId, code: e.code ?? 0,
      });
      return { kind: 'failed_to_start', attemptId, code: e.code };
    }
    if (e instanceof VoximplantNetworkError) {
      // Transport / non-2xx / parse / AbortSignal.timeout AFTER the request was
      // sent — ambiguous. NO auto-retry-dial (double-call risk).
      await markStartUnknown(attemptId, 'network_error_during_start');
      await alert('warn', 'Voximplant StartScenarios ambiguous (start_unknown)', {
        campaignId, contactId, attemptId,
      });
      return { kind: 'start_unknown', attemptId };
    }
    throw e; // truly unexpected — let guardedWorker's catch alert + rethrow
  }
}
