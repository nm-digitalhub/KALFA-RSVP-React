import 'server-only';

import { randomBytes } from 'node:crypto';

import { DIAL_GATE_POLICY, evaluateSharedConsentGates } from '@/lib/data/console-calls';
import { getVoicePurpose } from '@/lib/data/voice-purposes';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { countActiveCallsAllSurfaces } from '@/lib/data/voximplant-concurrency';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppOrigin } from '@/lib/url';
import { normalizePhone } from '@/lib/phone';
import {
  getAccountInfo,
  VoximplantApiError,
  VoximplantNetworkError,
} from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';

// Dial one contact with whichever agent a `voice_purposes` row names.
//
// ⚠️ THIS IS THE SAME GATE ORDER THE THREE HAND-WRITTEN DISPATCHERS USE, and it
// is copied deliberately rather than simplified. Each gate is here because a
// real failure put it there — the ordering (permission, then identity, then
// consent, then capacity, then money, and only then a provider call) is what
// keeps a refusal from costing an attempt row or a dial.
//
// ⚠️ THE CONSENT POLICY IS `guest_service`, THE STRICTEST ONE, and that is a
// decision rather than a default. `console-calls.ts` documents the three:
// `callback` (they asked us to ring), `returned_call` (they rang us), and
// `guest_service` — "WE initiate, to a guest who asked for nothing. Every gate
// applies." A workflow dialling a guest is exactly that case. Using `callback`
// here would drop the daily-window gate on somebody who never asked to be
// telephoned.
//
// ⚠️ AND IT REFUSES THE THREE BUILT-IN PURPOSES. RSVP, meeting-confirm and sales
// already have dispatchers that carry rules this one does not — a campaign
// touchpoint, a 24-hour lead, an unresolved-prior-call check. Dialling them
// through here would be a second, thinner way into a path that works.

/**
 * `tokenExpiresAt` is on every variant that produced an attempt row, and it is
 * there for ONE caller: a workflow step that parks until the call reports.
 *
 * ⚠️ IT IS THE ONLY HONEST CEILING FOR THAT WAIT. The cb route refuses a token
 * past its expiry (404, pinned in purpose-cb.test.ts), so a run parked beyond
 * this instant is parked in a window where no wake can arrive — it would sleep
 * to a deadline nothing can reach it before. Returning the row's own value also
 * keeps one source of truth: the TTL is `voice_purposes.token_ttl_sec`, which an
 * owner edits, and a second constant in the engine would drift from it silently.
 */
export type VoicePurposeDispatchResult =
  | { kind: 'dialed'; attemptId: string; callSessionHistoryId: number; tokenExpiresAt: string }
  | { kind: 'already_dispatched'; attemptId: string; tokenExpiresAt?: string }
  | { kind: 'start_unknown'; attemptId: string; tokenExpiresAt: string }
  | { kind: 'failed_to_start'; attemptId: string; code?: number }
  | { kind: 'blocked'; reason: string }
  | { kind: 'skipped'; reason: string };

const START_TIMEOUT_MS = 10_000;
const BALANCE_TIMEOUT_MS = 8_000;

