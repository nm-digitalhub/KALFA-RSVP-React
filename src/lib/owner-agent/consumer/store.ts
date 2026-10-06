import 'server-only';

import { isApprovalKind, type ApprovalKind } from '@/lib/owner-agent/approval';
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
  // Folded into a newer message's turn (burst coalescing, capabilities plan
  // §4.6); `coalesced_into` names the leader that answers for it.
  'coalesced',
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

// 'coalesced' is terminal too, but is only ever written by coalesceInto, which
// stamps processed_at itself.
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
  /** null for a question that came through an external_override row. */
  staffUserId: string | null;
  /** The allow-list row the question came through — the identity the gate re-checks. */
  allowlistEntryId: string | null;
  /** null for a non-text message (media, location, button) — migration 20260927011338. */
  messageText: string | null;
  status: string;
  receivedAt: string;
  /** Set on every terminal status. The 24h life of a follow-up counts from it. */
  processedAt: string | null;
  // Capabilities (migration 20260927011338). Everything below is what Meta
  // signed and the route stored; none of it is trusted beyond its shape.
  /** Code-shaped: text | image | document | audio | location | interactive | button | … */
  messageType: string;
  media: { id: string; mime: string | null; voice: boolean; filename: string | null } | null;
  /** A button/list reply id or a template button payload. Resolved, never trusted. */
  interactiveId: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  /** context.id: the wamid this message replies to (a tap: our interactive message). */
  replyToWamid: string | null;
  /** The follow-up suggestions WE offered after answering this row. */
  followups: string[] | null;
  /** wamids of what we sent for this row (the answer parts and the interactive message). */
  replyWamids: string[] | null;
  /** The leader of the burst this row was folded into. */
  coalescedInto: string | null;
}

/** One allow-list row as the consumer re-checks it. The e164 never leaves the server. */
export interface AllowlistEntryRow {
  id: string;
  e164: string;
  staffUserId: string | null;
  approvalKind: ApprovalKind;
  enabled: boolean;
}

export interface AgentSettings {
  enabled: boolean;
  phoneNumberId: string | null;
  dailyCap: number;
  /** app_settings.owner_agent_burst_ms: 0 = no coalescing (the behaviour before it). */
  burstMs: number;
}

export interface AuditInput {
  stage: 'agent' | 'send' | 'sweep';
  outcome: string;
  reasonCode: string | null;
  staffUserId: string | null;
  allowlistEntryId?: string | null;
  intakeId: string | null;
  wamid: string | null;
  /** The leading intake of the turn this row belongs to (burst coalescing). */
  turnIntakeId?: string | null;
  toolNames?: readonly string[] | null;
  steps?: number | null;
  latencyMs?: number | null;
}

// The audit CHECK allows tool names shaped ^[a-z][a-z0-9_]{0,63}$ and at most
// 32 of them. Our own ids fit, and so do the Supabase server's (execute_sql,
// list_tables — the runner strips both servers' prefixes, mcp/names.ts
// toolIdFromMcpName); the runner passes a foreign name through as-is
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

const SETTINGS_COLUMNS =
  'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap, owner_agent_burst_ms';
// One literal, not a concatenation: supabase-js types the row from it.
const INTAKE_COLUMNS =
  'id, wamid, phone_number_id, staff_user_id, allowlist_entry_id, message_text, status, received_at, processed_at, message_type, media_id, media_mime, media_voice, media_filename, interactive_id, location_lat, location_lng, location_label, reply_to_wamid, followups, reply_wamids, coalesced_into';

// Statuses under which a follow-up tap counts as USED: its answer went out,
// or is going out. The consumer handles one job at a time, so no two taps of
// one id are ever mid-flight together.
const FOLLOWUP_USED_STATUSES: readonly IntakeStatus[] = ['sending', 'answered'];

interface IntakeRecord {
  id: string;
  wamid: string;
  phone_number_id: string;
  staff_user_id: string | null;
  allowlist_entry_id: string | null;
  message_text: string | null;
  status: string;
  received_at: string;
  processed_at: string | null;
  message_type: string;
  media_id: string | null;
  media_mime: string | null;
  media_voice: boolean | null;
  media_filename: string | null;
  interactive_id: string | null;
  location_lat: number | null;
  location_lng: number | null;
  location_label: string | null;
  reply_to_wamid: string | null;
  followups: unknown;
  reply_wamids: string[] | null;
  coalesced_into: string | null;
}

