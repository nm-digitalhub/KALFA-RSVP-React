import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { findRoutableAgents } from '@/lib/data/console-calls';
import type { Tables } from '@/lib/supabase/types';
// Department queues (plan §10 extension point: "מחלקות (נקודת הרחבה = ring-order
// בשרת)") — an ADDITIVE layer over the existing server-side ring-order
// mechanism in console-calls.ts (computeRingOrder / findRoutableAgents). This
// module does NOT adopt Voximplant SmartQueue (ACDv2): the plan evaluated and
// deferred it — it duplicates the presence model that already lives in
// agent_status (this app's business source of truth for who's routable) and
// has no verified v5 integration guide. Queues here are a plain admin-managed
// grouping of console_agents, and "queue routing" is just a different input to
// the SAME computeRingOrder primitive (see computeQueueRingOrder there).

type ConsoleQueueRow = Tables<'console_queues'>;

// ─────────────────────────────────────────────────────────────────────────
// Queue catalog.
// ─────────────────────────────────────────────────────────────────────────

// The four departments seeded by the migration. A fixed union (not a free
// `string`) because V1 ships no create/delete-queue UI — admins only toggle
// `is_active` and manage membership on this fixed set (task brief).
export const CONSOLE_QUEUE_KEYS = ['sales', 'support', 'events', 'billing'] as const;
export type ConsoleQueueKey = (typeof CONSOLE_QUEUE_KEYS)[number];

export function isConsoleQueueKey(value: string): value is ConsoleQueueKey {
  return (CONSOLE_QUEUE_KEYS as readonly string[]).includes(value);
}

export interface ConsoleQueue {
  id: string;
  key: string;
  nameHe: string;
  isActive: boolean;
  priority: number;
}

function toConsoleQueue(row: ConsoleQueueRow): ConsoleQueue {
  return { id: row.id, key: row.key, nameHe: row.name_he, isActive: row.is_active, priority: row.priority };
}

/** All queues, ordered by priority — admin listing (includes inactive ones). */
export async function listQueuesForAdmin(): Promise<ConsoleQueue[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('console_queues')
    .select('id, key, name_he, is_active, priority, created_at')
    .order('priority', { ascending: true });
  if (error) throw new Error('list_queues_failed');
  return (data ?? []).map(toConsoleQueue);
}

async function getQueueByKey(key: string): Promise<ConsoleQueue | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('console_queues')
    .select('id, key, name_he, is_active, priority, created_at')
    .eq('key', key)
    .maybeSingle();
  if (error) return null;
  return data ? toConsoleQueue(data) : null;
}

export async function setQueueActive(queueId: string, isActive: boolean): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('console_queues').update({ is_active: isActive }).eq('id', queueId);
  if (error) throw new Error('set_queue_active_failed');
}

// ─────────────────────────────────────────────────────────────────────────
// Membership (admin management + agent-facing read-only display).
// ─────────────────────────────────────────────────────────────────────────

export interface ConsoleAgentOption {
  userId: string;
  displayName: string;
}

/** Every enrolled console agent, for the admin assignment checklist. No
 * existing "list all" export covers this — getUserConsoleAgent (platform-
 * roles.ts) is single-user only. */
export async function listAllConsoleAgents(): Promise<ConsoleAgentOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('console_agents')
    .select('user_id, display_name')
    .order('display_name', { ascending: true });
  if (error) throw new Error('list_console_agents_failed');
  return (data ?? []).map((a) => ({ userId: a.user_id, displayName: a.display_name }));
}

/** Member user_ids of one queue — admin UI's current-checklist-state. */
export async function getQueueMemberIds(queueId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('console_agent_queues')
    .select('agent_id')
    .eq('queue_id', queueId);
  if (error) throw new Error('get_queue_members_failed');
  return (data ?? []).map((r) => r.agent_id);
}

/**
 * Reconciles a queue's membership to EXACTLY `agentIds` (admin's submitted
 * checklist state) — deletes rows for agents unchecked, inserts rows for
 * agents newly checked, touches neither for agents already in the target
 * state. Not wrapped in a DB transaction (no cross-table invariant depends on
 * atomicity here — a partial apply just leaves membership between two valid
 * states, both fully expressed by is_console_agent()-gated reads).
 */
export async function syncQueueMembers(queueId: string, agentIds: string[]): Promise<void> {
  const admin = createAdminClient();
  const current = new Set(await getQueueMemberIds(queueId));
  const target = new Set(agentIds);

  const toRemove = [...current].filter((id) => !target.has(id));
  const toAdd = [...target].filter((id) => !current.has(id));

  if (toRemove.length > 0) {
    const { error } = await admin
      .from('console_agent_queues')
      .delete()
      .eq('queue_id', queueId)
      .in('agent_id', toRemove);
    if (error) throw new Error('remove_queue_members_failed');
  }
  if (toAdd.length > 0) {
    const { error } = await admin
      .from('console_agent_queues')
      .insert(toAdd.map((agentId) => ({ agent_id: agentId, queue_id: queueId })));
    if (error) throw new Error('add_queue_members_failed');
  }
}

export interface AgentQueueMembership {
  key: string;
  nameHe: string;
}

/**
 * This agent's own queue memberships, for the read-only panel display next to
 * presence (task brief). Fetched server-side (admin layout, alongside the rest
 * of SoftphoneGateInfo) rather than as a browser RLS read — console_queues/
 * console_agent_queues DO carry an is_console_agent() SELECT policy for
 * defense-in-depth and future direct client reads, but no current browser
 * code path exercises it; this function is the one that does the read today.
 */
