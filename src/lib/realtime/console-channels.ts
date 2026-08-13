/**
 * Supabase Realtime subscribers for the browser call-center console — the
 * repo's FIRST Realtime consumer (no other call site uses `.channel()`).
 *
 * BROWSER ONLY: uses the browser Supabase client (@/lib/supabase/client),
 * which needs `window`/cookies. Every export here is meant to be called from
 * a Client Component effect (web-client.ts / cookie-consent.tsx discipline).
 *
 * Row visibility is enforced entirely by the underlying table's RLS SELECT
 * policy, evaluated per-subscriber against THAT subscriber's own JWT —
 * postgres_changes replays exactly what that connection's SELECT would
 * return, never more. Both `agent_status` and `console_calls` gate on
 * is_console_agent(), so a non-console-agent subscriber receives zero events
 * (verified pattern on the other four published tables — see the stage-3
 * plan's app-db-foundations report). There is deliberately NO broadcast
 * channel here, and none should be added for this feature: broadcast has no
 * row-level policy of its own, so it would need hand-built authorization to
 * match what postgres_changes gets for free.
 */

import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

type Row = Record<string, unknown>;

export type ChangeCallback = (payload: RealtimePostgresChangesPayload<Row>) => void;
export type StatusCallback = (status: REALTIME_SUBSCRIBE_STATES) => void;

function subscribeTable(
  table:
    | 'agent_status'
    | 'console_calls'
    | 'console_call_feed'
    | 'human_agent_call_legs'
    | 'console_chat_messages',
  onChange: ChangeCallback,
  onStatus?: StatusCallback,
): () => void {
  const supabase = createClient();
  let disposed = false;
  let channel: RealtimeChannel | null = null;

  void (async () => {
    // Resolve auth BEFORE joining. RealtimeChannel.subscribe() reads the
    // socket's cached access token SYNCHRONOUSLY when it builds the join
    // payload — if this channel joins before the client has ever resolved a
    // session, it authenticates as anon, and an RLS-gated table like
    // agent_status/console_calls then delivers zero rows to it (verified
    // against the installed @supabase/realtime-js 2.112.1 source). The
    // client DOES self-heal this on its next auth cycle — a token-change is
    // pushed to already-joined channels — but that can lag; resolving the
    // session first removes the race window instead of relying on it.
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) await supabase.realtime.setAuth(token);
    if (disposed) return;

    // A topic unique per SUBSCRIBE CALL, not just per table. RealtimeClient
    // reuses an existing channel object for a topic it still holds
    // (`this.channels`), and removeChannel() is async — so under React
    // StrictMode's synchronous mount→cleanup→mount, a second subscribeTable()
    // call on a shared topic can find and reuse the FIRST (still tearing
    // down) channel instead of getting a fresh one, then error out from
    // underneath when that teardown completes. A random suffix makes that
    // collision impossible.
    channel = supabase
      .channel(`console-${table}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        if (!disposed) onChange(payload);
      })
      .subscribe((status) => {
        if (!disposed) onStatus?.(status);
      });
  })();

  return () => {
    disposed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

/** Presence changes for any console agent — drives roster + self-status refresh. */
export function subscribeAgentStatus(onChange: ChangeCallback, onStatus?: StatusCallback): () => void {
  return subscribeTable('agent_status', onChange, onStatus);
}

/** The live call board (console_calls). Unused before stage 4, wired now for reuse. */
export function subscribeConsoleCalls(onChange: ChangeCallback, onStatus?: StatusCallback): () => void {
  return subscribeTable('console_calls', onChange, onStatus);
}

/**
 * The live AI-call board (console_call_feed — mirrors call_attempts). RLS
 * gates on is_console_agent() same as the others (console_call_feed_select),
 * so a non-agent subscriber gets zero rows. This is the AI-handoff section's
 * feed (plan stage 6-UI): claim ownership lives on THIS row (agent_id /
 * handled_by / takeover_* — see the stage-1 column-grant migration), never on
 * human_agent_call_legs, which only tracks the human's OWN attach attempts.
 */
export function subscribeConsoleCallFeed(onChange: ChangeCallback, onStatus?: StatusCallback): () => void {
  return subscribeTable('console_call_feed', onChange, onStatus);
}

/**
 * A console agent's OWN monitor/takeover legs (human_agent_call_legs — RLS is
 * agent_id = auth.uid(), so this delivers only the subscriber's own rows,
 * never another agent's). This is the sole source of truth for "am I
 * connected" — never the 202 a monitor/agent-command POST returns (project
 * rule: no state without its own signal).
 */
export function subscribeHumanLegs(onChange: ChangeCallback, onStatus?: StatusCallback): () => void {
  return subscribeTable('human_agent_call_legs', onChange, onStatus);
}

/**
 * Internal agent-to-agent chat (console_chat_messages — plan "שלב 2"). RLS
 * gates on is_console_agent() same as every other table here, so a non-agent
 * subscriber gets zero rows. INSERT is append-only client-side (no route —
 * the RLS INSERT policy, author_id = auth.uid(), is the gate), so this is
 * purely a read-side feed: new rows from ANY agent arrive here, including
 * the sender's own (used to confirm a send actually landed — see the panel's
 * honest-UI discipline, never optimistic-render on Enter).
 */
export function subscribeChatMessages(onChange: ChangeCallback, onStatus?: StatusCallback): () => void {
  return subscribeTable('console_chat_messages', onChange, onStatus);
}

export { REALTIME_SUBSCRIBE_STATES };

/**
 * Polling fallback for when a Realtime channel errors or never joins. Calls
 * `fetchFn` every `intervalMs`, only while the tab is visible — the
 * auto-refresh pattern (src/app/(admin)/admin/analytics/_auto-refresh.tsx).
 * Returns a cleanup function. Callers decide WHEN to start this (e.g. only
 * once a subscribe status callback reports anything but SUBSCRIBED), so a
 * healthy Realtime connection never pays for a second polling loop.
 */
export function makePollingFallback(fetchFn: () => void, intervalMs = 60_000): () => void {
  if (typeof document === 'undefined') return () => {};
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') fetchFn();
  }, intervalMs);
  return () => clearInterval(id);
}
