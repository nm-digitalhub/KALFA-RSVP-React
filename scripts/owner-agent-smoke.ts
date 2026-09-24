// Manual smoke test of the owner-agent runner (plan §8 stage 6a; free-read
// plan stage D): ONE real question through `claude -p`, the owner-agent MCP
// server and the read-only Supabase MCP server. NOT a test and never run by CI
// — run by hand, with explicit approval, from the repository root of the tree
// that holds .claude/fleet/.token.env, .env.local (OWNER_AGENT_SUPABASE_TOKEN)
// and supabase/.temp/project-ref:
//
//   OWNER_AGENT_SMOKE_CONFIRM=yes \
//   OWNER_AGENT_SMOKE_PERMISSIONS=view_events,view_webhooks \
//   [OWNER_AGENT_SMOKE_RESUME=<session id of an earlier smoke>] \
//     npm run owner-agent:smoke -- "כמה אירועים פעילים יש?"
//
// What it costs and touches: one model run on the fleet's OAuth token, and
// read-only queries against the LIVE database / GA4 — the count tools the
// permissions unlock, plus execute_sql / list_tables as supabase_read_only_user.
// It sends no WhatsApp message and writes nothing. It prints the answer as
// the model wrote it (no filter), the cost, the turns, the session id and the
// tools called — or a bare error code.
//
// Then, by eye: the answer against /admin, and the session file under
// ~/.claude/projects/-var-www-vhosts-kalfa-me-beta--fleet-logs-owner-agent-cwd/.

import {
  OWNER_AGENT_MAX_TURNS,
  OWNER_AGENT_MODEL,
  OWNER_AGENT_RUN_TIMEOUT_MS,
} from '@/lib/owner-agent/consumer/budgets';
import { OWNER_AGENT_SYSTEM_PROMPT, buildOwnerPrompt } from '@/lib/owner-agent/consumer/reply-text';
import { OWNER_AGENT_PERMISSIONS, type OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import { OwnerAgentRunError, runOwnerAgent } from '@/lib/owner-agent/runner';

// Exactly what the consumer sends (consumer/reply.ts runAnswer): the same
// system prompt, the same prompt wrapper (Israel date and time first), model,
// turns and timeout — so a smoke answer is the answer the WhatsApp side would
// give. Only the permission set and the optional session to resume come from
// here.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage(message: string): never {
  console.error(`owner-agent-smoke: ${message}`);
  console.error(
    'usage: OWNER_AGENT_SMOKE_CONFIRM=yes [OWNER_AGENT_SMOKE_PERMISSIONS=a,b] npm run owner-agent:smoke -- "<question>"',
  );
  process.exit(1);
}

function isPermission(key: string): key is OwnerAgentPermission {
  return (OWNER_AGENT_PERMISSIONS as readonly string[]).includes(key);
}

async function main(): Promise<void> {
  // The guard: a real model run and live reads happen only on an explicit yes.
  if (process.env.OWNER_AGENT_SMOKE_CONFIRM !== 'yes') {
    usage('refusing to run without OWNER_AGENT_SMOKE_CONFIRM=yes (this calls the real model)');
  }
  const question = process.argv[2];
  if (!question?.trim()) usage('no question given');

  const keys = (process.env.OWNER_AGENT_SMOKE_PERMISSIONS ?? 'view_events').split(',').filter(Boolean);
  const unknown = keys.filter((k) => !isPermission(k));
  if (unknown.length > 0) usage(`unknown permission key(s): ${unknown.join(', ')}`);
  const permissions = keys.filter(isPermission);

  // A follow-up question continues an earlier smoke session, the way the
  // consumer resumes within its 60-minute window.
  const resume = process.env.OWNER_AGENT_SMOKE_RESUME;
  if (resume !== undefined && !SESSION_ID.test(resume)) usage('OWNER_AGENT_SMOKE_RESUME must be a session id');

  try {
    const result = await runOwnerAgent({
      prompt: buildOwnerPrompt(question, Date.now()),
      systemPrompt: OWNER_AGENT_SYSTEM_PROMPT,
      permissions,
      model: OWNER_AGENT_MODEL,
      maxTurns: OWNER_AGENT_MAX_TURNS,
      timeoutMs: OWNER_AGENT_RUN_TIMEOUT_MS,
      ...(resume ? { resumeSessionId: resume } : {}),
    });
    // The session id is printed so the SQL the agent wrote can be read from
    // its transcript (path below).
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `session file: ~/.claude/projects/-var-www-vhosts-kalfa-me-beta--fleet-logs-owner-agent-cwd/${result.sessionId}.jsonl`,
    );
  } catch (error) {
    console.error(
      `owner-agent-smoke: failed — ${error instanceof OwnerAgentRunError ? error.code : 'unexpected_error'}`,
    );
    process.exit(1);
  }
}

void main();
