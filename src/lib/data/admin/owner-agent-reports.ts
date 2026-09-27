import 'server-only';

import { requirePlatformOwner } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { DAILY_BUSINESS_REPORT, normalizeSlotTime } from '@/lib/owner-agent/reports/planner';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  OWNER_AGENT_REPORT_ERRORS as E,
  REPORT_TIMEZONE,
  reportScheduleSchema,
  reportTemplateSchema,
  type ReportScheduleInput,
  type ReportTemplateInput,
} from '@/lib/validation/owner-agent-reports';

// The admin side of the owner agent's PROACTIVE REPORT
// (plans/owner-agent-chat-sdk-capabilities-plan.md §4.8): the reports switch, the
// out-of-window template, and per allow-list row the opt-in and the daily slots.
// Owner decision 27.9: proactive messages approved; the schedule is set ONLY here —
// the agent has no write tool.
//
// GATE: requirePlatformOwner on EVERY export, as owner-agent.ts (decision 9.4): a
// schedule sends business data to a phone every day.
//
// TWO TEMPLATES (20260927173139): the numeric report's (4 params) and the one for a
// report written from the owner's instructions (2 params). reports/report.ts picks by
// the content it holds; neither ever carries the other's params.
//
// CLIENTS. The cookie client wherever RLS lets the owner through: app_settings (staff
// policy), and the subscription, run and allow-list READS (owner-select policies). The
// service-role client for the subscription and allow-list WRITES — neither table has a
// write policy, on purpose (migration 20260927011338 §4).
//
// ⚠️ A SUBSCRIPTION ROW IS NEVER DELETED AND ITS slot_time NEVER CHANGES. The run
// table references it ON DELETE CASCADE and is keyed (subscription, local_date,
// slot_time): deleting and re-adding 08:00 would wipe today's run key, and the next
// tick would send today's 08:00 report a second time. So a slot the owner removes is
// DISABLED, a slot they add back is re-ENABLED, and only a slot the row never had is
// inserted. The handler re-checks "still enabled, still this slot" at send time.
//
// PRIVACY. No phone number is read here. Activity rows carry ids, booleans, slot
// times and the template identifier — never a phone, never report content. Run rows
// are ids and codes (the table holds nothing else).

const SETTINGS_ID = true;
export const OWNER_AGENT_REPORT_RUNS_LIMIT = 30;

export interface OwnerAgentReportSettings {
  reportsEnabled: boolean;
  /** The numeric report's template (4 params). */
  templateName: string | null;
  templateLang: string | null;
  /** The template of a report written from the owner's instructions (2 params). */
  customTemplateName: string | null;
  customTemplateLang: string | null;
}

export interface OwnerAgentReportSlot {
  /** HH:MM, Israel time. */
  time: string;
  /** The owner's "הנחיות לדוח"; null = the deterministic report. */
  instructions: string | null;
}

export interface OwnerAgentReportSchedule {
  entryId: string;
  optIn: boolean;
  /** Enabled slots, sorted by time. */
  slots: OwnerAgentReportSlot[];
  /** True once the row has ever had a subscription (so the screen stops suggesting defaults). */
  configured: boolean;
}

export interface OwnerAgentReportRun {
  id: string;
  entryId: string | null;
  localDate: string;
  slotTime: string;
  status: string;
  channel: string | null;
  errorCode: string | null;
  claimedAt: string;
  sentAt: string | null;
}

// Explicit, and asserted by the unit test: ids and codes only.
export const OWNER_AGENT_REPORT_RUN_COLUMNS =
  'id, subscription_id, local_date, slot_time, status, channel, error_code, claimed_at, sent_at';

// ─── READS ────────────────────────────────────────────────────────────────────

export async function getOwnerAgentReportSettings(): Promise<OwnerAgentReportSettings> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'owner_agent_reports_enabled, owner_agent_report_template_name, owner_agent_report_template_lang, owner_agent_custom_report_template_name, owner_agent_custom_report_template_lang',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error || !data) throw new Error(E.readFailed);
  return {
    reportsEnabled: data.owner_agent_reports_enabled,
    templateName: data.owner_agent_report_template_name,
    templateLang: data.owner_agent_report_template_lang,
    customTemplateName: data.owner_agent_custom_report_template_name,
    customTemplateLang: data.owner_agent_custom_report_template_lang,
  };
}

