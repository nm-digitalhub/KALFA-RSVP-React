import 'server-only';

import type { PgBoss } from 'pg-boss';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMailboxPassword } from '@/lib/exchange-ews/mailbox-credential';
import type { ExchangeAuthMethod } from '@/lib/exchange-ews/types';
import { calendarProvider, selectedCalendarProvider } from '@/lib/exchange-ews/calendar-provider';
import { pickActiveCalendarWindow } from '@/lib/exchange-ews/provider';
import type { ExchangeConnectionConfig } from '@/lib/exchange-ews/types';
import { graphConfigured } from '@/lib/microsoft/graph-client';
import {
  deleteSubscription,
  ensureCalendarSubscription,
  type GraphSubscription,
  listSubscriptions,
  mailboxOfCalendarSubscription,
  notificationUrl,
  renewSubscription,
  webhookClientState,
} from '@/lib/microsoft/subscriptions';
import {
  CALENDAR_PRESENCE_RETRY,
  CALENDAR_PRESENCE_SWEEP_KEY,
  calendarPresenceWakeJobId,
  type CalendarPresenceSyncJob,
  QUEUES,
} from '@/lib/queue/queues';

// Per-console-agent calendar-derived presence sync (worker only — see
// worker/main.ts's calendarPresenceSync registration). Writes a THIRD,
// advisory axis: agent_status stays the sole business truth (project rule:
// "agent_status = אמת עסקית; חיבור SDK = אות טכני"; this module adds a
// second, independent technical signal alongside the SDK one, never merged
// into either). No caller in this codebase reads
// console_agent_calendar_presence to gate routing —
// findRoutableAgents/findRoutableAgentVoxUsernames (console-calls.ts) do not
// consult it; only the pure deprioritizeCalendarBusyAgents() helper exists
// there, ready to be wired in once inbound routing itself goes live (gate E,
// still pending).
//
// REQUEST-FREE by design (service-role only, no requireUser/cookies) so the
// worker bundle can import it — same reasoning as
// callback-scheduling.ts:1-18, which this module deliberately mirrors for
// its credential-loading shape. UNLIKE that module's loadBusinessConnection
// (exactly ONE verified connection, system-wide — refuses on ambiguity),
// this is genuinely PER-AGENT: user_id is the join key between
// console_agents and exchange_connections, so each agent's own mailbox
// drives their own row. Measured live 12.8: today exactly one console agent
// exists and it is the same person as the one verified Exchange connection
// (the owner) — the join is written to generalize to N agents regardless,
// which is the whole point of the feature.
//
// Presence comes from calendarProvider.getAvailability(): under Graph that is
// the real free/busy service (calendar/getSchedule — see graph-impl.ts), which
// counts private and tentative items as busy without exposing their content.
// exchange-availability.ts's getMyPresence() reads the calendar items instead
// (listAppointments) because it also reconciles exchange_availability_blocks
// rows. Every Exchange call below is a read.
//
// WHEN an agent is read, event-driven rather than a 10-minute poll:
//   - a Graph calendar notification (the agent's calendar changed) queues that
//     agent's sync, coalesced to one per few seconds (queueCalendarPresenceSync);
//   - every sync queues the next one for the moment the answer can next change —
//     the next busy window's start or end — or, with nothing in range, a
//     fallback inside the read window (nextCalendarPresenceWakeMs);
//   - a 6-hourly sweep keeps each agent's calendar subscription alive, drops
//     the ones no agent owns any more, and restarts every agent's chain.
// Every one of those is the same job on the same queue, keyed by agent, so two
// reads of one agent never overlap and an older read cannot land after a newer.

type AdminClient = ReturnType<typeof createAdminClient>;

interface AgentExchangeCandidate {
  agentId: string;
  connectionId: string;
  mailboxEmail: string;
  authMethod: ExchangeAuthMethod;
  // Nullable since the §B phase-1 migration: under Graph a connection has no
  // mailbox secret to store, and the old NOT NULL forced every row to carry one
  // that authenticated nothing.
  credentialCiphertext: string | null;
  credentialIv: string | null;
  credentialAuthTag: string | null;
  encryptionKeyVersion: number;
}

