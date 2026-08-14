// Pure presence helpers shared by the SERVER router and the BROWSER roster —
// same seam discipline as chat.ts and call-snapshot.ts.
//
// Why this file exists: agent_status.status is a STANDING declaration ("I am
// available"), not a liveness signal. Nothing clears it when a browser tab
// closes, a laptop sleeps, or an SDK session drops — the row simply stops
// being updated. Liveness is the heartbeat (agent_status.updated_at), and the
// router has always known that: findRoutableAgents requires status='ready'
// AND a heartbeat inside the freshness window, so a stale 'ready' agent is
// correctly never rung.
//
// The ROSTER did not know it. It rendered the raw status, so an agent who had
// closed their laptop hours earlier still displayed as "זמין" to everyone
// else, and CallBar's transfer/consult/conference picker still offered them
// as a target. MEASURED 13.8: the only provisioned agent showed status
// 'ready' with a heartbeat 661 minutes old while every inbound call was
// (correctly) answered with "אין נציג זמין". The router and the roster were
// telling opposite stories about the same person.
//
// The rule lives HERE, in one client-safe module, rather than being restated
// in the view SQL or copied into each component: console-calls.ts imports the
// window from this file too, so the server router and every browser surface
// age agents out at exactly the same moment by construction.

/**
 * How long an agent_status row stays trustworthy after its last heartbeat.
 * The panel beats every 60s, so 90s tolerates exactly one missed beat before
 * the agent is treated as gone — long enough to ride out a hiccup, short
 * enough that a closed laptop stops being offered as a call target within a
 * minute and a half.
 */
export const AGENT_STATUS_FRESHNESS_MS = 90_000;

export type PresenceStatus = 'ready' | 'not_ready' | 'dnd' | 'in_call';

/** Adds the one state the DB column cannot express: nobody is home. */
export type EffectivePresence = PresenceStatus | 'offline';

/**
 * The honest, display-and-targeting answer to "what is this agent right now".
 *
 * A stale heartbeat collapses EVERY stored status to 'offline' — including
 * 'dnd' and 'in_call', which are just as untrustworthy once the session that
 * set them is gone. Callers should treat 'offline' as "not selectable", which
 * matches what the server would do with the same row.
 *
 * `heartbeatIso` null/unparseable ⇒ 'offline' (fail-closed): an agent we
 * cannot prove is live must never be offered as a call target. Pure — the
 * caller passes `nowMs`, so this stays safe to use during a React render.
 */
export function effectivePresence(
  status: PresenceStatus,
  heartbeatIso: string | null | undefined,
  nowMs: number,
): EffectivePresence {
  if (!heartbeatIso) return 'offline';
  const beatMs = Date.parse(heartbeatIso);
  if (!Number.isFinite(beatMs)) return 'offline';
  if (nowMs - beatMs > AGENT_STATUS_FRESHNESS_MS) return 'offline';
  return status;
}
