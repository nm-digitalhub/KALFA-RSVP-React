import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { countActiveCallsAllSurfaces } from '@/lib/data/voximplant-concurrency';
import {
  getAccountInfo,
  VoximplantApiError,
  VoximplantNetworkError,
  type VoximplantConfig,
} from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';

// The provider-facing steps the two callback_requests dispatchers share
// (meeting-confirm-dispatch.ts, sales-call-dispatch.ts): the concurrency cap,
// the balance precheck and the StartScenarios call with its definite/ambiguous
// classification. Each dispatcher keeps its own gates, its own attempt table
// and its own result type; nothing here decides WHETHER a row may be dialed.

const BALANCE_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 25_000;

export type CallbackDialDispatchConfig = {
  auth: VoximplantConfig;
  ruleId: string;
  callerId: string;
  minCallReserve: number;
  lowBalanceThreshold: number;
  maxConcurrentCalls: number;
  // The AI-calling kill switch of the persona being dispatched, resolved by the
  // caller from its own app_settings flag. A plain boolean parameter, not read
  // here: each persona must be stoppable independently of RSVP outreach, and it
  // keeps the dispatchers unit-testable.
  callsEnabled: boolean;
};

export type DispatchAlert = (
  level: 'warn' | 'error',
  title: string,
  fields: Record<string, string | number>,
) => Promise<void>;

export function dispatchAlerter(source: string): DispatchAlert {
  return async (level, title, fields) => {
    await sendSlackAlert({ level, title, source, category: 'send_health', fields });
  };
}

// Single source of truth for the scenario payload (Branch B, same shape as
// outreach-calls.ts's buildScriptCustomData). Deliberately narrower: no `ca`/
// `dh` DTMF-handoff keys — neither persona has a live-takeover mechanism in v1
// (escalation is at console_queues for MVP, not a conference bridge), so a
// scenario built against this payload should never expect them.
export function buildCallbackDialCustomData(args: {
  to: string;
  from: string;
  tok: string;
  u: string;
}): { payload: string; bytes: number } {
  const payload = JSON.stringify({ to: args.to, from: args.from, tok: args.tok, u: args.u });
  return { payload, bytes: Buffer.byteLength(payload, 'utf8') };
}

type DispatchedCall = {
  config: CallbackDialDispatchConfig;
  callbackRequestId: string;
  // Names the persona in alert titles ("meeting-confirm", "sales-closing").
  callLabel: string;
  alert: DispatchAlert;
};

export type DialCapacityRefusal =
  | { kind: 'max_concurrency' }
  | { kind: 'blocked'; reason: 'balance_below_reserve' }
  | { kind: 'transient_error'; reason: 'balance_check_failed' };

// Concurrency cap, then the balance precheck — both BEFORE any attempt row is
// created (so no orphaned row). The cap is the COMBINED cross-table count
// (voximplant-concurrency.ts), never one attempt table counted alone: every
// surface shares one Voximplant account/balance. Returns null when the dial may
// proceed; a balance under the low threshold only warns.
export async function checkDialCapacity(call: DispatchedCall): Promise<DialCapacityRefusal | null> {
  const { config, callbackRequestId, callLabel, alert } = call;
  const active = await countActiveCallsAllSurfaces();
  if (active >= config.maxConcurrentCalls) {
    await alert('warn', `Voximplant max concurrency reached — ${callLabel} call skipped`, {
      callbackRequestId, active, cap: config.maxConcurrentCalls,
    });
    return { kind: 'max_concurrency' };
  }

  let balance: number;
  try {
    const info = await getAccountInfo(config.auth, BALANCE_TIMEOUT_MS);
    balance = info.result.balance;
  } catch {
    return { kind: 'transient_error', reason: 'balance_check_failed' };
  }
  if (balance < config.minCallReserve) {
    await alert('error', `Voximplant balance below reserve — ${callLabel} call blocked`, {
      callbackRequestId, balance, minReserve: config.minCallReserve,
    });
    return { kind: 'blocked', reason: 'balance_below_reserve' };
  }
  if (balance < config.lowBalanceThreshold) {
    await alert('warn', 'Voximplant balance low', { callbackRequestId, balance, lowThreshold: config.lowBalanceThreshold });
    // proceed — warn only.
  }
  return null;
}

export type StartedCallResult =
  | { kind: 'dialed'; attemptId: string; callSessionHistoryId: number }
  | { kind: 'failed_to_start'; attemptId: string; code: number | null }
  | { kind: 'start_unknown'; attemptId: string };

// The dispatcher's own attempt-table writers for the three start outcomes.
type AttemptWriters = {
  recordDialConfirmed: (attemptId: string, callSessionHistoryId: number) => Promise<unknown>;
  markUnknown: (attemptId: string, reason: string) => Promise<unknown>;
  markFailed: (attemptId: string, reason: string) => Promise<unknown>;
};

// StartScenarios — definite vs ambiguous classification, identical discipline
// to dispatchOutreachCall. A definite provider rejection is failed_to_start; a
// network error or a response without a confirmed session is start_unknown and
// never triggers a redial. Anything else is rethrown for the caller's own catch.
export async function startDispatchedCall(
  call: DispatchedCall & { attemptId: string; payload: string; attempts: AttemptWriters },
): Promise<StartedCallResult> {
  const { config, callbackRequestId, callLabel, alert, attemptId, payload, attempts } = call;
  try {
    const res = await startScenarios(config.auth, { rule_id: config.ruleId, script_custom_data: payload }, START_TIMEOUT_MS);
    if (res.result === 1 && res.call_session_history_id != null) {
      await attempts.recordDialConfirmed(attemptId, res.call_session_history_id);
      return { kind: 'dialed', attemptId, callSessionHistoryId: res.call_session_history_id };
    }
    await attempts.markUnknown(attemptId, 'ambiguous_start_response');
    return { kind: 'start_unknown', attemptId };
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      await attempts.markFailed(attemptId, e.message);
      await alert('warn', `Voximplant StartScenarios rejected ${callLabel} call (failed_to_start)`, {
        callbackRequestId, attemptId, code: e.code ?? 0,
      });
      return { kind: 'failed_to_start', attemptId, code: e.code };
    }
    if (e instanceof VoximplantNetworkError) {
      await attempts.markUnknown(attemptId, 'network_error_during_start');
      await alert('warn', `Voximplant StartScenarios ambiguous for ${callLabel} call (start_unknown)`, {
        callbackRequestId, attemptId,
      });
      return { kind: 'start_unknown', attemptId };
    }
    throw e; // truly unexpected — let the caller's own catch alert + rethrow
  }
}
