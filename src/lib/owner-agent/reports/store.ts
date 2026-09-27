import 'server-only';

import { isApprovalKind, type ApprovalKind } from '@/lib/owner-agent/approval';
import { createReplyStore, OwnerAgentStoreError } from '@/lib/owner-agent/consumer/store';
import type { createAdminClient } from '@/lib/supabase/admin';

import { DAILY_BUSINESS_REPORT } from './planner';

// Every database read and write of the proactive report (plan §4.8), against
// the service-role client — the report twin of consumer/store.ts.
//
// ⚠️ TWO GUARDS AGAINST A SECOND REPORT LIVE HERE.
//   1. insertRun: one INSERT per (subscription, local_date, slot_time); the
//      table's UNIQUE key turns a second one into 23505, reported as "not
//      inserted", and only an inserted run is enqueued.
//   2. transitionRun: UPDATE … WHERE id = $1 AND status IN ($from). report.ts
//      sends only after moving the run processing → sending, and a handler
//      that finds `sending` never sends again.
// Dropping either filter is a second WhatsApp message to the owner, which is
// why store.test.ts drives this over the filter-aware fake-table-client.
//
// The staff / verified-phone / permission reads are the reply consumer's own
// (consumer/store.ts), so the report's identity gate asks exactly what the
// answer's does.
//
// PRIVACY. No error message leaves this module (OwnerAgentStoreError carries a
// step and the Postgres code). The e164 is read for the recipient and never
// logged or audited; audit rows are ids and codes.

type AdminClient = ReturnType<typeof createAdminClient>;

// Run states. The column is code-shaped, not a closed list; these are the
// values this code writes (the column default 'claimed' is never used).
export const REPORT_RUN_STATUSES = [
  'queued',
  'processing',
  'sending',
  'sent',
  'failed',
  'skipped',
  'expired',
] as const;
export type ReportRunStatus = (typeof REPORT_RUN_STATUSES)[number];

export interface ReportRunRow {
  id: string;
  subscriptionId: string;
  localDate: string;
  /** As stored: 'HH:MM:SS'. */
  slotTime: string;
  status: string;
  claimedAt: string;
}

export interface ReportSubscriptionRow {
  id: string;
  allowlistEntryId: string;
  reportKey: string;
  slotTime: string;
  timezone: string;
  enabled: boolean;
  templateName: string | null;
  templateLang: string | null;
  /** The owner's "הנחיות לדוח"; null = the deterministic report. */
  instructions: string | null;
}

export interface ReportSettings {
  enabled: boolean;
  reportsEnabled: boolean;
  phoneNumberId: string | null;
  templateName: string | null;
  templateLang: string | null;
}

export interface ReportEntryRow {
  id: string;
  e164: string;
  staffUserId: string | null;
  approvalKind: ApprovalKind;
  enabled: boolean;
  reportOptIn: boolean;
}

export interface RunResultPatch {
  channel?: string | null;
  outboundWamid?: string | null;
  errorCode?: string | null;
  sentAt?: string | null;
}

export interface ReportAuditInput {
  outcome: string;
  reasonCode: string | null;
  reportRunId: string;
  staffUserId?: string | null;
  allowlistEntryId?: string | null;
  /** The report's sections, as their tool ids (e.g. events_pipeline). */
  sections?: readonly string[] | null;
  latencyMs?: number | null;
}

