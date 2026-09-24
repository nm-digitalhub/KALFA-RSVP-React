import 'server-only';

import { wamidSha256 } from '@/lib/owner-agent/intake';
import type { createAdminClient } from '@/lib/supabase/admin';

// Every database read and write the reply consumer makes, against the
// service-role client (plans/owner-whatsapp-agent-plan.md §3.1 #2–#3, §3.7).
//
// ⚠️ THE STATUS CAS IS THE DOUBLE-SEND GUARD, and it lives here. Every status
// change is an UPDATE … WHERE id = $1 AND status IN ($from), reporting whether
// a row moved. reply.ts sends only after moving the row processing → sending,
// and a delivery that finds `sending` never sends again (reply.ts). A filter
// dropped from `transition` below is a double send, which is why the tests
// drive this store over a filter-aware fake rather than a stub.
//
// PRIVACY. No error message leaves this module: a PostgREST error can quote the
// failing row, and an intake row holds the owner's question. Failures become
// OwnerAgentStoreError with a step name and the Postgres error CODE only.
// Audit rows are ids and codes (the migration's CHECK constraints enforce the
// shapes; `sanitizeToolNames` keeps a foreign tool name from violating them).

type AdminClient = ReturnType<typeof createAdminClient>;

// Worker states. The column is code-shaped (^[a-z][a-z0-9_]{0,31}$), not a
// closed list; these are the values this consumer writes. stage 4 inserts
// 'queued'.
export const INTAKE_STATUSES = [
  'queued',
  'processing',
  'sending',
  'answered',
  'failed',
  'skipped',
  'expired',
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

const TERMINAL: ReadonlySet<IntakeStatus> = new Set(['answered', 'failed', 'skipped', 'expired']);

export class OwnerAgentStoreError extends Error {
  constructor(
    readonly step: string,
    readonly code: string,
  ) {
    super(`owner_agent_store_${step}`);
    this.name = 'OwnerAgentStoreError';
  }
}

export interface IntakeRow {
  id: string;
  wamid: string;
  phoneNumberId: string;
  staffUserId: string;
  messageText: string;
  status: string;
  receivedAt: string;
}

export interface AgentSettings {
  enabled: boolean;
  phoneNumberId: string | null;
  dailyCap: number;
}

export interface AuditInput {
  stage: 'agent' | 'send' | 'sweep';
  outcome: string;
  reasonCode: string | null;
  staffUserId: string | null;
  intakeId: string | null;
  wamid: string | null;
  toolNames?: readonly string[] | null;
  steps?: number | null;
  latencyMs?: number | null;
}

// The audit CHECK allows tool names shaped ^[a-z][a-z0-9_]{0,63}$ and at most
// 32 of them. Our own ids fit; the runner passes a foreign name through as-is
// (runner.ts toolIdFromMcpName), and `Bash` would violate the CHECK and cost the
// whole audit row — so a name that does not fit is recorded as `other_tool`.
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export function sanitizeToolNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const safe = TOOL_NAME.test(name) ? name : 'other_tool';
    if (!out.includes(safe)) out.push(safe);
  }
  return out.slice(0, 32);
}

const SETTINGS_COLUMNS = 'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap';
const INTAKE_COLUMNS = 'id, wamid, phone_number_id, staff_user_id, message_text, status, received_at';

function fail(step: string, error: { code?: string } | null | undefined): never {
  throw new OwnerAgentStoreError(step, error?.code ?? 'unknown');
}

export interface ReplyStore {
  loadIntake(id: string): Promise<IntakeRow | null>;
  /** CAS: true iff the row was in one of `from` and is now `to`. */
  transition(id: string, from: readonly IntakeStatus[], to: IntakeStatus): Promise<boolean>;
  readSettings(): Promise<AgentSettings | null>;
  isStaff(staffUserId: string): Promise<boolean>;
  verifiedPhone(staffUserId: string): Promise<string | null>;
  isAllowlisted(staffUserId: string, e164: string): Promise<boolean>;
  /** Intake rows of this staff member received at or after `sinceIso`, other than `excludeId`. */
  countIntakeSince(staffUserId: string, sinceIso: string, excludeId: string): Promise<number>;
  hasPermission(staffUserId: string, key: string): Promise<boolean>;
  /** Never throws: an audit row that cannot be written must not change what already happened. */
  writeAudit(row: AuditInput): Promise<boolean>;
  /** 'queued' rows received in (newerThanIso, olderThanIso]: enqueued long enough ago to be stranded. */
  listStranded(olderThanIso: string, newerThanIso: string, limit: number): Promise<Array<{ id: string; wamid: string }>>;
  /** Unanswered rows received at or before `cutoffIso` — past the 24h window. */
  listExpirable(cutoffIso: string, limit: number): Promise<Array<{ id: string; wamid: string; staffUserId: string }>>;
}

