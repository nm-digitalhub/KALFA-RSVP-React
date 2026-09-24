import 'server-only';

import { requirePlatformOwner } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { maskPhoneForDisplay } from '@/lib/phone';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  OWNER_AGENT_ERRORS as E,
  addAllowlistEntrySchema,
  allowlistEntryIdSchema,
  dailyCapSchema,
  relabelAllowlistEntrySchema,
  setAllowlistEnabledSchema,
  type AddAllowlistEntryInput,
} from '@/lib/validation/owner-agent';
import { phoneNumberIdSchema } from '@/lib/validation/whatsapp-numbers';
import type { NumberRole } from '@/lib/validation/provider-numbers';

// The admin side of the owner WhatsApp business-data agent
// (plans/owner-whatsapp-agent-plan.md §3.3, stage 2): the kill switch, the number the
// agent answers on, the daily cap, the allow-list, and the recent audit trail.
//
// GATE: requirePlatformOwner on EVERY export — owner decision 9.4 (2026-09-24), not
// the settings permission. Editing the allow-list IS granting read access to business
// data over WhatsApp; it is not ordinary system configuration.
//
// CLIENTS. The cookie client wherever RLS already lets the owner through, so the
// policy stays a second layer rather than decoration: app_settings (staff policy),
// provider_numbers (staff policy), platform_staff and platform_roles (owner-select
// policies), and the allow-list and audit READS (owner-select policies from the
// migration). The SERVICE-ROLE client only where RLS cannot serve:
//   * owner_agent_allowlist WRITES — the table deliberately has no write policy, so
//     service role is the only writer (migration §5);
//   * profiles — readable by its own user only, and the verified-phone match needs
//     every staff member's phone_verified_e164.
//
// PRIVACY. No raw phone number leaves this module. Numbers are masked here, and the
// verified-phone match is returned as a boolean — the comparison happens server-side.
// Activity rows carry ids, booleans and the cap only: never a phone, never label text.

const SETTINGS_ID = true;
export const OWNER_AGENT_AUDIT_LIMIT = 50;

export interface OwnerAgentSettings {
  enabled: boolean;
  /** Meta phone_number_id (provider_numbers.provider_ref), or null = no diversion. */
  phoneNumberId: string | null;
  dailyCap: number;
}

export interface OwnerAgentNumber {
  /** Meta's phone_number_id — an object id, not a phone number. The picker's value. */
  providerRef: string;
  label: string | null;
  maskedNumber: string;
  isActive: boolean;
  roles: NumberRole[];
}

export interface OwnerAgentAllowlistEntry {
  id: string;
  maskedNumber: string;
  staffUserId: string;
  staffName: string | null;
  /** False once the person is no longer platform staff (the FK cascade removes the row, but read defensively). */
  isStaff: boolean;
  enabled: boolean;
  label: string | null;
  createdAt: string;
  /** e164 === that staff member's profiles.phone_verified_e164. The phone itself never leaves. */
  verifiedMatch: boolean;
}

export interface OwnerAgentStaffOption {
  userId: string;
  name: string | null;
  roleLabel: string | null;
  isOwnerRole: boolean;
  hasVerifiedPhone: boolean;
}

export interface OwnerAgentAuditRow {
  id: string;
  occurredAt: string;
  staffUserId: string | null;
  stage: string;
  outcome: string;
  reasonCode: string | null;
  toolNames: string[];
  steps: number | null;
  latencyMs: number | null;
}

// Explicit, and asserted by the unit test: the audit table holds ids and codes only,
// and the page must never grow a `*` that would pick up whatever column is added next.
// owner_agent_intake (the one table with question text) is not read here at all.
export const OWNER_AGENT_AUDIT_COLUMNS =
  'id, occurred_at, staff_user_id, stage, outcome, reason_code, tool_names, steps, latency_ms';

// ─── READS ────────────────────────────────────────────────────────────────────

export async function getOwnerAgentSettings(): Promise<OwnerAgentSettings> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap')
    .eq('id', SETTINGS_ID)
    .maybeSingle();

  if (error || !data) throw new Error(E.settingsReadFailed);
  return {
    enabled: data.owner_agent_enabled,
    phoneNumberId: data.owner_agent_phone_number_id,
    dailyCap: data.owner_agent_daily_cap,
  };
}

/**
 * EVERY Meta number on the WABA, guest-serving ones included (owner decision
 * 2026-09-24): the agent may share a number with guests, and the roles are returned
 * so the picker can say so. Inactive numbers are returned and marked, not hidden — a
 * number that is already selected must stay visible after Meta stops listing it.
 */
export async function listOwnerAgentNumbers(): Promise<OwnerAgentNumber[]> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('provider_numbers')
    .select('provider_ref, e164, display_label, is_active, provider_number_roles(role)')
    .eq('provider', 'meta_whatsapp')
    .not('provider_ref', 'is', null)
    .order('is_active', { ascending: false })
    .order('display_label', { ascending: true, nullsFirst: false });

  if (error) throw new Error(E.numbersReadFailed);

  const numbers: OwnerAgentNumber[] = [];
  for (const row of data ?? []) {
    if (!row.provider_ref) continue;
    const roleRows = (row.provider_number_roles ?? []) as Array<{ role: NumberRole }>;
    numbers.push({
      providerRef: row.provider_ref,
      label: row.display_label,
      maskedNumber: maskPhoneForDisplay(row.e164),
      isActive: row.is_active,
      roles: roleRows.map((r) => r.role).sort(),
    });
  }
  return numbers;
}

