// Manual smoke test of the owner-agent runner (plan §8 stage 6a): ONE real
// question through `claude -p` and the owner-agent MCP server. NOT a test and
// never run by CI or an agent — the owner runs it by hand, from the repository
// root of the tree that holds .claude/fleet/.token.env and .env.local:
//
//   OWNER_AGENT_SMOKE_CONFIRM=yes \
//   OWNER_AGENT_SMOKE_PERMISSIONS=view_events,view_webhooks \
//     npm run owner-agent:smoke -- "כמה אירועים פעילים יש?"
//
// What it costs and touches: one model run on the fleet's OAuth token, and
// read-only count queries against the LIVE database / GA4 through whichever
// tools the permissions unlock. It sends no WhatsApp message and writes
// nothing. It prints the answer (phone-shaped runs already masked), the cost,
// the turns, the session id and the tools called — or a bare error code.
//
// Then, by eye: the answer against /admin, and the session file under
// ~/.claude/projects/-var-www-vhosts-kalfa-me-beta--fleet-logs-owner-agent-cwd/.

import { OWNER_AGENT_PERMISSIONS, type OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import { OwnerAgentRunError, runOwnerAgent } from '@/lib/owner-agent/runner';

const SYSTEM_PROMPT = [
  'אתה עוזר הנתונים העסקיים של KALFA, ועונה לבעלים בוואטסאפ.',
  'ענה בעברית, בקצרה, רק על סמך תוצאות הכלים. אם אין כלי שעונה על השאלה, אמור זאת.',
  'לעולם אל תמציא מספרים.',
].join('\n');

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

  try {
    const result = await runOwnerAgent({
      prompt: question,
      systemPrompt: SYSTEM_PROMPT,
      permissions,
      model: 'sonnet',
      maxTurns: 6,
      timeoutMs: 3 * 60 * 1000,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      `owner-agent-smoke: failed — ${error instanceof OwnerAgentRunError ? error.code : 'unexpected_error'}`,
    );
    process.exit(1);
  }
}

void main();