/** Every console agent who has their OWN verified Exchange connection. */
async function listAgentsWithVerifiedExchangeConnection(
  admin: AdminClient,
): Promise<AgentExchangeCandidate[]> {
  // A failed read throws rather than reading as "no agents": an empty answer
  // would end every agent's wake chain until the next sweep, silently.
  const { data: agents, error: agentsErr } = await admin.from('console_agents').select('user_id');
  if (agentsErr) throw new Error('calendar_presence_agents_read_failed');
  if (!agents || agents.length === 0) return [];

  const { data: connections, error: connErr } = await admin
    .from('exchange_connections')
    .select(
      'id, user_id, mailbox_email, auth_method, status, credential_ciphertext, credential_iv, credential_auth_tag, encryption_key_version',
    )
    .eq('status', 'verified')
    .in(
      'user_id',
      agents.map((a) => a.user_id),
    );
  if (connErr) throw new Error('calendar_presence_connections_read_failed');
  if (!connections) return [];

  return connections.map((row) => ({
    agentId: row.user_id,
    connectionId: row.id,
    mailboxEmail: row.mailbox_email,
    // Narrowed, not cast — same rule as loadBusinessConnection: the column
    // is plain text, and an unexpected value must not reach the provider.
    authMethod: row.auth_method === 'basic' ? 'basic' : 'ntlm',
    credentialCiphertext: row.credential_ciphertext,
    credentialIv: row.credential_iv,
    credentialAuthTag: row.credential_auth_tag,
    encryptionKeyVersion: row.encryption_key_version,
  }));
}

// Narrow window on purpose: an unattended read per agent against a shared
// mailbox, not an interactive one with a user waiting. getMyPresence() reads
// -24h/+12h because it also needs to RECONCILE exchange_availability_blocks
// rows; this sync has no such bookkeeping, so it only needs enough range to
// find the window presently in effect (plus a short look-back) and the next
// boundary to wake for.
const SYNC_LOOKBACK_MS = 5 * 60_000;
const SYNC_LOOKAHEAD_MS = 4 * 60 * 60_000;

// With no boundary in range, the next read lands on the hour that falls between
// 3h and 4h from now: still inside the window just read, so a meeting beyond it
// is in range before it can start. On a grid, so every chain that reaches it —
// one per notification-triggered sync — collapses into the same job id instead
// of multiplying.
const FALLBACK_GRID_MS = 60 * 60_000;

// After a failed read, the next attempt is the next 10-minute mark — the old
// polling cadence, and on a grid for the same reason as above.
const RETRY_GRID_MS = 10 * 60_000;

// A wake is due a little after its boundary: a worker clock slightly behind the
// database's would otherwise read the calendar a moment BEFORE the meeting
// starts. The job also carries its boundary (`at`), and the read never treats
// "now" as earlier than it — see runCalendarPresenceJob.
const WAKE_PAD_MS = 2_000;

// A burst of notifications (a recurring series edited, a meeting accepted)
// collapses into one sync per slot; singletonNextSlot keeps one more queued
// behind it, so a change that lands mid-sync is still read.
const NOTIFICATION_SLOT_SECONDS = 5;

/**
 * When this agent's calendar presence can next change: the earliest start or
 * end of a busy window after `nowMs`, and never later than the fallback inside
 * the read window. Overlapping windows are fine — every edge is a candidate.
 */
export function nextCalendarPresenceWakeMs(
  windows: readonly { start: Date; end: Date; showAs: string }[],
  nowMs: number,
): number {
  let next = Math.floor((nowMs + SYNC_LOOKAHEAD_MS) / FALLBACK_GRID_MS) * FALLBACK_GRID_MS;
  for (const w of windows) {
    if (w.showAs === 'free') continue;
    for (const edge of [w.start.getTime(), w.end.getTime()]) {
      if (edge > nowMs && edge < next) next = edge;
    }
  }
  return next;
}