interface StaffDirectoryEntry {
  userId: string;
  name: string | null;
  roleLabel: string | null;
  isOwnerRole: boolean;
  verifiedE164: string | null;
}

/**
 * Every platform staff member with name, role and verified phone. Module-private: the
 * verified phone is compared here and never returned. Two batched queries, no N+1 —
 * platform_staff and profiles both key on the auth user but have no FK between them,
 * so PostgREST cannot embed one in the other.
 */
async function loadStaffDirectory(): Promise<Map<string, StaffDirectoryEntry>> {
  const supabase = await createClient();
  const { data: staff, error } = await supabase
    .from('platform_staff')
    .select('user_id, platform_roles(label, is_owner_role)');
  if (error) throw new Error(E.staffReadFailed);

  const ids = (staff ?? []).map((s) => s.user_id);
  const profiles = new Map<string, { full_name: string | null; phone_verified_e164: string | null }>();
  if (ids.length > 0) {
    const admin = createAdminClient();
    const { data: rows, error: profilesError } = await admin
      .from('profiles')
      .select('id, full_name, phone_verified_e164')
      .in('id', ids);
    if (profilesError) throw new Error(E.staffReadFailed);
    for (const p of rows ?? []) profiles.set(p.id, p);
  }

  const directory = new Map<string, StaffDirectoryEntry>();
  for (const s of staff ?? []) {
    const role = s.platform_roles as { label: string; is_owner_role: boolean } | null;
    const profile = profiles.get(s.user_id);
    directory.set(s.user_id, {
      userId: s.user_id,
      name: profile?.full_name ?? null,
      roleLabel: role?.label ?? null,
      isOwnerRole: role?.is_owner_role ?? false,
      verifiedE164: profile?.phone_verified_e164 ?? null,
    });
  }
  return directory;
}

/**
 * The staff picker. Every staff member, not only the owner: v1 authorises the owner
 * (decision 9.5), but the allow-list is keyed by staff member and the screen must not
 * assume there is only one of them.
 */
export async function listOwnerAgentStaff(): Promise<OwnerAgentStaffOption[]> {
  await requirePlatformOwner();

  const directory = await loadStaffDirectory();
  return [...directory.values()]
    .map((s) => ({
      userId: s.userId,
      name: s.name,
      roleLabel: s.roleLabel,
      isOwnerRole: s.isOwnerRole,
      hasVerifiedPhone: s.verifiedE164 !== null,
    }))
    .sort((a, b) => Number(b.isOwnerRole) - Number(a.isOwnerRole) || (a.name ?? '').localeCompare(b.name ?? '', 'he'));
}

/**
 * The allow-list, each row with whether its number equals the staff member's VERIFIED
 * phone. That match is the second half of the identity binding the gate enforces
 * (plan §3.1: phone_unverified) — a row without it will be refused at run time, and
 * the owner should see that here rather than learn it from a silent agent.
 */
export async function listOwnerAgentAllowlist(): Promise<OwnerAgentAllowlistEntry[]> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const [{ data, error }, directory] = await Promise.all([
    supabase
      .from('owner_agent_allowlist')
      .select('id, e164, staff_user_id, enabled, label, created_at')
      .order('created_at', { ascending: true }),
    loadStaffDirectory(),
  ]);
  if (error) throw new Error(E.allowlistReadFailed);

  return (data ?? []).map((row) => {
    const staff = directory.get(row.staff_user_id);
    return {
      id: row.id,
      maskedNumber: maskPhoneForDisplay(row.e164),
      staffUserId: row.staff_user_id,
      staffName: staff?.name ?? null,
      isStaff: staff !== undefined,
      enabled: row.enabled,
      label: row.label,
      createdAt: row.created_at,
      verifiedMatch: staff?.verifiedE164 != null && staff.verifiedE164 === row.e164,
    };
  });
}

/** The most recent audit rows: ids and codes only (see OWNER_AGENT_AUDIT_COLUMNS). */
export async function listOwnerAgentAudit(): Promise<OwnerAgentAuditRow[]> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('owner_agent_audit')
    .select(OWNER_AGENT_AUDIT_COLUMNS)
    .order('occurred_at', { ascending: false })
    .limit(OWNER_AGENT_AUDIT_LIMIT);
  if (error) throw new Error(E.auditReadFailed);

  return (data ?? []).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    staffUserId: row.staff_user_id,
    stage: row.stage,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    toolNames: row.tool_names ?? [],
    steps: row.steps,
    latencyMs: row.latency_ms,
  }));
}

// ─── WRITES: app_settings ─────────────────────────────────────────────────────