export async function getAgentQueueMemberships(agentId: string): Promise<AgentQueueMembership[]> {
  const admin = createAdminClient();
  const { data: memberships, error } = await admin
    .from('console_agent_queues')
    .select('queue_id')
    .eq('agent_id', agentId);
  if (error) throw new Error('get_agent_queue_memberships_failed');
  if (!memberships || memberships.length === 0) return [];

  const { data: queues, error: queuesErr } = await admin
    .from('console_queues')
    .select('key, name_he')
    .in(
      'id',
      memberships.map((m) => m.queue_id),
    );
  if (queuesErr) throw new Error('get_agent_queue_memberships_failed');
  return (queues ?? []).map((q) => ({ key: q.key, nameHe: q.name_he }));
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound queue selection — the one call site route-inbound uses.
//
// DESIGN DECISION (documented per task instructions — "justify what you
// chose; honest over clever"): there is exactly ONE inbound DID
// (97237219347), so the only real signals available before answering are (a)
// caller-history (route-inbound already runs identifyInboundCaller, which can
// resolve CLI -> contact/guest/event) or (b) a flat default, with DTMF-IVR
// explicitly out of scope for this task ("do not invent an IVR").
//
// This module chooses (b), a single flat default, NOT a caller-history
// heuristic — deliberately. identifyInboundCaller proves WHO is calling (an
// existing guest/contact of some event), but that is not evidence of WHY they
// are calling, which is what department selection actually needs. A caller
// linked to an active event is not measurably more likely to want the
// "events" department over "billing" or general "support" — they could want
// any of the four with about equal plausibility, and nothing in the caller
// lookup distinguishes them. Building a mapping like "identified + active
// event -> events queue" on that non-signal would be exactly the kind of
// invented-but-unjustified classification the task explicitly asks to avoid;
// a flat default that is honest about routing on zero information beats a
// heuristic that LOOKS informed but isn't.
//
// DEFAULT_QUEUE_KEY = 'support': the conventional front door for an
// inbound call with no stronger routing signal — general customer service,
// not an assumption of commercial intent (sales) or a specific dispute
// (billing).
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_QUEUE_KEY: ConsoleQueueKey = 'support';

export interface ResolveInboundQueueKeyInput {
  /**
   * Typed extension point for a future DTMF-IVR queue selector (plan §10,
   * explicitly deferred — "there is exactly ONE number... do not invent an
   * IVR"). Always undefined today: ConsoleInbound.voxengine.js never collects
   * or reports a digit, and nothing populates this field yet. When a future
   * caller does populate it (post a digit-select step before/instead of this
   * gate), it takes priority over DEFAULT_QUEUE_KEY — this function is the
   * single place that decision plugs into, so route-inbound.ts never needs to
   * change again for that extension.
   */
  dtmfQueueKey?: ConsoleQueueKey;
}

/** Pure — see the design-decision note above for why V1 ignores caller
 * identity and always resolves the flat default absent a (not-yet-built)
 * DTMF selection. */
export function resolveInboundQueueKey(input: ResolveInboundQueueKeyInput = {}): ConsoleQueueKey {
  return input.dtmfQueueKey ?? DEFAULT_QUEUE_KEY;
}

/**
 * Resolves the ACTIVE queue to build a ring order from, or null when none is
 * resolvable (queue row missing, inactive, AND the default queue is also
 * missing/inactive) — null is not a failure, it's "route like queues don't
 * exist", which callers must treat as identical to pre-queue behavior (ring
 * every routable agent, no queue-first tier). An inactive/unresolvable
 * *selected* queue falls back to the default queue before giving up, so
 * disabling one department (e.g. "billing" outside business hours) degrades
 * to the general queue rather than to "no queue at all".
 */
export async function resolveActiveQueueForRing(
  input: ResolveInboundQueueKeyInput = {},
): Promise<ConsoleQueue | null> {
  const key = resolveInboundQueueKey(input);
  const primary = await getQueueByKey(key);
  if (primary?.isActive) return primary;
  if (key !== DEFAULT_QUEUE_KEY) {
    const fallback = await getQueueByKey(DEFAULT_QUEUE_KEY);
    if (fallback?.isActive) return fallback;
  }
  return null;
}

/**
 * Routable = findRoutableAgents() (same ready+fresh+provisioned computation as
 * the system-wide set — never re-derived here) intersected with this queue's
 * membership. Returns vox_usernames in no particular order — computeRingOrder
 * (console-calls.ts) does the deterministic sort+rotate.
 */
export async function findRoutableAgentVoxUsernamesForQueue(
  queueId: string,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const memberIds = new Set(await getQueueMemberIds(queueId));
  if (memberIds.size === 0) return [];
  const routable = await findRoutableAgents(nowMs);
  return routable.filter((a) => memberIds.has(a.agentId)).map((a) => a.voxUsername);
}

/**
 * Best-effort: stamps which queue served an inbound call, after the row
 * already exists (console-calls.ts owns createConsoleCall/updateConsoleCallStatus;
 * this is a separate follow-up UPDATE). Never throws into the caller's
 * request path — a lost label is not worth refusing or degrading a live
 * inbound call over.
 */
export async function setConsoleCallQueue(callId: string, queueId: string | null): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('console_calls').update({ queue_id: queueId }).eq('id', callId);
  } catch {
    // best-effort — see doc comment.
  }
}