/** One schedule per allow-list row (every row, subscribed or not). */
export async function listOwnerAgentReportSchedules(): Promise<OwnerAgentReportSchedule[]> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const [{ data: entries, error: entriesError }, { data: subs, error: subsError }] = await Promise.all([
    supabase.from('owner_agent_allowlist').select('id, report_opt_in').order('created_at', { ascending: true }),
    supabase
      .from('owner_agent_report_subscription')
      .select('allowlist_entry_id, slot_time, enabled, instructions')
      .eq('report_key', DAILY_BUSINESS_REPORT),
  ]);
  if (entriesError || subsError) throw new Error(E.readFailed);

  const byEntry = new Map<string, { slots: OwnerAgentReportSlot[]; configured: boolean }>();
  for (const sub of subs ?? []) {
    const cur = byEntry.get(sub.allowlist_entry_id) ?? { slots: [], configured: false };
    cur.configured = true;
    const slot = normalizeSlotTime(sub.slot_time);
    if (sub.enabled && slot) cur.slots.push({ time: slot, instructions: sub.instructions });
    byEntry.set(sub.allowlist_entry_id, cur);
  }
  return (entries ?? []).map((e) => {
    const s = byEntry.get(e.id);
    return {
      entryId: e.id,
      optIn: e.report_opt_in,
      slots: (s?.slots ?? []).sort((a, b) => a.time.localeCompare(b.time)),
      configured: s?.configured ?? false,
    };
  });
}

/** The most recent runs, newest first: ids and codes only. */
export async function listOwnerAgentReportRuns(): Promise<OwnerAgentReportRun[]> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const { data: runs, error } = await supabase
    .from('owner_agent_report_run')
    .select(OWNER_AGENT_REPORT_RUN_COLUMNS)
    .order('claimed_at', { ascending: false })
    .limit(OWNER_AGENT_REPORT_RUNS_LIMIT);
  if (error) throw new Error(E.runsReadFailed);
  if (!runs || runs.length === 0) return [];

  const subIds = [...new Set(runs.map((r) => r.subscription_id))];
  const { data: subs, error: subsError } = await supabase
    .from('owner_agent_report_subscription')
    .select('id, allowlist_entry_id')
    .in('id', subIds);
  if (subsError) throw new Error(E.runsReadFailed);
  const entryOf = new Map((subs ?? []).map((s) => [s.id, s.allowlist_entry_id]));

  return runs.map((r) => ({
    id: r.id,
    entryId: entryOf.get(r.subscription_id) ?? null,
    localDate: r.local_date,
    slotTime: normalizeSlotTime(r.slot_time) ?? r.slot_time,
    status: r.status,
    channel: r.channel,
    errorCode: r.error_code,
    claimedAt: r.claimed_at,
    sentAt: r.sent_at,
  }));
}

// ─── WRITES: app_settings ─────────────────────────────────────────────────────

export async function setOwnerAgentReportsEnabled(enabled: boolean): Promise<void> {
  await requirePlatformOwner();

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ owner_agent_reports_enabled: enabled })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(E.switchFailed);

  await logActivity({ action: 'admin.owner_agent.reports_enabled_set', meta: { enabled } });
}

/** The approved template for a NUMERIC report outside the 24h window; null = none (no such report goes out). */
export async function setOwnerAgentReportTemplate(input: ReportTemplateInput): Promise<void> {
  await requirePlatformOwner();
  const parsed = reportTemplateSchema.parse(input);

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      owner_agent_report_template_name: parsed.templateName,
      owner_agent_report_template_lang: parsed.templateLang,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(E.templateSaveFailed);

  // A Meta template identifier and a language code — configuration, not personal data.
  await logActivity({
    action: 'admin.owner_agent.report_template_set',
    meta: { templateName: parsed.templateName, templateLang: parsed.templateLang },
  });
}