export async function setOwnerAgentEnabled(enabled: boolean): Promise<void> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ owner_agent_enabled: enabled })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(E.switchFailed);

  await logActivity({ action: 'admin.owner_agent.enabled_set', meta: { enabled } });
}

/**
 * Select the number the agent answers on, or clear it (null = no diversion at all).
 *
 * The value must be one of OUR Meta numbers. Checked against provider_numbers before
 * the write: the column's CHECK only knows "all digits", so a mistyped or foreign id
 * would be stored happily and then never match a delivery — a silent agent with a
 * saved setting that looks right.
 */
export async function setOwnerAgentPhoneNumber(phoneNumberId: string | null): Promise<void> {
  await requirePlatformOwner();
  const value = phoneNumberId === null ? null : phoneNumberIdSchema.parse(phoneNumberId);

  const supabase = await createClient();
  if (value !== null) {
    const { data: number, error: lookupError } = await supabase
      .from('provider_numbers')
      .select('provider_ref')
      .eq('provider', 'meta_whatsapp')
      .eq('provider_ref', value)
      .maybeSingle();
    if (lookupError) throw new Error(E.numberSaveFailed);
    if (!number) throw new Error(E.numberNotOnWaba);
  }

  const { error } = await supabase
    .from('app_settings')
    .update({ owner_agent_phone_number_id: value })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(E.numberSaveFailed);

  // Meta's object id, not a phone number — the same thing the number-lifecycle
  // actions record.
  await logActivity({
    action: 'admin.owner_agent.number_set',
    meta: { phoneNumberId: value },
  });
}

export async function setOwnerAgentDailyCap(dailyCap: number): Promise<void> {
  await requirePlatformOwner();
  const cap = dailyCapSchema.parse(String(dailyCap));

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ owner_agent_daily_cap: cap })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(E.dailyCapSaveFailed);

  await logActivity({ action: 'admin.owner_agent.daily_cap_set', meta: { dailyCap: cap } });
}

// ─── WRITES: the allow-list (service role — the table has no write policy) ────

export async function addOwnerAgentAllowlistEntry(input: AddAllowlistEntryInput): Promise<string> {
  const actor = await requirePlatformOwner();
  const parsed = addAllowlistEntrySchema.parse(input);

  // The FK to platform_staff(user_id) refuses a non-staff id too; asking first turns
  // that into a sentence the owner can act on instead of a constraint error. Read
  // through the owner's session (owner-select policy); only the insert needs service
  // role.
  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase
    .from('platform_staff')
    .select('user_id')
    .eq('user_id', parsed.staffUserId)
    .maybeSingle();
  if (staffError) throw new Error(E.addFailed);
  if (!staff) throw new Error(E.notStaff);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('owner_agent_allowlist')
    .insert({
      e164: parsed.e164,
      staff_user_id: parsed.staffUserId,
      label: parsed.label,
      // The acting owner, from the session — never from the form.
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') throw new Error(E.duplicate);
    if (error?.code === '23514') throw new Error(E.invalidE164);
    if (error?.code === '23503') throw new Error(E.notStaff);
    throw new Error(E.addFailed);
  }

  await logActivity({
    action: 'admin.owner_agent.allowlist_added',
    meta: { entryId: data.id, staffUserId: parsed.staffUserId },
  });
  return data.id;
}

export async function setOwnerAgentAllowlistEnabled(id: string, enabled: boolean): Promise<void> {
  await requirePlatformOwner();
  const parsed = setAllowlistEnabledSchema.parse({ id, enabled });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('owner_agent_allowlist')
    .update({ enabled: parsed.enabled })
    .eq('id', parsed.id)
    .select('id');
  if (error) throw new Error(E.entryUpdateFailed);
  if (!data || data.length === 0) throw new Error(E.entryNotFound);

  await logActivity({
    action: 'admin.owner_agent.allowlist_enabled_set',
    meta: { entryId: parsed.id, enabled: parsed.enabled },
  });
}

export async function relabelOwnerAgentAllowlistEntry(id: string, label: string): Promise<void> {
  await requirePlatformOwner();
  const parsed = relabelAllowlistEntrySchema.parse({ id, label });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('owner_agent_allowlist')
    .update({ label: parsed.label })
    .eq('id', parsed.id)
    .select('id');
  if (error) throw new Error(E.relabelFailed);
  if (!data || data.length === 0) throw new Error(E.entryNotFound);

  // The label is free text an owner typed ("הנייד של …") — the row id is enough.
  await logActivity({
    action: 'admin.owner_agent.allowlist_relabelled',
    meta: { entryId: parsed.id },
  });
}

export async function removeOwnerAgentAllowlistEntry(id: string): Promise<void> {
  await requirePlatformOwner();
  const entryId = allowlistEntryIdSchema.parse(id);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('owner_agent_allowlist')
    .delete()
    .eq('id', entryId)
    .select('id, staff_user_id');
  if (error) throw new Error(E.removeFailed);
  if (!data || data.length === 0) throw new Error(E.entryNotFound);

  await logActivity({
    action: 'admin.owner_agent.allowlist_removed',
    meta: { entryId, staffUserId: data[0].staff_user_id },
  });
}
