import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentCommand, AppliedState } from '@/lib/validation/agent-console';

// Audit writer for console-agent interventions in a LIVE call.
//
// A whisper is not a passive act: /api/calls/{id}/agent-command injects text the
// AI acts on while a real guest is on the line. Until this existed the route
// recorded nothing at all — no actor, no time, no call, no content — so a call
// whose outcome a staff member changed was indistinguishable from one they never
// touched.
//
// Written through the service-role client because the table is closed to every
// client role (no grants, RLS on): the console produces the trail and must not
// be able to read or amend it.

export interface ConsoleAgentCommandRecord {
  /** The acting console agent (auth uid) — resolved from the Bearer session. */
  agentId: string;
  callAttemptId: string;
  /** Denormalised so the trail survives independently of the attempt row. */
  eventId: string | null;
  command: AgentCommand;
  /**
   * The staff member's own words, for the two text-bearing commands; null for
   * clear_buffer / close_agent, which carry no payload.
   *
   * Stored deliberately, and deliberately unlike support_access_log, which never
   * stores the data a staff member SAW. There the content is the customer's;
   * copying it into the audit would spread the exposure. Here it is what the
   * staff member CHOSE TO SAY into someone else's conversation, and an audit
   * that cannot answer "what did they say" does not answer "what did they do".
   */
  text: string | null;
  requestId: string;
  /** Whether the live session accepted the POST. False rows are kept on purpose. */
  delivered: boolean;
  applied: AppliedState;
}

export async function recordConsoleAgentCommand(
  rec: ConsoleAgentCommandRecord,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('console_agent_commands').insert({
    agent_id: rec.agentId,
    call_attempt_id: rec.callAttemptId,
    event_id: rec.eventId,
    command: rec.command,
    command_text: rec.text,
    request_id: rec.requestId,
    delivered: rec.delivered,
    applied: rec.applied,
  });
  if (error) {
    // Surfaced, never swallowed silently — but NOT fatal to the caller. The
    // command has already reached (or failed to reach) the live call by the time
    // this runs; throwing here would report failure for something that happened.
    // The route logs this loudly instead. Contrast recordStaffAccess, which is
    // fail-closed because there the audit precedes the read it authorises.
    throw new Error(`console_agent_commands insert failed: ${error.code ?? 'unknown'}`);
  }
}