// jsonb comes back as unknown: only an array of strings is a follow-up list.
function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}

function toIntakeRow(data: IntakeRecord): IntakeRow {
  return {
    id: data.id,
    wamid: data.wamid,
    phoneNumberId: data.phone_number_id,
    staffUserId: data.staff_user_id,
    allowlistEntryId: data.allowlist_entry_id,
    messageText: data.message_text,
    status: data.status,
    receivedAt: data.received_at,
    processedAt: data.processed_at ?? null,
    messageType: data.message_type ?? 'text',
    media: data.media_id
      ? {
          id: data.media_id,
          mime: data.media_mime ?? null,
          voice: data.media_voice === true,
          filename: data.media_filename ?? null,
        }
      : null,
    interactiveId: data.interactive_id ?? null,
    location:
      typeof data.location_lat === 'number' && typeof data.location_lng === 'number'
        ? { lat: data.location_lat, lng: data.location_lng, label: data.location_label ?? null }
        : null,
    replyToWamid: data.reply_to_wamid ?? null,
    followups: stringArray(data.followups),
    replyWamids: stringArray(data.reply_wamids),
    coalescedInto: data.coalesced_into ?? null,
  };
}

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
  /** The allow-list row, or null when it is gone (or its kind is unknown — fail closed). */
  loadEntry(entryId: string): Promise<AllowlistEntryRow | null>;
  /**
   * Intake rows of this allow-list row received in [sinceIso, beforeIso): the
   * ones BEFORE a given question on its day — what the route counted before
   * it inserted that question. Rows that arrived after it do not count.
   */
  countIntakeBefore(entryId: string, sinceIso: string, beforeIso: string): Promise<number>;
  hasPermission(staffUserId: string, key: string): Promise<boolean>;
  /**
   * Burst coalescing (§4.6): is there a 'queued' row of the same allow-list
   * row that arrived after this one (a received_at tie broken by id)?
   */
  hasNewerQueued(row: Pick<IntakeRow, 'id' | 'allowlistEntryId' | 'receivedAt'>): Promise<boolean>;
  /**
   * ONE statement: every 'queued' row of the leader's allow-list row received
   * at or before it becomes 'coalesced' with coalesced_into = the leader. The
   * status filter is the CAS — a row another job already claimed is not taken.
   * Returns the rows it moved.
   */
  coalesceInto(
    leader: Pick<IntakeRow, 'id' | 'allowlistEntryId' | 'receivedAt'>,
  ): Promise<Array<{ id: string; wamid: string; staffUserId: string | null }>>;
  /** The rows folded into `leaderId`, oldest first — the turn, rebuilt the same way on every retry. */
  loadCoalesced(leaderId: string): Promise<IntakeRow[]>;
  /** Other rows carrying this interactive id whose answer went out (a used follow-up). */
  countFollowupUses(interactiveId: string, excludeIntakeId: string): Promise<number>;
  /**
   * After the send: the suggestions offered and the wamids sent for this row.
   * Never throws — the messages are already out.
   */
  recordReply(id: string, reply: { followups: string[] | null; replyWamids: string[] }): Promise<boolean>;
  /** Never throws: an audit row that cannot be written must not change what already happened. */
  writeAudit(row: AuditInput): Promise<boolean>;
  /** 'queued' rows received in (newerThanIso, olderThanIso]: enqueued long enough ago to be stranded. */
  listStranded(olderThanIso: string, newerThanIso: string, limit: number): Promise<Array<{ id: string; wamid: string }>>;
  /** Unanswered rows received at or before `cutoffIso` — past the 24h window. */
  listExpirable(
    cutoffIso: string,
    limit: number,
  ): Promise<Array<{ id: string; wamid: string; staffUserId: string | null; allowlistEntryId: string | null }>>;
  /**
   * Retention (decision 9.8): delete intake rows received before `cutoffIso`,
   * whatever their status; returns how many. Their audit rows stay — the FK is
   * ON DELETE SET NULL, and an audit row holds no text.
   */
  deleteIntakeReceivedBefore(cutoffIso: string): Promise<number>;
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
      return toIntakeRow(data);
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
        burstMs: typeof data.owner_agent_burst_ms === 'number' ? data.owner_agent_burst_ms : 0,
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

    async loadEntry(entryId) {
      const { data, error } = await client
        .from('owner_agent_allowlist')
        .select('id, e164, staff_user_id, approval_kind, enabled')
        .eq('id', entryId)
        .maybeSingle();
      if (error) fail('allowlist', error);
      if (!data || !isApprovalKind(data.approval_kind)) return null;
      return {
        id: data.id,
        e164: data.e164,
        staffUserId: data.staff_user_id,
        approvalKind: data.approval_kind,
        enabled: data.enabled,
      };
    },

    async countIntakeBefore(entryId, sinceIso, beforeIso) {
      const { count, error } = await client
        .from('owner_agent_intake')
        .select('id', { count: 'exact', head: true })
        .eq('allowlist_entry_id', entryId)
        .gte('received_at', sinceIso)
        .lt('received_at', beforeIso);
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

    async hasNewerQueued(row) {
      if (!row.allowlistEntryId) return false;
      const { data, error } = await client
        .from('owner_agent_intake')
        .select('id, received_at')
        .eq('allowlist_entry_id', row.allowlistEntryId)
        .eq('status', 'queued')
        .neq('id', row.id)
        .gte('received_at', row.receivedAt)
        .limit(50);
      if (error) fail('burst_newer', error);
      const mine = Date.parse(row.receivedAt);
      return (data ?? []).some((r) => {
        const theirs = Date.parse(r.received_at);
        return theirs > mine || (theirs === mine && r.id > row.id);
      });
    },

    async coalesceInto(leader) {
      if (!leader.allowlistEntryId) return [];
      const { data, error } = await client
        .from('owner_agent_intake')
        .update({ status: 'coalesced', coalesced_into: leader.id, processed_at: new Date().toISOString() })
        .eq('allowlist_entry_id', leader.allowlistEntryId)
        .eq('status', 'queued')
        .neq('id', leader.id)
        .lte('received_at', leader.receivedAt)
        .select('id, wamid, staff_user_id');
      if (error) fail('burst_coalesce', error);
      return (data ?? []).map((r) => ({ id: r.id, wamid: r.wamid, staffUserId: r.staff_user_id }));
    },

    async loadCoalesced(leaderId) {
      const { data, error } = await client
        .from('owner_agent_intake')
        .select(INTAKE_COLUMNS)
        .eq('coalesced_into', leaderId)
        .order('received_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(50);
      if (error) fail('burst_turn', error);
      return (data ?? []).map(toIntakeRow);
    },

    async countFollowupUses(interactiveId, excludeIntakeId) {
      const { count, error } = await client
        .from('owner_agent_intake')
        .select('id', { count: 'exact', head: true })
        .eq('interactive_id', interactiveId)
        .neq('id', excludeIntakeId)
        .in('status', [...FOLLOWUP_USED_STATUSES]);
      if (error) fail('followup_used', error);
      // A missing count must not read as "never used".
      if (count === null || count === undefined) fail('followup_used', { code: 'no_count' });
      return count;
    },

    async recordReply(id, reply) {
      try {
        const { error } = await client
          .from('owner_agent_intake')
          .update({ followups: reply.followups, reply_wamids: reply.replyWamids })
          .eq('id', id);
        return !error;
      } catch {
        return false;
      }
    },

    async writeAudit(row) {
      try {
        const { error } = await client.from('owner_agent_audit').insert({
          stage: row.stage,
          outcome: row.outcome,
          reason_code: row.reasonCode,
          staff_user_id: row.staffUserId,
          allowlist_entry_id: row.allowlistEntryId ?? null,
          intake_id: row.intakeId,
          turn_intake_id: row.turnIntakeId ?? null,
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
        .select('id, wamid, staff_user_id, allowlist_entry_id')
        .in('status', ['queued', 'processing'])
        .lte('received_at', cutoffIso)
        .order('received_at', { ascending: true })
        .limit(limit);
      if (error) fail('list_expirable', error);
      return (data ?? []).map((r) => ({
        id: r.id,
        wamid: r.wamid,
        staffUserId: r.staff_user_id,
        allowlistEntryId: r.allowlist_entry_id,
      }));
    },

    async deleteIntakeReceivedBefore(cutoffIso) {
      const { count, error } = await client
        .from('owner_agent_intake')
        .delete({ count: 'exact' })
        .lt('received_at', cutoffIso);
      if (error) fail('retention_delete', error);
      return count ?? 0;
    },
  };
}