export async function dispatchVoicePurposeCall(input: {
  purposeKey: string;
  eventId: string | null;
  contactId: string;
  /** The workflow step that asked. The pair is the idempotency key. */
  runId?: string;
  nodeId?: string;
  nowMs?: number;
}): Promise<VoicePurposeDispatchResult> {
  const nowMs = input.nowMs ?? Date.now();

  // 1. The purpose itself. "Off" and "never existed" are reported apart: an
  //    owner who disabled something must read that, not a missing-row error.
  const purpose = await getVoicePurpose(input.purposeKey);
  if (!purpose) return { kind: 'skipped', reason: 'purpose_not_found' };
  if (purpose.isBuiltin) return { kind: 'blocked', reason: 'purpose_is_builtin' };
  if (!purpose.active) return { kind: 'skipped', reason: 'purpose_inactive' };
  if (!purpose.enabled) return { kind: 'skipped', reason: 'purpose_disabled' };
  if (!purpose.ruleId) return { kind: 'blocked', reason: 'purpose_rule_missing' };

  // 2. Account credentials, and then — separately — the live-dial switch.
  //    Filling credentials must never by itself dial.
  const config = await getVoximplantConfig();
  if (!config || !config.callbackSecret) return { kind: 'blocked', reason: 'config_missing' };
  if (!config.liveCallsEnabled) return { kind: 'blocked', reason: 'live_calls_disabled' };

  const admin = createAdminClient();

  const { data: contact } = await admin
    .from('contacts')
    .select('id, normalized_phone')
    .eq('id', input.contactId)
    .maybeSingle();
  const phone = normalizePhone(contact?.normalized_phone ?? '');
  if (!phone) return { kind: 'skipped', reason: 'invalid_phone' };

  // 3. Consent, DNC, opt-out, Shabbat and the daily window — one call, the same
  //    shared evaluator every other dial surface goes through.
  const gates = await evaluateSharedConsentGates(admin, phone, nowMs, {
    policy: DIAL_GATE_POLICY.guest_service,
  });
  if (!gates.ok) return { kind: 'skipped', reason: gates.reason };

  // 4. Concurrency — the COMBINED cross-surface count, because every dial on
  //    this account shares one balance and one channel limit.
  const active = await countActiveCallsAllSurfaces();
  if (active >= config.maxConcurrentCalls) {
    await sendSlackAlert({
      level: 'warn',
      title: 'Voximplant max concurrency reached — deferring voice-purpose call',
      source: 'voice-purpose-dispatch',
      category: 'send_health',
      fields: { purpose: purpose.key, active, cap: config.maxConcurrentCalls },
    });
    return { kind: 'skipped', reason: 'max_concurrency' };
  }

  // 5. Balance BEFORE any attempt row, so a refusal leaves nothing orphaned.
  let balance: number;
  try {
    balance = (await getAccountInfo(config.auth, BALANCE_TIMEOUT_MS)).result.balance;
  } catch {
    return { kind: 'skipped', reason: 'balance_check_failed' };
  }
  if (balance < config.minCallReserve) {
    await sendSlackAlert({
      level: 'error',
      title: 'Voximplant balance below reserve — voice-purpose call blocked',
      source: 'voice-purpose-dispatch',
      category: 'send_health',
      fields: { purpose: purpose.key, balance, minReserve: config.minCallReserve },
    });
    return { kind: 'blocked', reason: 'balance_below_reserve' };
  }

  // 6. The attempt row IS the idempotency. `voice_purpose_attempts_step_uidx` is
  //    unique on (run_id, node_id, contact_id), so a replayed step — which the
  //    step lease can cause — collides here instead of telephoning twice.
  const accessToken = randomBytes(32).toString('base64url');
  const tokenExpiresAt = new Date(nowMs + purpose.tokenTtlSec * 1000).toISOString();
  const { data: attempt, error: insertErr } = await admin
    .from('voice_purpose_attempts')
    .insert({
      purpose_key: purpose.key,
      event_id: input.eventId,
      contact_id: input.contactId,
      run_id: input.runId ?? null,
      node_id: input.nodeId ?? null,
      access_token: accessToken,
      token_expires_at: tokenExpiresAt,
    })
    .select('id')
    .single();

  if (insertErr) {
    // 23505 = the unique index above. Expected on a replay, not an error.
    if (insertErr.code === '23505') {
      const { data: existing } = await admin
        .from('voice_purpose_attempts')
        // The EXISTING row's expiry, never `tokenExpiresAt` above: that one was
        // computed for an insert that did not happen, and a replay hours later
        // would hand a caller a ceiling further out than the token it belongs to.
        .select('id, token_expires_at')
        .eq('contact_id', input.contactId)
        .eq('run_id', input.runId ?? '')
        .eq('node_id', input.nodeId ?? '')
        .maybeSingle();
      return {
        kind: 'already_dispatched',
        attemptId: existing?.id ?? '',
        ...(existing?.token_expires_at ? { tokenExpiresAt: existing.token_expires_at } : {}),
      };
    }
    return { kind: 'skipped', reason: 'attempt_insert_failed' };
  }

  const origin = await getAppOrigin();
  // ⚠️ `u` IS THE ORIGIN, NOT A FULL URL — and that is a budget decision, not a
  // style one. VoxEngine.customData() is capped at 200 BYTES (documented in
  // platform/voxengine/custom-data), and a full ctx URL already spent 181 of
  // them. Adding a cb URL of the same shape measured 278 — over the cap, and the
  // scenario would have received a truncated payload.
  //
  // So the scenario is handed the ORIGIN plus the purpose key and builds both
  // URLs itself:
  //     `${u}/api/voximplant/purpose/${p}/ctx/${tok}`
  //     `${u}/api/voximplant/purpose/${p}/cb/${tok}`
  // which is exactly what RSVP.voxengine.js already does with its own origin
  // (it composes contextUrl and callbackUrl from `u` + `tok`). This payload
  // measures 127 bytes, leaving real headroom.
  //
  // The payload still carries NO guest data — the token is the only key, and the
  // context comes back over ctx.
  const payload = JSON.stringify({
    to: phone,
    from: config.callerId,
    tok: accessToken,
    u: origin,
    p: purpose.key,
  });

  try {
    const res = await startScenarios(
      config.auth,
      { rule_id: purpose.ruleId, script_custom_data: payload },
      START_TIMEOUT_MS,
    );
    if (res.result === 1 && res.call_session_history_id != null) {
      await admin
        .from('voice_purpose_attempts')
        .update({
          dispatch_status: 'confirmed',
          vox_call_session_history_id: res.call_session_history_id,
        })
        .eq('id', attempt.id);
      return {
        kind: 'dialed',
        attemptId: attempt.id,
        callSessionHistoryId: res.call_session_history_id,
        tokenExpiresAt,
      };
    }
    // A response we cannot classify is recorded as UNKNOWN, never as failed: the
    // call may well be ringing, and marking it failed would invite a retry that
    // telephones the person twice.
    await admin
      .from('voice_purpose_attempts')
      .update({ dispatch_status: 'unknown', finish_reason: 'ambiguous_start_response' })
      .eq('id', attempt.id);
    return { kind: 'start_unknown', attemptId: attempt.id, tokenExpiresAt };
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      await admin
        .from('voice_purpose_attempts')
        .update({ dispatch_status: 'failed', finish_reason: e.message.slice(0, 200) })
        .eq('id', attempt.id);
      return { kind: 'failed_to_start', attemptId: attempt.id, code: e.code ?? undefined };
    }
    if (e instanceof VoximplantNetworkError) {
      await admin
        .from('voice_purpose_attempts')
        .update({ dispatch_status: 'unknown', finish_reason: 'network_error_during_start' })
        .eq('id', attempt.id);
      return { kind: 'start_unknown', attemptId: attempt.id, tokenExpiresAt };
    }
    throw e;
  }
}
