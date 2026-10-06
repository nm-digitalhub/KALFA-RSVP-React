// Pure decisions for scheduler.mjs's answer-watcher — no I/O, no deps, so the
// scheduler stays zero-dependency and this stays unit-testable (scheduler.mjs
// itself starts its interval on import and cannot be loaded by a test).
//
// Why a per-verdict cap exists: commit 7465ab6 (2026-08-31) turned the
// verdict marker from a one-shot flag into a 4-minute cooldown so a
// lock-skipped spawn gets retried. That fixed stranding, but assumed every
// verdict is consumable. Measured 2026-09-27: an approved publish_social
// verdict (62dc162c) that the role could not consume — publish-social past
// its retry ceiling, ack refused by design — was re-spawned 45 times in one
// day, until answer_daily_run_cap (50, shared by ALL roles) ran out and every
// other role's verdicts were deferred with it.
//
// Two counters, because the scheduler cannot see whether a spawn actually ran
// (spawn is fire-and-forget; run-role.sh's flock is non-blocking):
//   starts — runs that really acquired the lock for this verdict. run-role.sh
//            appends one byte to locks/verdict-<id>.starts after its flock.
//   spawns — every spawn attempt, including lock-skips. Backstop only.

export const VERDICT_RETRY_COOLDOWN_MS = 4 * 60_000;
export const VERDICT_MAX_STARTS = 3;
export const VERDICT_MAX_SPAWNS = 12;
export const ANSWER_ROLE_DAILY_CAP_DEFAULT = 10;

/** Marker file content -> state. Accepts the legacy bare epoch-ms number written
 * before this module existed (treated as one past spawn), so deploying this
 * never re-arms or strands an in-flight verdict. */
export function parseVerdictMarker(raw) {
  const text = String(raw ?? '').trim();
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text);
      return {
        last: Number(o.last) || 0,
        spawns: Number(o.spawns) || 0,
        stranded: o.stranded === true,
        escalated: o.escalated === true,
      };
    } catch {
      // fall through: a corrupt marker behaves like a legacy one
    }
  }
  const last = Number(text) || 0;
  return { last, spawns: last > 0 ? 1 : 0, stranded: false, escalated: false };
}

export function serializeVerdictMarker(state) {
  return JSON.stringify(state);
}

/**
 * @returns {{action: 'skip', reason: string} | {action: 'spawn'} | {action: 'strand', reason: string} | {action: 'escalate'}}
 */
export function decideVerdictSpawn({
  marker,
  starts,
  now,
  cooldownMs = VERDICT_RETRY_COOLDOWN_MS,
  maxStarts = VERDICT_MAX_STARTS,
  maxSpawns = VERDICT_MAX_SPAWNS,
}) {
  if (marker.stranded) return marker.escalated ? { action: 'skip', reason: 'stranded' } : { action: 'escalate' };
  if (now - marker.last < cooldownMs) return { action: 'skip', reason: 'cooldown' };
  if (starts >= maxStarts) return { action: 'strand', reason: `${starts} runs did not consume it` };
  if (marker.spawns >= maxSpawns) return { action: 'strand', reason: `${marker.spawns} spawns did not consume it` };
  return { action: 'spawn' };
}

/** Per-role daily answer budget. Returns true when this role may spawn again
 * today. A role at its own cap is skipped (`continue`), leaving the shared
 * answer_daily_run_cap for every other role. */
export function roleHasAnswerBudget(roleCountToday, roleCap = ANSWER_ROLE_DAILY_CAP_DEFAULT) {
  return roleCountToday < roleCap;
}