/**
 * The approved template (2 params: period, summary) for a report written from the
 * owner's instructions, outside the 24h window; null = none — such a report then goes
 * out as the numeric report through the numeric template, or not at all.
 */
export async function setOwnerAgentCustomReportTemplate(input: ReportTemplateInput): Promise<void> {
  await requirePlatformOwner();
  const parsed = reportTemplateSchema.parse(input);

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      owner_agent_custom_report_template_name: parsed.templateName,
      owner_agent_custom_report_template_lang: parsed.templateLang,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(E.templateSaveFailed);

  // A Meta template identifier and a language code — configuration, not personal data.
  await logActivity({
    action: 'admin.owner_agent.custom_report_template_set',
    meta: { templateName: parsed.templateName, templateLang: parsed.templateLang },
  });
}

// ─── WRITES: one row's opt-in and slots (service role) ────────────────────────

export async function setOwnerAgentReportSchedule(input: ReportScheduleInput): Promise<void> {
  const actor = await requirePlatformOwner();
  const parsed = reportScheduleSchema.parse(input);
  const admin = createAdminClient();

  const { data: entry, error: entryError } = await admin
    .from('owner_agent_allowlist')
    .update({ report_opt_in: parsed.optIn })
    .eq('id', parsed.entryId)
    .select('id');
  if (entryError) throw new Error(E.scheduleSaveFailed);
  if (!entry || entry.length === 0) throw new Error(E.entryNotFound);

  const { data: existing, error: existingError } = await admin
    .from('owner_agent_report_subscription')
    .select('id, slot_time, enabled, instructions')
    .eq('allowlist_entry_id', parsed.entryId)
    .eq('report_key', DAILY_BUSINESS_REPORT);
  if (existingError) throw new Error(E.scheduleSaveFailed);

  const wanted = new Map(parsed.slots.map((s) => [s.time, s.instructions]));
  const have = new Map<string, { id: string; enabled: boolean; instructions: string | null }>();
  for (const row of existing ?? []) {
    const slot = normalizeSlotTime(row.slot_time);
    if (slot) have.set(slot, { id: row.id, enabled: row.enabled, instructions: row.instructions });
  }

  const disable = [...have].filter(([slot, row]) => !wanted.has(slot) && row.enabled).map(([, row]) => row.id);
  // A kept or returning slot: enabled, with the instructions as submitted.
  // Only rows whose state actually changes are written.
  const keep = [...have].filter(
    ([slot, row]) => wanted.has(slot) && (!row.enabled || row.instructions !== wanted.get(slot)),
  );
  const insert = parsed.slots
    .filter((s) => !have.has(s.time))
    .map((s) => ({
      allowlist_entry_id: parsed.entryId,
      report_key: DAILY_BUSINESS_REPORT,
      slot_time: `${s.time}:00`,
      timezone: REPORT_TIMEZONE,
      enabled: true,
      instructions: s.instructions,
      // The acting owner, from the session — never from the form.
      created_by: actor.id,
    }));

  if (disable.length > 0) {
    const { error } = await admin.from('owner_agent_report_subscription').update({ enabled: false }).in('id', disable);
    if (error) throw new Error(E.scheduleSaveFailed);
  }
  // At most 24 rows per owner (the Zod limit), one small update each.
  for (const [slot, row] of keep) {
    const { error } = await admin
      .from('owner_agent_report_subscription')
      .update({ enabled: true, instructions: wanted.get(slot) ?? null })
      .eq('id', row.id);
    if (error) throw new Error(E.scheduleSaveFailed);
  }
  if (insert.length > 0) {
    const { error } = await admin.from('owner_agent_report_subscription').insert(insert);
    if (error) throw new Error(E.scheduleSaveFailed);
  }

  // Times and whether each has instructions — never the instruction text.
  await logActivity({
    action: 'admin.owner_agent.report_schedule_set',
    meta: {
      entryId: parsed.entryId,
      optIn: parsed.optIn,
      slots: parsed.slots.map((s) => s.time).sort(),
      withInstructions: parsed.slots.filter((s) => s.instructions !== null).map((s) => s.time).sort(),
    },
  });
}