function nextRetryMs(nowMs: number): number {
  return Math.ceil((nowMs + 1) / RETRY_GRID_MS) * RETRY_GRID_MS;
}

type AgentSyncOutcome = { synced: boolean; nextWakeMs: number };

async function syncOneAgent(
  admin: AdminClient,
  candidate: AgentExchangeCandidate,
  nowMs: number,
): Promise<AgentSyncOutcome> {
  const nowIso = new Date(nowMs).toISOString();

  let password: string;
  try {
    password = resolveMailboxPassword();
  } catch {
    // Fail closed on the sync bookkeeping ONLY — busy_until/show_as are
    // deliberately left out of this payload so a credential failure can never
    // clobber a real, previously-known busy window to "free".
    await admin
      .from('console_agent_calendar_presence')
      .upsert(
        { agent_id: candidate.agentId, synced_at: nowIso, last_error_code: 'provider_error' },
        { onConflict: 'agent_id' },
      );
    return { synced: false, nextWakeMs: nextRetryMs(nowMs) };
  }

  const cfg: ExchangeConnectionConfig = {
    mailboxEmail: candidate.mailboxEmail,
    password,
    authMethod: candidate.authMethod,
  };

  const result = await calendarProvider.getAvailability(cfg, {
    start: new Date(nowMs - SYNC_LOOKBACK_MS),
    end: new Date(nowMs + SYNC_LOOKAHEAD_MS),
  });

  if (!result.ok) {
    // Same stale-but-known rule as above (voximplant-balance-cache.ts's
    // grace-window precedent): a single failed tick must not flip a
    // genuinely busy agent to "free" — only the bookkeeping columns move.
    await admin
      .from('console_agent_calendar_presence')
      .upsert(
        { agent_id: candidate.agentId, synced_at: nowIso, last_error_code: result.error },
        { onConflict: 'agent_id' },
      );
    return { synced: false, nextWakeMs: nextRetryMs(nowMs) };
  }

  const active = pickActiveCalendarWindow(result.data, nowMs);
  await admin.from('console_agent_calendar_presence').upsert(
    {
      agent_id: candidate.agentId,
      busy_until: active ? new Date(active.endMs).toISOString() : null,
      show_as: active?.showAs ?? null,
      synced_at: nowIso,
      last_error_code: null,
    },
    { onConflict: 'agent_id' },
  );
  return { synced: true, nextWakeMs: nextCalendarPresenceWakeMs(result.data, nowMs) };
}

/** Queue the read at `atMs`; a second send for the same agent and moment is a no-op. */
async function scheduleCalendarPresenceWake(boss: PgBoss, agentId: string, atMs: number): Promise<void> {
  const data: CalendarPresenceSyncJob = { agentId, at: atMs };
  await boss.send(QUEUES.calendarPresenceSync, data, {
    id: calendarPresenceWakeJobId(agentId, atMs),
    singletonKey: agentId,
    startAfter: new Date(atMs + WAKE_PAD_MS),
    ...CALENDAR_PRESENCE_RETRY,
  });
}

/**
 * Queue one agent's sync now — for a calendar notification, a lifecycle event
 * or the sweep's fan-out. Coalesced per agent (see NOTIFICATION_SLOT_SECONDS).
 */
export async function queueCalendarPresenceSync(boss: PgBoss, agentId: string): Promise<void> {
  const data: CalendarPresenceSyncJob = { agentId };
  await boss.send(QUEUES.calendarPresenceSync, data, {
    singletonKey: agentId,
    singletonSeconds: NOTIFICATION_SLOT_SECONDS,
    singletonNextSlot: true,
    ...CALENDAR_PRESENCE_RETRY,
  });
}

/** Queue a sweep now — a lifecycle event said a subscription is gone. */
export async function queueCalendarPresenceSweep(boss: PgBoss): Promise<void> {
  const data: CalendarPresenceSyncJob = {};
  await boss.send(QUEUES.calendarPresenceSync, data, {
    singletonKey: CALENDAR_PRESENCE_SWEEP_KEY,
    singletonSeconds: 60,
    singletonNextSlot: true,
    ...CALENDAR_PRESENCE_RETRY,
  });
}

