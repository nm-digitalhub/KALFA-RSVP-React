import 'server-only';

import { randomUUID } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';

// Data layer for human-agent monitor / takeover — the "attach a listening or
// speaking human leg to a live AI call" flow.
//
// The ROUTE owns authorization (Bearer + manage_voice); this owns the two facts
// the route needs from the database, plus the audit leg it records:
//   1. is the feature enabled at all (the kill switch), and
//   2. which Voximplant user is this console agent, so the scenario knows whom
//      to VoxEngine.callUser into the conference.
//
// human_agent_call_legs is the accountable record of the attach: who, which
// call, which mode, and — filled later by the scenario's callbacks — when the
// leg connected and disconnected. The route creates the 'requested' row; the
// scenario advances it. That table is closed to every client role, written only
// through the service-role client here.

export type AttachMode = 'monitor' | 'takeover';

/** OFF until the conference scenario is deployed and verified on a live call. */
export async function monitorEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('monitor_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.monitor_enabled === true;
}

/**
 * The console agent's own provisioned Voximplant identity, or null. Read from
 * the SESSION user id — never from the request body — so an agent can only ever
 * attach their OWN leg. Requires the stored secret too: a username without a
 * secret cannot log in, so it cannot be a real leg (same "provisioned means
 * both" rule the sign-in route uses).
 */
export async function attachableVoxUsername(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from('console_agents')
    .select('vox_username')
    .eq('user_id', userId)
    .maybeSingle();
  if (!agent?.vox_username) return null;

  const { data: secret } = await admin
    .from('console_agent_secrets')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return secret ? agent.vox_username : null;
}

export interface RequestedLeg {
  legId: string;
  requestId: string;
}

/**
 * Record the intent to attach, in the state the scenario expects to advance.
 *
 * Returns the request_id that correlates this leg with the command posted to the
 * session and with the scenario's later status callbacks. One agent may hold at
 * most one live leg per call — a second 'requested'/'connected' row for the same
 * (agent, attempt) is refused, so a double-tap cannot ring the agent twice.
 */
export async function createRequestedLeg(
  callAttemptId: string,
  agentId: string,
  mode: AttachMode,
): Promise<RequestedLeg | { error: 'already_attached' }> {
  const admin = createAdminClient();

  const { count } = await admin
    .from('human_agent_call_legs')
    .select('id', { count: 'exact', head: true })
    .eq('call_attempt_id', callAttemptId)
    .eq('agent_id', agentId)
    .in('status', ['requested', 'dialing', 'ringing', 'connected']);
  if ((count ?? 0) > 0) return { error: 'already_attached' };

  const requestId = randomUUID();
  const { data, error } = await admin
    .from('human_agent_call_legs')
    .insert({
      call_attempt_id: callAttemptId,
      agent_id: agentId,
      request_id: requestId,
      mode,
      status: 'requested',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('רישום רגל הנציג נכשל');

  return { legId: data.id, requestId };
}

export type LegStatus = 'dialing' | 'ringing' | 'connected' | 'disconnected' | 'failed';

// Which live transition stamps a timestamp column. `connected` records when the
// human joined; both terminal states record when the leg left.
const LEG_STATUS_STAMP: Partial<Record<LegStatus, 'connected_at' | 'disconnected_at'>> = {
  connected: 'connected_at',
  disconnected: 'disconnected_at',
  failed: 'disconnected_at',
};

/**
 * Advance a supervisor leg as the RSVPAgent scenario reports it (dialing →
 * connected → disconnected / failed). Scoped to `callAttemptId` — the attempt the
 * cb TOKEN resolved to — so a token can only ever move ITS OWN call's leg, never
 * another's. Best-effort: the app also observes its own SDK call state, so a lost
 * report degrades server-side bookkeeping, not the operator's screen.
 */
export async function advanceLegStatus(
  callAttemptId: string,
  requestId: string,
  legStatus: LegStatus,
  failureCode?: string,
): Promise<void> {
  const admin = createAdminClient();
  const patch: Database['public']['Tables']['human_agent_call_legs']['Update'] = {
    status: legStatus,
  };
  const stamp = LEG_STATUS_STAMP[legStatus];
  if (stamp) patch[stamp] = new Date().toISOString();
  if (failureCode) patch.failure_code = failureCode;

  await admin
    .from('human_agent_call_legs')
    .update(patch)
    .eq('request_id', requestId)
    .eq('call_attempt_id', callAttemptId);
}
