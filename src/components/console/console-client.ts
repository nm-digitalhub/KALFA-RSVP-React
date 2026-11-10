import { createClient } from '@/lib/supabase/client';
import {
  makePollingFallback,
  REALTIME_SUBSCRIBE_STATES,
  type ChangeCallback,
  type StatusCallback,
} from '@/lib/realtime/console-channels';

// Browser-side plumbing the softphone console's components share: the session
// token the console routes authenticate with, the POST that carries it, and the
// "live feed, polling while the channel is down" wiring every console read uses.

// The signed-in agent's access token, or null when there is no session.
export async function bearerToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// A JSON POST to a console route, authenticated with the agent's token. The
// caller reads the response: a 2xx from these routes means "delivered", never
// "done" — each component takes the outcome from its own feed.
export function postWithBearer(url: string, token: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

// Subscribes `refresh` to a console Realtime feed and, while the channel is not
// joined (CHANNEL_ERROR / TIMED_OUT / CLOSED), polls instead — the data must
// still update, just less promptly. The polling stops as soon as the channel
// reports SUBSCRIBED, so a healthy connection never pays for a second loop.
// Returns the cleanup for both.
export function subscribeWithPollingFallback(
  subscribe: (onChange: ChangeCallback, onStatus?: StatusCallback) => () => void,
  refresh: () => void,
  pollMs: number,
): () => void {
  let stopPolling: (() => void) | null = null;
  const stopRealtime = subscribe(
    () => refresh(),
    (status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        stopPolling?.();
        stopPolling = null;
        return;
      }
      if (!stopPolling) stopPolling = makePollingFallback(refresh, pollMs);
    },
  );
  return () => {
    stopRealtime();
    stopPolling?.();
  };
}
