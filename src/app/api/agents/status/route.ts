import { NextResponse } from 'next/server';

import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { agentStatusSchema } from '@/lib/validation/agent-console';

// POST /api/agents/status  { "status": "ready|not_ready|dnd" }
//
// A console agent sets their OWN presence. `in_call` is system-managed and is
// deliberately NOT accepted here (agentStatusSchema) — the server infers "busy"
// from an active human_agent_call_legs row, it is never a client declaration.
//
// Auth = requireConsoleAgent (Bearer Supabase-JWT + the staff-gated
// is_console_agent). The write is the agent's OWN agent_status row via the
// caller-scoped client, so RLS (agent_status_upsert_own / _update_own) enforces
// agent_id = auth.uid() at the database — the route never trusts a client id.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024; // a status body is tiny; reject anything larger
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'בקשה גדולה מדי' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }

  const result = agentStatusSchema.safeParse(parsed);
  if (!result.success) return json({ error: 'סטטוס לא תקין' }, 400);

  // Own-row upsert as the caller (RLS-scoped). agent_id is the authenticated user,
  // never a value from the body.
  const { error } = await ctx.supabase.from('agent_status').upsert(
    {
      agent_id: ctx.userId,
      status: result.data.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'agent_id' },
  );
  if (error) return json({ error: 'שמירת הסטטוס נכשלה' }, 500);

  return json({ ok: true, status: result.data.status }, 200);
}
