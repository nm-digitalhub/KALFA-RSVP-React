/**
 * The "your permissions changed" signal for an open admin page.
 *
 * BROWSER ONLY: uses the browser Supabase client (@/lib/supabase/client). Call it from a Client Component effect.
 *
 * The database sends an EMPTY broadcast, event `permissions_changed`, on the private topic `staff:<user_id>` whenever a
 * row that feeds that user's platform or console permission decisions changes (migration
 * 20261022100542_platform_permission_change_signal). The only realtime.messages policy lets a user join exactly their
 * own topic. The message carries no permission data: the caller re-reads from the server (router.refresh()), which
 * re-renders the admin layout and rebuilds the CASL rules, the navigation grants and the softphone gate.
 *
 * Missed signals use the client's own Broadcast Replay (supabase.com/docs/guides/realtime/broadcast, "Broadcast
 * replay": private channels, messages sent from the database, `since` in epoch ms). `since` is the time the server
 * rendered the page, so a signal sent after that render is delivered on join, and again on a re-join after a dropped
 * connection. Each refresh re-renders the layout with a new `since`, so the caller re-subscribes from that point and an
 * already-handled signal is not replayed.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

export const PERMISSIONS_CHANGED_EVENT = 'permissions_changed';

/** The topic the realtime.messages policy admits for this user, and the one the trigger sends to. */
export function permissionTopic(userId: string): string {
  return `staff:${userId}`;
}

export function subscribePermissionChanges(userId: string, since: number, onChange: () => void): () => void {
  const supabase = createClient();
  let disposed = false;
  let channel: RealtimeChannel | null = null;

  void (async () => {
    // A private channel is authorised with the socket's token AT JOIN, and RealtimeChannel.subscribe() reads that
    // token synchronously. The client resolves the token itself (SupabaseClient passes `accessToken` to the
    // RealtimeClient and calls realtime.setAuth on every auth event); setAuth() with no argument asks it to resolve
    // through that same callback now, so the join does not race it. No session handling of our own.
    await supabase.realtime.setAuth();
    if (disposed) return;

    // The topic must be exactly staff:<uid>, so it cannot get a random suffix. RealtimeClient.channel() returns an
    // existing channel for the same topic (realtime-js RealtimeClient.channel), and under StrictMode's
    // mount -> cleanup -> mount the first one may still be leaving. Remove it before creating a fresh one.
    const topic = permissionTopic(userId);
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (stale) await supabase.removeChannel(stale);
    if (disposed) return;

    channel = supabase
      // limit 1: one missed signal is enough to re-read; the message carries nothing else.
      .channel(topic, { config: { private: true, broadcast: { replay: { since, limit: 1 } } } })
      .on('broadcast', { event: PERMISSIONS_CHANGED_EVENT }, () => {
        if (!disposed) onChange();
      })
      .subscribe();
  })();

  return () => {
    disposed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