export function createReplyStore(client: AdminClient): ReplyStore {
  return {
    async loadIntake(id) {
      const { data, error } = await client
        .from('owner_agent_intake')
        .select(INTAKE_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) fail('load_intake', error);
      if (!data) return null;
      return {
        id: data.id,
        wamid: data.wamid,
        phoneNumberId: data.phone_number_id,
        staffUserId: data.staff_user_id,
        messageText: data.message_text,
        status: data.status,
        receivedAt: data.received_at,
      };
    },

    async transition(id, from, to) {
      const { data, error } = await client
        .from('owner_agent_intake')
        .update({
          status: to,
          ...(TERMINAL.has(to) ? { processed_at: new Date().toISOString() } : {}),
        })
        .eq('id', id)
        .in('status', [...from])
        .select('id');
      if (error) fail(`transition_${to}`, error);
      return Array.isArray(data) && data.length === 1;
    },

    async readSettings() {
      const { data, error } = await client
        .from('app_settings')
        .select(SETTINGS_COLUMNS)
        .eq('id', true)
        .maybeSingle();
      if (error) fail('settings', error);
      if (!data) return null;
      return {
        enabled: data.owner_agent_enabled === true,
        phoneNumberId: data.owner_agent_phone_number_id ?? null,
        dailyCap: data.owner_agent_daily_cap,
      };
    },

    async isStaff(staffUserId) {
      const { data, error } = await client.rpc('is_platform_staff_for_user', { _user_id: staffUserId });
      if (error) fail('is_staff', error);
      return data === true;
    },

    async verifiedPhone(staffUserId) {
      const { data, error } = await client
        .from('profiles')
        .select('phone_verified_e164')
        .eq('id', staffUserId)
        .maybeSingle();
      if (error) fail('verified_phone', error);
      return data?.phone_verified_e164 ?? null;
    },

    async isAllowlisted(staffUserId, e164) {
      const { data, error } = await client
        .from('owner_agent_allowlist')
        .select('id')
        .eq('staff_user_id', staffUserId)
        .eq('e164', e164)
        .eq('enabled', true)
        .limit(1);
      if (error) fail('allowlist', error);
      return Array.isArray(data) && data.length > 0;
    },

    async countIntakeSince(staffUserId, sinceIso, excludeId) {
      const { count, error } = await client
        .from('owner_agent_intake')
        .select('id', { count: 'exact', head: true })
        .eq('staff_user_id', staffUserId)
        .gte('received_at', sinceIso)
        .neq('id', excludeId);
      if (error) fail('daily_count', error);
      // A missing count must not read as "0 used today".
      if (count === null || count === undefined) fail('daily_count', { code: 'no_count' });
      return count;
    },

    async hasPermission(staffUserId, key) {
      const { data, error } = await client.rpc('has_platform_permission_for_user', {
        _user_id: staffUserId,
        _key: key,
      });
      if (error) fail('permission', error);
      return data === true;
    },

    async writeAudit(row) {
      try {
        const { error } = await client.from('owner_agent_audit').insert({
          stage: row.stage,
          outcome: row.outcome,
          reason_code: row.reasonCode,
          staff_user_id: row.staffUserId,
          intake_id: row.intakeId,
          wamid_sha256: row.wamid === null ? null : wamidSha256(row.wamid),
          tool_names: row.toolNames ? sanitizeToolNames(row.toolNames) : null,
          steps: row.steps ?? null,
          latency_ms: row.latencyMs ?? null,
        });
        return !error;
      } catch {
        return false;
      }
    },

    async listStranded(olderThanIso, newerThanIso, limit) {
      const { data, error } = await client
        .from('owner_agent_intake')
        .select('id, wamid')
        .eq('status', 'queued')
        .lte('received_at', olderThanIso)
        .gt('received_at', newerThanIso)
        .order('received_at', { ascending: true })
        .limit(limit);
      if (error) fail('list_stranded', error);
      return (data ?? []).map((r) => ({ id: r.id, wamid: r.wamid }));
    },

    async listExpirable(cutoffIso, limit) {
      const { data, error } = await client
        .from('owner_agent_intake')
        .select('id, wamid, staff_user_id')
        .in('status', ['queued', 'processing'])
        .lte('received_at', cutoffIso)
        .order('received_at', { ascending: true })
        .limit(limit);
      if (error) fail('list_expirable', error);
      return (data ?? []).map((r) => ({ id: r.id, wamid: r.wamid, staffUserId: r.staff_user_id }));
    },
  };
}