/**
 * Push needs the Graph backend, its app identity and the webhook secret.
 * Without any of them the chain of wakes still keeps presence current — it just
 * learns of an edited meeting at its next boundary or fallback, not at once.
 */
function calendarPushConfigured(): boolean {
  if (selectedCalendarProvider() !== 'graph' || !graphConfigured()) return false;
  try {
    webhookClientState();
    return true;
  } catch {
    return false;
  }
}

/** The calendar subscriptions this deployment holds, with the mailbox each watches. */
async function myCalendarSubscriptions(
  subscriptions: GraphSubscription[],
): Promise<{ subscription: GraphSubscription; mailbox: string }[]> {
  const url = await notificationUrl();
  return subscriptions.flatMap((subscription) => {
    const mailbox = mailboxOfCalendarSubscription(subscription);
    return mailbox && subscription.notificationUrl === url ? [{ subscription, mailbox }] : [];
  });
}

async function agentForSubscription(
  admin: AdminClient,
  subscriptions: GraphSubscription[],
  subscriptionId: string,
): Promise<string | null> {
  const mine = await myCalendarSubscriptions(subscriptions);
  const mailbox = mine.find((m) => m.subscription.id === subscriptionId)?.mailbox;
  if (!mailbox) return null;
  const candidates = await listAgentsWithVerifiedExchangeConnection(admin);
  return candidates.find((c) => c.mailboxEmail.toLowerCase() === mailbox)?.agentId ?? null;
}

export type CalendarNotificationOutcome = 'queued' | 'unknown_subscription';

/**
 * A Graph calendar notification (webhook-processing.ts, graph_calendar rows):
 * queue a sync for the agent whose calendar it is. A subscription that maps to
 * no agent is a no-op, not an error — it belongs to a connection that has since
 * gone, and the next sweep deletes it.
 */
export async function handleCalendarNotification(
  boss: PgBoss,
  subscriptions: GraphSubscription[],
  subscriptionId: string,
): Promise<CalendarNotificationOutcome> {
  const agentId = await agentForSubscription(createAdminClient(), subscriptions, subscriptionId);
  if (!agentId) return 'unknown_subscription';
  await queueCalendarPresenceSync(boss, agentId);
  return 'queued';
}

export type CalendarLifecycleOutcome = 'renewed' | 'queued' | 'sweep_queued';

/**
 * A Graph lifecycle notification (webhook-processing.ts, graph_lifecycle rows),
 * handled as Graph's lifecycle-events guide prescribes:
 *   reauthorizationRequired — renew it (a renewal reauthorizes);
 *   missed                  — read that agent again, since changes were lost;
 *   subscriptionRemoved     — recreate it and read again. A removed
 *                             subscription is no longer listed, so its mailbox
 *                             cannot be resolved; the sweep recreates every
 *                             missing one and reads every agent.
 * Anything that cannot be resolved falls back to the sweep.
 */
export async function handleCalendarLifecycleEvent(
  boss: PgBoss,
  subscriptions: () => Promise<GraphSubscription[]>,
  event: { subscriptionId: string; lifecycleEvent: string },
): Promise<CalendarLifecycleOutcome> {
  if (event.lifecycleEvent === 'reauthorizationRequired') {
    try {
      await renewSubscription(event.subscriptionId);
      return 'renewed';
    } catch {
      // Already gone, or refused: the sweep recreates what is missing.
    }
  } else if (event.lifecycleEvent === 'missed') {
    const agentId = await agentForSubscription(createAdminClient(), await subscriptions(), event.subscriptionId);
    if (agentId) {
      await queueCalendarPresenceSync(boss, agentId);
      return 'queued';
    }
  }
  await queueCalendarPresenceSweep(boss);
  return 'sweep_queued';
}

