import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMailboxPassword } from '@/lib/exchange-ews/mailbox-credential';
import type { ExchangeAuthMethod } from '@/lib/exchange-ews/types';
import { calendarProvider } from '@/lib/exchange-ews/calendar-provider';
import { pickActiveCalendarWindow } from '@/lib/exchange-ews/provider';
import type { ExchangeConnectionConfig } from '@/lib/exchange-ews/types';

// Per-console-agent calendar-derived presence sync (worker cron only — see
// worker/main.ts's calendarPresenceSync registration). Writes a THIRD,
// advisory axis: agent_status stays the sole business truth (project rule,
// plans/shimmering-snuggling-neumann.md "נוכחות" — "agent_status = אמת
// עסקית; חיבור SDK = אות טכני"; this module adds a second, independent
// technical signal alongside the SDK one, never merged into either). No
// caller in this codebase reads console_agent_calendar_presence to gate
// routing in this pass — findRoutableAgents/findRoutableAgentVoxUsernames
// (console-calls.ts) are UNCHANGED; only the pure
// deprioritizeCalendarBusyAgents() helper exists there, ready to be wired in
// once inbound routing itself goes live (gate E, still pending).
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
// NOT a dedicated availability/free-busy service call: it was MEASURED dead on
// the old IONOS mailbox (HTTP 500 / ErrorInternalServerError 127) back when the
// backend was EWS. That specific measurement is now history — the mailbox moved
// to Microsoft 365 — but the shape it forced is still what this uses and still
// the right one: calendarProvider.getAvailability() derives presence from the
// calendar itself, the same working path exchange-availability.ts's
// getMyPresence() uses. Re-measure before reaching for a free-busy API again.
//
// The xmlSafe() caveat that used to live here is gone with EWS: Graph speaks
// JSON, so there is no SOAP body for a string to escape into. Every call below
// is a read regardless.

type AdminClient = ReturnType<typeof createAdminClient>;

interface AgentExchangeCandidate {
  agentId: string;
  connectionId: string;
  mailboxEmail: string;
  authMethod: ExchangeAuthMethod;
  // Nullable since the §B phase-1 migration: under Graph a connection has no
  // mailbox secret to store, and the old NOT NULL forced every row to carry one
  // that authenticated nothing. resolveMailboxPassword narrows these.
  credentialCiphertext: string | null;
  credentialIv: string | null;
  credentialAuthTag: string | null;
  encryptionKeyVersion: number;
}

/** Every console agent who has their OWN verified Exchange connection. */
async function listAgentsWithVerifiedExchangeConnection(
  admin: AdminClient,
): Promise<AgentExchangeCandidate[]> {
  const { data: agents, error: agentsErr } = await admin.from('console_agents').select('user_id');
  if (agentsErr || !agents || agents.length === 0) return [];

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
  if (connErr || !connections) return [];

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

// Narrow window on purpose: this is an unattended cron (every 10 minutes,
// see worker/main.ts), not an interactive read with a user waiting, but it
// is still a remote Graph round trip per agent against a shared mailbox. (That
// used to be the stronger argument: under EWS each call paid a fresh NTLM/SOAP
// handshake. Graph holds one module-level credential and MSAL caches the token,
// so a tick is cheaper now — the cadence stays because calendar times are
// minute-granular at best, not because the call is expensive.)
// getMyPresence() reads -24h/+12h because it also needs
// to RECONCILE exchange_availability_blocks rows; this sync has no such
// bookkeeping to reconcile, so it only needs enough range to find the
// window presently in effect (plus a short look-back in case the tick lands
// just after a window's own start).
const SYNC_LOOKBACK_MS = 5 * 60_000;
const SYNC_LOOKAHEAD_MS = 4 * 60 * 60_000;

async function syncOneAgent(
  admin: AdminClient,
  candidate: AgentExchangeCandidate,
  nowMs: number,
): Promise<'synced' | 'failed'> {
  const nowIso = new Date(nowMs).toISOString();

  let password: string;
  try {
    password = resolveMailboxPassword();
  } catch {
    // Fail closed on the sync bookkeeping ONLY — busy_until/show_as are
    // deliberately left out of this payload so a decrypt failure can never
    // clobber a real, previously-known busy window to "free".
    await admin
      .from('console_agent_calendar_presence')
      .upsert(
        { agent_id: candidate.agentId, synced_at: nowIso, last_error_code: 'provider_error' },
        { onConflict: 'agent_id' },
      );
    return 'failed';
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
    return 'failed';
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
  return 'synced';
}

export interface CalendarPresenceSyncSummary {
  candidates: number;
  synced: number;
  failed: number;
}

/**
 * Worker entry point (pg-boss cron — worker/main.ts's calendarPresenceSync).
 * Never throws: one agent's broken mailbox must not stop the sync for the
 * rest, and the whole feature is advisory — a stale or missing row simply
 * means "not known to be calendar-busy", never a customer-facing failure, so
 * this does not raise its own Slack alert (unlike the customer-facing
 * sweeps elsewhere in worker/main.ts).
 */
export async function runConsoleAgentCalendarPresenceSync(
  opts: { nowMs?: number } = {},
): Promise<CalendarPresenceSyncSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const admin = createAdminClient();

  const candidates = await listAgentsWithVerifiedExchangeConnection(admin);
  let synced = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const outcome = await syncOneAgent(admin, candidate, nowMs);
      if (outcome === 'synced') synced += 1;
      else failed += 1;
    } catch {
      failed += 1; // defense-in-depth — syncOneAgent already catches internally
    }
  }
  return { candidates: candidates.length, synced, failed };
}
