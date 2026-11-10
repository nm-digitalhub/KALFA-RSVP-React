import 'server-only';

import type { NextResponse } from 'next/server';
import type { z } from 'zod';

import type { AgentToolGuardResult } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore } from '@/lib/voximplant/no-store-response';

// Route-side plumbing shared by the token-gated Voximplant endpoints
// (/api/voximplant/{cb,ctx}/{token}, agent-tool/*, {mtg,sls}/{cb,ctx,tool/*}).
// It holds no authorization of its own: every route still names the guard it
// authorizes against (guardAgentToolRequest / guardMeetingToolRequest /
// guardSalesToolRequest) and passes it in, so the table a route trusts is
// visible in the route file and a test can mock that guard as before.

type ToolGuard = (
  req: Request,
  token: string,
  opts: { scope: string; maxBodyBytes: number },
) => Promise<AgentToolGuardResult>;

export type ToolRequestResult<T> =
  | { ok: true; attemptId: string; data: T }
  | { ok: false; response: NextResponse };

/**
 * Guard → JSON → schema, in that order, for a token-gated POST.
 *
 * A guard refusal answers with the guard's own status; a body that is not JSON
 * or does not match `schema` answers 400. All refusals are bodiless.
 *
 * `emptyBodyAsObject` is for tools whose schema has no required field: the
 * bridge may post nothing at all, and a blank body is then read as `{}`
 * instead of failing JSON.parse. Off by default — a tool that needs arguments
 * must keep rejecting an empty body.
 */
export async function readToolRequest<T>(
  req: Request,
  token: string,
  opts: {
    guard: ToolGuard;
    scope: string;
    maxBodyBytes: number;
    schema: z.ZodType<T>;
    emptyBodyAsObject?: boolean;
  },
): Promise<ToolRequestResult<T>> {
  const guard = await opts.guard(req, token, {
    scope: opts.scope,
    maxBodyBytes: opts.maxBodyBytes,
  });
  if (!guard.ok) return { ok: false, response: emptyNoStore(guard.status) };

  let json: unknown;
  try {
    json = opts.emptyBodyAsObject && guard.raw.trim() === '' ? {} : JSON.parse(guard.raw);
  } catch {
    return { ok: false, response: emptyNoStore(400) };
  }

  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) return { ok: false, response: emptyNoStore(400) };

  return { ok: true, attemptId: guard.attemptId, data: parsed.data };
}

/**
 * Runs a synchronous best-effort tool write and reduces it to the boolean the
 * agent hears: the processor's own `ok`, or false when it throws. Never
 * rethrows — a tool call must answer the agent truthfully, not with a 500.
 */
export async function okOrFalse(run: () => Promise<{ ok: boolean }>): Promise<boolean> {
  try {
    return (await run()).ok;
  } catch {
    return false;
  }
}

/**
 * The bookkeeping half of a scenario's terminal-lifecycle report
 * ({mtg,sls}/cb): move the attempt to 'concluded', then store the ElevenLabs
 * conversation id when one was sent.
 *
 * Returns false only when the 'concluded' write threw (the route answers 500).
 * The conversation-id write is best-effort: dispatch_status is already
 * recorded by then, and a failure must never leak DB detail or fail the ack.
 */
export async function recordTerminalReport(
  attemptId: string,
  body: {
    call_status: string;
    error_reason?: string | null;
    call_duration?: number | null;
    el_conversation_id?: string | null;
  },
  writers: {
    recordConcluded: (
      attemptId: string,
      finishReason: string,
      callDurationSec: number | null,
    ) => Promise<unknown>;
    setElConversationId: (attemptId: string, elConversationId: string) => Promise<unknown>;
  },
): Promise<boolean> {
  try {
    await writers.recordConcluded(
      attemptId,
      body.error_reason ?? body.call_status,
      body.call_duration ?? null,
    );
  } catch {
    return false;
  }

  if (typeof body.el_conversation_id === 'string' && body.el_conversation_id.length > 0) {
    try {
      await writers.setElConversationId(attemptId, body.el_conversation_id);
    } catch {
      /* best-effort — see the function header */
    }
  }

  return true;
}