export interface CalendarPresenceSweepSummary {
  candidates: number;
  subscriptions: 'unconfigured' | 'ensured' | 'failed';
  queued: number;
}

/**
 * Keep one calendar subscription per agent mailbox and none for anyone else.
 * A subscription is a standing grant on a mailbox, so one whose connection is
 * no longer a verified agent connection is deleted, not left to lapse.
 */
async function reconcileCalendarSubscriptions(candidates: AgentExchangeCandidate[]): Promise<void> {
  const existing = await listSubscriptions();
  const wanted = new Set(candidates.map((c) => c.mailboxEmail.toLowerCase()));
  for (const { subscription, mailbox } of await myCalendarSubscriptions(existing)) {
    if (!wanted.has(mailbox)) await deleteSubscription(subscription.id);
  }
  for (const mailbox of wanted) {
    await ensureCalendarSubscription(mailbox, existing);
  }
}

async function runCalendarPresenceSweep(boss: PgBoss): Promise<CalendarPresenceSweepSummary> {
  const candidates = await listAgentsWithVerifiedExchangeConnection(createAdminClient());

  let subscriptions: CalendarPresenceSweepSummary['subscriptions'] = 'unconfigured';
  if (calendarPushConfigured()) {
    try {
      await reconcileCalendarSubscriptions(candidates);
      subscriptions = 'ensured';
    } catch (err) {
      subscriptions = 'failed';
      // Without the subscription presence still follows the wake chain, but an
      // edited or new meeting is only seen at the next boundary or fallback —
      // hours, not seconds. Nothing else would show that push stopped.
      void sendSlackAlert({
        category: 'errors',
        level: 'warn',
        title: 'מנוי היומן של נציגי הקונסולה לא חודש — נוכחות מהיומן תתעדכן באיחור',
        source: 'calendar_presence',
        fields: { reason: err instanceof Error ? err.message : 'unknown' },
      });
    }
  }

  // Each agent's read is its own job, keyed by the agent, so it serializes with
  // that agent's wakes and notifications instead of racing them.
  for (const candidate of candidates) {
    await queueCalendarPresenceSync(boss, candidate.agentId);
  }
  return { candidates: candidates.length, subscriptions, queued: candidates.length };
}

export type CalendarPresenceJobResult =
  | { kind: 'agent'; outcome: 'synced' | 'failed' | 'not_an_agent' }
  | ({ kind: 'sweep' } & CalendarPresenceSweepSummary);

/**
 * Worker entry point for QUEUES.calendarPresenceSync. An agent job reads that
 * agent and queues the next read; anything else is the sweep.
 *
 * A Graph failure never throws: it is recorded on the agent's row (busy_until
 * is kept, never flipped to free on a failed read) and the next attempt is
 * queued. Only a database or queue failure throws, into the job's retry policy.
 * The whole feature is advisory, so a failed read raises no alert of its own.
 */
export async function runCalendarPresenceJob(
  boss: PgBoss,
  data: CalendarPresenceSyncJob,
  opts: { nowMs?: number } = {},
): Promise<CalendarPresenceJobResult> {
  if (!data?.agentId) return { kind: 'sweep', ...(await runCalendarPresenceSweep(boss)) };

  const admin = createAdminClient();
  const candidate = (await listAgentsWithVerifiedExchangeConnection(admin)).find(
    (c) => c.agentId === data.agentId,
  );
  // No longer an agent with a verified connection: the chain ends here, and the
  // sweep removes the subscription.
  if (!candidate) return { kind: 'agent', outcome: 'not_an_agent' };

  // A wake is never read as earlier than the boundary it was queued for, even
  // when this process's clock trails the database's.
  const nowMs = Math.max(opts.nowMs ?? Date.now(), data.at ?? 0);
  const { synced, nextWakeMs } = await syncOneAgent(admin, candidate, nowMs);
  await scheduleCalendarPresenceWake(boss, candidate.agentId, nextWakeMs);
  return { kind: 'agent', outcome: synced ? 'synced' : 'failed' };
}
