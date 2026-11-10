import {
  computeRingOrder,
  findRoutableAgentVoxUsernames,
  updateConsoleCallStatus,
} from '@/lib/data/console-calls';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';

// The second, authoritative pass of a "ring the console agents" authorize gate
// (call-me-now-authorize and widget-authorize), run AFTER the route verified
// the scenario secret and the dial token. A dial token only proves the call was
// admitted within the last 60s — not that the flag, live calls, the balance
// reserve, concurrency or the daily breaker still hold a few seconds later —
// so those are re-read fresh here.
//
// Each route passes its OWN flag reader, counters and thresholds: the two
// flows are capped independently, and nothing here may default one flow's
// numbers onto the other. The per-visitor admission cap (per phone / per IP)
// is intentionally NOT re-checked — it gated the mint, and the token exists
// only because that check passed for this exact call.

export type RingAuthorization = { ok: true; ringOrder: string[] } | { ok: false };

export async function authorizeConsoleRing(input: {
  callId: string;
  flagEnabled: () => Promise<boolean>;
  countConcurrentAnswered: () => Promise<number>;
  countAnsweredToday: (nowMs: number) => Promise<number>;
  caps: {
    maxConcurrency: number;
    dailyCallCap: number;
    dailySpendCapUsd: number;
    estimatedCostPerCallUsd: number;
  };
}): Promise<RingAuthorization> {
  const nowMs = Date.now();
  let flagEnabled: boolean;
  let liveCallsEnabled: boolean;
  let concurrentAnswered: number;
  let answeredToday: number;
  let balanceOk: boolean;
  try {
    const [flag, vconfig, concurrent, today, balance] = await Promise.all([
      input.flagEnabled(),
      getVoximplantConfig(),
      input.countConcurrentAnswered(),
      input.countAnsweredToday(nowMs),
      checkInboundBalanceReserve(nowMs),
    ]);
    flagEnabled = flag;
    liveCallsEnabled = !!vconfig?.liveCallsEnabled;
    concurrentAnswered = concurrent;
    answeredToday = today;
    balanceOk = balance.ok;
  } catch {
    return { ok: false }; // fail closed: an unreadable cap is a refusal
  }

  if (!flagEnabled || !liveCallsEnabled || !balanceOk) return { ok: false };
  if (concurrentAnswered >= input.caps.maxConcurrency) return { ok: false };
  const estSpendUsd = answeredToday * input.caps.estimatedCostPerCallUsd;
  if (answeredToday >= input.caps.dailyCallCap || estSpendUsd >= input.caps.dailySpendCapUsd) {
    return { ok: false };
  }

  let routable: string[];
  try {
    routable = await findRoutableAgentVoxUsernames();
  } catch {
    routable = []; // fail toward "no agent" — still ok with an empty ring, never a hard refuse
  }
  const ringOrder = computeRingOrder(routable, answeredToday);

  // Best-effort status bump: authorizing is immediately followed by the
  // scenario ringing agents, so "ringing" is real progress even if the
  // scenario's own /event report is lost. A failure must never block the ring.
  try {
    await updateConsoleCallStatus({ callId: input.callId, status: 'ringing', onlyIfLive: true });
  } catch {
    /* best-effort — see comment above */
  }

  return { ok: true, ringOrder };
}
