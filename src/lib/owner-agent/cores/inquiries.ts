import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for inquiry counts (owner-agent tool 1, inquiries_summary;
// plan §5). Takes a service-role client and returns numbers only.
//
// Same split as message-templates-resolve.ts: this module reaches no DAL and
// no next/headers|navigation|cache (the `owner-agent-request-free` rule in
// .dependency-cruiser.cjs), and nothing under src/app, src/components,
// src/hooks or src/lib/workflow, where every 'use client' module lives
// (`owner-agent-no-client-or-ui-modules`; the directive itself is invisible to
// dependency-cruiser, measured 2026-09-24). So a non-request process can call
// it. Authorization is NOT here — the caller holds it:
//   - the admin sidebar badge and the /admin dashboard tiles reach these
//     counters through nav-counts.ts, which checks view_customer_data first;
//   - the owner agent will expose this core only to a staff member whose
//     view_customer_data was resolved server-side (plan §3.2).
//
// Privacy: head-only counts (`head: true`), so no row — and therefore no name,
// email, phone or message text — ever leaves the database.
//
// Errors THROW. A failed count must not reach the owner as a confident 0; the
// fail-soft 0 that the admin nav wants lives in its adapter (nav-counts.ts).

type AdminClient = ReturnType<typeof createAdminClient>;

// "Waiting for us" — the one definition the sidebar badge, the /admin
// dashboard card and the agent share. `reopened` counts: a customer who wrote
// back on an answered thread is waiting exactly as much as a first-time sender.
export const OPEN_CONTACT_STATUSES = ['new', 'reopened'] as const;

export async function countOpenContacts(client: AdminClient): Promise<number> {
  const { count, error } = await client
    .from('contact_messages')
    .select('id', { count: 'exact', head: true })
    .in('status', [...OPEN_CONTACT_STATUSES]);
  if (error) throw new Error('count_open_contacts_failed');
  return count ?? 0;
}

export async function countNewCallbackRequests(client: AdminClient): Promise<number> {
  const { count, error } = await client
    .from('callback_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');
  if (error) throw new Error('count_new_callbacks_failed');
  return count ?? 0;
}

async function countCreatedSince(
  client: AdminClient,
  table: 'contact_messages' | 'callback_requests',
  sinceIso: string,
): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceIso);
  if (error) throw new Error('count_received_failed');
  return count ?? 0;
}

export interface InquiriesSummary {
  // Current state (not range-bound): the same numbers as the admin badges.
  openContacts: number;
  newCallbacks: number;
  // Volume received within the range.
  contactsReceived: number;
  callbacksReceived: number;
}

export async function getInquiriesSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<InquiriesSummary> {
  const sinceIso = rangeStartIso(range, nowMs);
  const [openContacts, newCallbacks, contactsReceived, callbacksReceived] = await Promise.all([
    countOpenContacts(client),
    countNewCallbackRequests(client),
    countCreatedSince(client, 'contact_messages', sinceIso),
    countCreatedSince(client, 'callback_requests', sinceIso),
  ]);
  return { openContacts, newCallbacks, contactsReceived, callbacksReceived };
}