export interface ReportStore {
  loadRun(id: string): Promise<ReportRunRow | null>;
  loadSubscription(id: string): Promise<ReportSubscriptionRow | null>;
  /** CAS: true iff the run was in one of `from` and is now `to` (with `patch`). */
  transitionRun(
    id: string,
    from: readonly ReportRunStatus[],
    to: ReportRunStatus,
    patch?: RunResultPatch,
  ): Promise<boolean>;
  readSettings(): Promise<ReportSettings | null>;
  /** null when the row is gone or its kind is unknown (fail closed). */
  loadEntry(entryId: string): Promise<ReportEntryRow | null>;
  isStaff(staffUserId: string): Promise<boolean>;
  verifiedPhone(staffUserId: string): Promise<string | null>;
  hasPermission(staffUserId: string, key: string): Promise<boolean>;
  /** received_at of this row's newest intake on `phoneNumberId`, or null. */
  lastIntakeAt(entryId: string, phoneNumberId: string): Promise<string | null>;
  /** Never throws. */
  writeAudit(row: ReportAuditInput): Promise<boolean>;
  /** Enabled daily_business subscriptions whose allow-list row is enabled and opted in. */
  listPlannable(): Promise<Array<{ id: string; slotTime: string; timezone: string }>>;
  /** The run's id, or null when the slot already has one (23505). */
  insertRun(subscriptionId: string, localDate: string, slotTime: string): Promise<string | null>;
  /** 'queued' runs claimed in (newerThanIso, olderThanIso]. */
  listStrandedRuns(olderThanIso: string, newerThanIso: string, limit: number): Promise<string[]>;
  /** 'queued' or 'processing' runs claimed at or before `cutoffIso` — past the catch-up window. */
  listStaleRuns(cutoffIso: string, limit: number): Promise<string[]>;
}

function fail(step: string, error: { code?: string } | null | undefined): never {
  throw new OwnerAgentStoreError(`report_${step}`, error?.code ?? 'unknown');
}

// The audit CHECK allows tool names shaped ^[a-z][a-z0-9_]{0,63}$, at most 32.
const SECTION = /^[a-z][a-z0-9_]{0,63}$/;

