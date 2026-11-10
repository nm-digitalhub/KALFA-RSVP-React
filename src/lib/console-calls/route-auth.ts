import 'server-only';

import type { NextResponse } from 'next/server';

import {
  callerHasPlatformPermission,
  requireConsoleAgent,
  type ConsoleAgentContext,
} from '@/lib/auth/console-agent';
import { noStoreJson } from '@/lib/http/no-store-json';

// The staff gate of every route that acts on a live call or places one from the agent console. STAFF ONLY: a
// customer-facing route must never call this.

/** A step of a route handler: either its value, or the response the route must return as-is. */
export type RouteStep<T> = ({ ok: true } & T) | { ok: false; response: NextResponse };

/**
 * requireConsoleAgent (Bearer JWT + the staff-gated is_console_agent), then the manage_voice platform permission,
 * in that order. A failure carries the ready 401/403 answer; nothing else of the request is read here.
 */
export async function requireManageVoiceAgent(
  request: Request,
): Promise<RouteStep<{ ctx: ConsoleAgentContext }>> {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return { ok: false, response: noStoreJson({ error: auth.error }, auth.status) };

  if (!(await callerHasPlatformPermission(auth.ctx.supabase, 'manage_voice'))) {
    return { ok: false, response: noStoreJson({ error: 'אין הרשאה' }, 403) };
  }
  return { ok: true, ctx: auth.ctx };
}
