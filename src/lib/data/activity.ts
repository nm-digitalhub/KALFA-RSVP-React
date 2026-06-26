import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';

type ActivityLogInsert = Database['public']['Tables']['activity_log']['Insert'];

export interface LogActivityInput {
  eventId?: string | null;
  userId?: string | null;
  /** Stable, machine-readable action name, e.g. 'event.created', 'rsvp.updated'. */
  action: string;
  /**
   * Structured, non-sensitive context for the action.
   *
   * IMPORTANT: never put raw personal data here. Pass identifiers and counts
   * (e.g. { guestId, importedCount: 42 }) — NOT names, phone numbers, email
   * addresses, RSVP free-text notes, tokens, or secrets. This row is an audit
   * record, not a data store for PII.
   */
  meta?: Record<string, unknown>;
}

/**
 * Append an audit row to `activity_log` using the request-scoped client, so the
 * insert runs under the caller's session and Row Level Security.
 *
 * Logging is best-effort and intentionally non-fatal: a failure to write the
 * audit row must not break the caller's primary flow (creating an event,
 * recording an RSVP, etc.). On error we emit a SAFE, non-PII message — the
 * action name plus a generic note, never the `meta` payload — and return. This
 * is a deliberate, documented decision, not silent error swallowing.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  const user = await requireUser();
  const { eventId = null, userId = null, action, meta } = input;

  const supabase = await createClient();

  // `meta` is a plain object; the column is typed `Json`. The two types are
  // structurally compatible at runtime but not directly assignable in
  // TypeScript, so we narrow through `unknown` here only. Documented per the
  // project's "no unsafe casts unless documented" rule; the contract above
  // forbids PII, so the content remains audit-safe.
  const row: ActivityLogInsert = {
    event_id: eventId,
    user_id: userId ?? user.id,
    action,
    ...(meta !== undefined
      ? { meta: meta as unknown as ActivityLogInsert['meta'] }
      : {}),
  };

  const { error } = await supabase.from('activity_log').insert(row);

  if (error) {
    // Safe to log: the action name is not personal data. We deliberately omit
    // `meta`, ids, and any provider/DB error detail to avoid leaking data.
    console.error(`logActivity: failed to record action "${action}"`);
  }
}