export function createReportStore(client: AdminClient): ReportStore {
  const reply = createReplyStore(client);

  return {
    async loadRun(id) {
      const { data, error } = await client
        .from('owner_agent_report_run')
        .select('id, subscription_id, local_date, slot_time, status, claimed_at')
        .eq('id', id)
        .maybeSingle();
      if (error) fail('load_run', error);
      if (!data) return null;
      return {
        id: data.id,
        subscriptionId: data.subscription_id,
        localDate: data.local_date,
        slotTime: data.slot_time,
        status: data.status,
        claimedAt: data.claimed_at,
      };
    },

    async loadSubscription(id) {
      const { data, error } = await client
        .from('owner_agent_report_subscription')
        .select('id, allowlist_entry_id, report_key, slot_time, timezone, enabled, template_name, template_lang, instructions')
        .eq('id', id)
        .maybeSingle();
      if (error) fail('load_subscription', error);
      if (!data) return null;
      return {
        id: data.id,
        allowlistEntryId: data.allowlist_entry_id,
        reportKey: data.report_key,
        slotTime: data.slot_time,
        timezone: data.timezone,
        enabled: data.enabled,
        templateName: data.template_name,
        templateLang: data.template_lang,
        instructions: data.instructions ?? null,
      };
    },

    async transitionRun(id, from, to, patch = {}) {
      const { data, error } = await client
        .from('owner_agent_report_run')
        .update({
          status: to,
          ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
          ...(patch.outboundWamid !== undefined ? { outbound_wamid: patch.outboundWamid } : {}),
          ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
          ...(patch.sentAt !== undefined ? { sent_at: patch.sentAt } : {}),
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
        .select(
          'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_reports_enabled, owner_agent_report_template_name, owner_agent_report_template_lang',
        )
        .eq('id', true)
        .maybeSingle();
      if (error) fail('settings', error);
      if (!data) return null;
      return {
        enabled: data.owner_agent_enabled === true,
        reportsEnabled: data.owner_agent_reports_enabled === true,
        phoneNumberId: data.owner_agent_phone_number_id ?? null,
        templateName: data.owner_agent_report_template_name ?? null,
        templateLang: data.owner_agent_report_template_lang ?? null,
      };
    },

    async loadEntry(entryId) {
      const { data, error } = await client
        .from('owner_agent_allowlist')
        .select('id, e164, staff_user_id, approval_kind, enabled, report_opt_in')
        .eq('id', entryId)
        .maybeSingle();
      if (error) fail('allowlist', error);
      if (!data || !isApprovalKind(data.approval_kind)) return null;
      return {
        id: data.id,
        e164: data.e164,
        staffUserId: data.staff_user_id,
        approvalKind: data.approval_kind,
        enabled: data.enabled === true,
        reportOptIn: data.report_opt_in === true,
      };
    },

    isStaff: (staffUserId) => reply.isStaff(staffUserId),
    verifiedPhone: (staffUserId) => reply.verifiedPhone(staffUserId),
    hasPermission: (staffUserId, key) => reply.hasPermission(staffUserId, key),

    async lastIntakeAt(entryId, phoneNumberId) {
      const { data, error } = await client
        .from('owner_agent_intake')
        .select('received_at')
        .eq('allowlist_entry_id', entryId)
        .eq('phone_number_id', phoneNumberId)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail('last_intake', error);
      return data?.received_at ?? null;
    },

    async writeAudit(row) {
      try {
        const sections = row.sections ? [...new Set(row.sections.filter((s) => SECTION.test(s)))].slice(0, 32) : null;
        const { error } = await client.from('owner_agent_audit').insert({
          stage: 'report',
          outcome: row.outcome,
          reason_code: row.reasonCode,
          report_run_id: row.reportRunId,
          staff_user_id: row.staffUserId ?? null,
          allowlist_entry_id: row.allowlistEntryId ?? null,
          intake_id: null,
          wamid_sha256: null,
          tool_names: sections && sections.length > 0 ? sections : null,
          latency_ms: row.latencyMs ?? null,
        });
        return !error;
      } catch {
        return false;
      }
    },

    async listPlannable() {
      const { data: subs, error } = await client
        .from('owner_agent_report_subscription')
        .select('id, allowlist_entry_id, slot_time, timezone')
        .eq('enabled', true)
        .eq('report_key', DAILY_BUSINESS_REPORT);
      if (error) fail('list_subscriptions', error);
      if (!subs || subs.length === 0) return [];

      const entryIds = [...new Set(subs.map((s) => s.allowlist_entry_id))];
      const { data: entries, error: entriesError } = await client
        .from('owner_agent_allowlist')
        .select('id')
        .in('id', entryIds)
        .eq('enabled', true)
        .eq('report_opt_in', true);
      if (entriesError) fail('list_opted_in', entriesError);
      const optedIn = new Set((entries ?? []).map((e) => e.id));

      return subs
        .filter((s) => optedIn.has(s.allowlist_entry_id))
        .map((s) => ({ id: s.id, slotTime: s.slot_time, timezone: s.timezone }));
    },

    async insertRun(subscriptionId, localDate, slotTime) {
      const { data, error } = await client
        .from('owner_agent_report_run')
        .insert({ subscription_id: subscriptionId, local_date: localDate, slot_time: slotTime, status: 'queued' })
        .select('id');
      if (error) {
        if (error.code === '23505') return null;
        fail('insert_run', error);
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) fail('insert_run', { code: 'no_row' });
      return row.id;
    },

    async listStrandedRuns(olderThanIso, newerThanIso, limit) {
      const { data, error } = await client
        .from('owner_agent_report_run')
        .select('id')
        .eq('status', 'queued')
        .lte('claimed_at', olderThanIso)
        .gt('claimed_at', newerThanIso)
        .order('claimed_at', { ascending: true })
        .limit(limit);
      if (error) fail('list_stranded', error);
      return (data ?? []).map((r) => r.id);
    },

    async listStaleRuns(cutoffIso, limit) {
      const { data, error } = await client
        .from('owner_agent_report_run')
        .select('id')
        .in('status', ['queued', 'processing'])
        .lte('claimed_at', cutoffIso)
        .order('claimed_at', { ascending: true })
        .limit(limit);
      if (error) fail('list_stale', error);
      return (data ?? []).map((r) => r.id);
    },
  };
}
