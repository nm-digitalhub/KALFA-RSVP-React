import 'server-only';

import { z } from 'zod';

import type { SlackAlertInput } from '@/lib/alerts/slack';
import type { WhatsAppSender } from '@/lib/owner-agent/consumer/reply';
import { splitForWhatsApp } from '@/lib/owner-agent/consumer/reply-text';
import { OwnerAgentRunError } from '@/lib/owner-agent/runner';
import { OWNER_AGENT_PERMISSIONS, type OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import type { DeliveryOutcome } from '@/lib/whatsapp/client';

import {
  permittedSections,
  type ReportContent,
  type ReportSection,
} from './content';
import {
  DAILY_BUSINESS_REPORT,
  REPORT_CATCH_UP_MS,
  normalizeSlotTime,
  reportPeriod,
  wallTimeToInstant,
  type ReportPeriod,
} from './planner';
import type { ReportAuditInput, ReportEntryRow, ReportRunRow, ReportStore, ReportSubscriptionRow } from './store';

// One job of QUEUES.ownerAgentReport: send ONE planned report run
// (plans/owner-agent-chat-sdk-capabilities-plan.md §4.8) — the report twin of
// consumer/reply.ts, with the same three rules:
//
//   load the run → too late? expired → claim it (queued|processing → processing)
//   → the gate, against current state → the permitted sections
//   → the content: from the cores, or — when the subscription carries the
//     owner's instructions — from the model (model-content.ts) → the channel
//   → the gate AGAIN → claim the send (processing → sending)
//   → the text or the template → sent | failed, and one audit row.
//
// ⚠️ SILENCE IS THE DEFAULT. A gate that fails — at the start or at send time —
// ends with an audit row and no message. The switch, the reports switch, the
// number, the allow-list row, its opt-in, the subscription and the identity
// (by approval_kind, exactly as reply.ts agentGate) are all re-read here; the
// planner's own filter is a convenience, not the gate.
//
// ⚠️ NEVER TWICE. The run table's UNIQUE key allows one run per slot, and a
// message leaves only after THIS handler moved the run processing → sending. A
// handler that finds `sending` marks the run failed and sends nothing. Nothing
// after the send claim throws, so pg-boss never retries a job whose report may
// already be out.
//
// ⚠️ NEVER FREE TEXT OUTSIDE THE WINDOW. Free text goes out only while the
// staff member's last message to this number is younger than 24h minus a
// 15-minute margin; otherwise an approved template from app_settings, and no
// template = skipped/template_unavailable. The one fallback: a text that Meta
// refused with 131047 (closed window, `definitely_not_sent` — proven not sent)
// before any part went out is retried once as the template.
//
// TWO TEMPLATES, bound to the content's kind (content.ts ReportContent): the
// numbers go out as the numeric template (4 params), a report written from the
// owner's instructions as the custom template (2 params: period, summary). A
// subscription's own template_name overrides the one of ITS mode only. With no
// custom template, a model report that has to leave outside the window becomes
// the numeric report (with MODEL_FALLBACK_NOTE in its text, and
// `custom_template_missing` in the audit) — and that is decided before the
// model runs, so the run is not paid for. The 131047 fallback has no such
// switch (nothing may be read after the send claim): model text refused with
// 131047 and no custom template is `window_closed`.
//
// ⚠️ ONE MODEL RUN AT A TIME. A report with instructions runs the model, and a
// model run must never overlap an answer's. The answer's serialization is the
// REPLY queue itself: one worker, batchSize 1, localConcurrency 1, in the one
// kalfa-owner-agent process. So a model report is not run here on the report
// queue: before claiming anything, this handler hands the run to that queue
// (deps.reroute, deterministicJobId('owner-report-model:' + runId)) and returns;
// the reply worker calls this same handler with lane 'model'. Waiting happens in
// the queue, not inside a handler, so neither an answer's budget nor a report's
// grows by the other's run (reports/budgets.ts REPORT_MODEL_MAX_MS fits the
// reply queue's expiry). A deterministic report needs no model and stays on its
// own queue, never delaying an answer.
//
// PRIVACY. Ids and codes only in logs, alerts and audit rows. The recipient is
// the allow-list row's own e164 — the same rule as an answer — sent from
// owner_agent_phone_number_id; neither is stored on the run.

/** Meta's customer-service window (reply.ts ANSWER_WINDOW_MS), less a margin for the send itself. */
export const REPORT_TEXT_WINDOW_MS = 24 * 60 * 60 * 1000 - 15 * 60 * 1000;

/** A template with no language configured is sent in Hebrew. */
export const DEFAULT_TEMPLATE_LANG = 'he';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jobSchema = z.object({ runId: z.string().regex(UUID) });

export interface ReportDeps {
  store: ReportStore;
  /** Which queue this handler runs on: the report queue, or the reply queue (model reports). */
  lane: 'report' | 'model';
  /** Hand a model report to the reply queue. Only the report lane needs it. */
  reroute?: (runId: string) => Promise<boolean>;
  /** model-content.ts buildModelReportContent, bound to the runner. Only the model lane needs it. */
  modelContent?: (
    instructions: string,
    permissions: readonly OwnerAgentPermission[],
    period: ReportPeriod,
    nowMs: number,
  ) => Promise<ReportContent>;
  /** content.ts buildReportContent, bound to the service-role client. */
  content: (sections: readonly ReportSection[], period: ReportPeriod, nowMs: number) => Promise<ReportContent>;
  /** Send credentials for `phoneNumberId`, or null when WhatsApp is not configured. */
  sender: (phoneNumberId: string) => Promise<WhatsAppSender | null>;
  sendText: (sender: WhatsAppSender, params: { to: string; body: string }) => Promise<DeliveryOutcome>;
  sendTemplate: (
    sender: WhatsAppSender,
    params: { to: string; templateName: string; language: string; bodyParams: readonly string[] },
  ) => Promise<DeliveryOutcome>;
  alert: (input: SlackAlertInput) => Promise<unknown>;
  log: (line: string) => void;
  now: () => number;
}

export type ReportOutcome =
  | 'sent'
  | 'rerouted'
  | 'send_failed'
  | 'send_unconfirmed'
  | 'gated'
  | 'send_gated'
  | 'skipped'
  | 'expired'
  | 'not_found'
  | 'already_done'
  | 'lost_race'
  | 'invalid_job';

/** Thrown before any send; pg-boss retries the job. The message is a code. */
export class OwnerAgentReportError extends Error {
  constructor(readonly code: string) {
    super(`owner_agent_report_${code}`);
    this.name = 'OwnerAgentReportError';
  }
}

/** A template as configured in app_settings: either part may be null. */
interface ConfiguredTemplate {
  name: string | null;
  lang: string | null;
}

interface Template {
  templateName: string;
  language: string;
}

type GateResult =
  | {
      ok: true;
      entry: ReportEntryRow;
      staffUserId: string | null;
      phoneNumberId: string;
      numericTemplate: ConfiguredTemplate;
      customTemplate: ConfiguredTemplate;
      permissions: OwnerAgentPermission[];
    }
  | { ok: false; reason: string; entry?: ReportEntryRow };

interface Ctx {
  run: ReportRunRow;
  started: number;
  staffUserId: string | null;
  entryId: string | null;
}

/**
 * On the reply queue, a model-backed report carries { runId } and an answer
 * { intakeId } (consumer/main.ts routes on this). Each handler still validates
 * its own payload in full; anything that is not clearly a report goes to the
 * reply handler, which refuses what it does not know.
 */
export function isOwnerAgentReportJob(data: unknown): data is { runId: string } {
  return typeof data === 'object' && data !== null && 'runId' in data && !('intakeId' in data);
}

export async function handleOwnerAgentReport(job: { data: unknown }, deps: ReportDeps): Promise<ReportOutcome> {
  const parsed = jobSchema.safeParse(job.data);
  if (!parsed.success) {
    deps.log('[owner-agent] report invalid_job');
    return 'invalid_job';
  }
  const run = await deps.store.loadRun(parsed.data.runId);
  if (!run) {
    deps.log(`[owner-agent] report run=${parsed.data.runId} not_found`);
    return 'not_found';
  }
  const outcome = await handleRun(run, deps);
  deps.log(`[owner-agent] report run=${run.id} ${outcome}`);
  return outcome;
}

async function handleRun(run: ReportRunRow, deps: ReportDeps): Promise<ReportOutcome> {
  const { store } = deps;
  const ctx: Ctx = { run, started: deps.now(), staffUserId: null, entryId: null };

  if (run.status === 'sending') {
    // An earlier handler claimed the send and died before recording it.
    // Whether the report went out is unknown — so nothing is sent.
    if (await store.transitionRun(run.id, ['sending'], 'failed', { errorCode: 'send_unconfirmed' })) {
      await audit(deps, ctx, { outcome: 'send_failed', reasonCode: 'send_unconfirmed' });
    }
    return 'send_unconfirmed';
  }
  if (run.status !== 'queued' && run.status !== 'processing') return 'already_done';

  const sub = await store.loadSubscription(run.subscriptionId);
  if (!sub) {
    // The subscription is gone (its allow-list row was removed — ON DELETE
    // CASCADE would normally take the run with it).
    return skip(deps, ctx, ['queued', 'processing'], 'gated', 'subscription_off');
  }

  // Late: the slot's minute began more than the catch-up window ago. A report
  // that arrives hours late is not the report that was asked for.
  let slotMs: number;
  try {
    slotMs = wallTimeToInstant(run.localDate, run.slotTime, sub.timezone);
  } catch {
    return skip(deps, ctx, ['queued', 'processing'], 'gated', 'bad_slot');
  }
  if (deps.now() - slotMs >= REPORT_CATCH_UP_MS) {
    if (await store.transitionRun(run.id, ['queued', 'processing'], 'expired', { errorCode: 'late' })) {
      await audit(deps, ctx, { outcome: 'expired', reasonCode: 'late' });
    }
    return 'expired';
  }

  // A report with instructions runs the model, and the model runs only on the
  // reply queue (header). Nothing is claimed here: the run stays as it is, and
  // the reply worker picks it up. A repeat hand-off is a no-op (same job id).
  const instructions = sub.instructions?.trim() || null;
  if (instructions && deps.lane === 'report' && deps.reroute) {
    await deps.reroute(run.id);
    return 'rerouted';
  }

  // 'processing' is claimable too: a handler that died before the send claim
  // left it there, and redoing the reads is safe — nothing was sent.
  if (!(await store.transitionRun(run.id, ['queued', 'processing'], 'processing'))) return 'lost_race';

  const gate = await reportGate(run, deps);
  if (gate.entry) {
    ctx.entryId = gate.entry.id;
    ctx.staffUserId = gate.entry.staffUserId;
  }
  if (!gate.ok) return skip(deps, ctx, ['processing'], 'gated', gate.reason);

  // external_override rows hold no platform permission, so no section: a
  // deterministic report would be empty, and is not sent. A model report runs
  // with the recipient's permissions whatever they are — the same run that
  // recipient's own question would get (an external row has read-only SQL, no
  // count tools).
  const sections = permittedSections(gate.permissions);
  const useModel = instructions !== null && deps.lane === 'model' && deps.modelContent !== undefined;
  if (!useModel && sections.length === 0) return skip(deps, ctx, ['processing'], 'skipped', 'no_permissions');

  // Read BEFORE the content: a missing configuration must not cost the reads.
  const sender = await deps.sender(gate.phoneNumberId);
  if (!sender) throw new OwnerAgentReportError('whatsapp_not_configured');

  // The subscription's own template belongs to its mode: with instructions it
  // replaces the custom template, without them the numeric one. So a model
  // report that falls back to the numbers never puts four params into a
  // subscription's two-param template.
  const templates = {
    numeric: resolveTemplate(instructions ? null : sub, gate.numericTemplate),
    custom: resolveTemplate(instructions ? sub : null, gate.customTemplate),
  };

  // The window is per business number, so only intake on the number the
  // report goes out from counts.
  const windowOpen = async (): Promise<boolean> => {
    const lastIntake = await store.lastIntakeAt(gate.entry.id, gate.phoneNumberId);
    const lastMs = lastIntake ? Date.parse(lastIntake) : Number.NaN;
    return !Number.isNaN(lastMs) && deps.now() - lastMs < REPORT_TEXT_WINDOW_MS;
  };

  const period = reportPeriod(run.localDate, run.slotTime, sub.timezone);
  // The numeric report standing in for a model report, with a note. One core
  // read; it throws before the claim, as any content read does.
  const numbersInstead = async (): Promise<ReportContent> => {
    const fallback = await deps.content(sections, period, deps.now());
    return { ...fallback, text: `${MODEL_FALLBACK_NOTE}\n\n${fallback.text}` };
  };
  let content: ReportContent;
  // Why a model report went out as the numbers: its run failed, or it could
  // not leave as the custom template.
  let degraded: 'model_fallback' | 'custom_template_missing' | null = null;
  if (useModel && !templates.custom && !(await windowOpen())) {
    // Outside the window with no custom template the model's text cannot go
    // out: the numbers instead, and no model run is paid for.
    if (sections.length === 0 || !templates.numeric) {
      return skip(deps, ctx, ['processing'], 'skipped', 'template_unavailable');
    }
    content = await numbersInstead();
    degraded = 'custom_template_missing';
  } else if (useModel) {
    try {
      content = await deps.modelContent!(instructions!, gate.permissions, period, deps.now());
    } catch (e) {
      // Graceful degradation: the deterministic report, with a note, rather
      // than a second paid run or silence.
      const code = runFailureCode(e);
      if (sections.length === 0) return skip(deps, ctx, ['processing'], 'skipped', code);
      content = await numbersInstead();
      degraded = 'model_fallback';
    }
  } else {
    // A failed core read throws here, before the claim: pg-boss retries.
    content = await deps.content(sections, period, deps.now());
  }

  // The channel, decided right before the claim.
  const inWindow = await windowOpen();
  if (!inWindow && content.kind === 'custom' && !templates.custom) {
    // The window closed while the model wrote the report: the same switch as
    // above, now after the run.
    if (sections.length === 0 || !templates.numeric) {
      return skip(deps, ctx, ['processing'], 'skipped', 'template_unavailable', auditSections(content));
    }
    content = await numbersInstead();
    degraded = 'custom_template_missing';
  }
  const template = content.kind === 'custom' ? templates.custom : templates.numeric;
  if (!inWindow && !template) {
    return skip(deps, ctx, ['processing'], 'skipped', 'template_unavailable', auditSections(content));
  }

  // The gate AGAIN, against the state now (the reads took a moment), plus:
  // the same recipient, the same number, and every section still permitted.
  const again = await reportGate(run, deps);
  const blocked = !again.ok
    ? again.reason
    : again.entry.e164 !== gate.entry.e164
      ? 'not_allowlisted'
      : again.phoneNumberId !== gate.phoneNumberId
        ? 'number_changed'
        : content.permissions.some((p) => !again.permissions.includes(p))
          ? 'permissions_changed'
          : null;
  if (blocked) return skip(deps, ctx, ['processing'], 'send_gated', blocked, auditSections(content));

  if (!(await store.transitionRun(run.id, ['processing'], 'sending'))) return 'lost_race';

  // ── Past the send claim: nothing below may throw. ──────────────────────────
  const from: WhatsAppSender = { ...sender, phoneNumberId: gate.phoneNumberId };
  const to = gate.entry.e164;
  let result: DeliveryResult;
  if (inWindow) result = await deliverText(from, to, content, template, deps);
  else if (template) result = await deliverTemplate(from, to, content, template, deps);
  // Unreachable (checked before the claim), and kept that way: outside the
  // window without a template nothing is sent, never free text.
  else result = { ok: false, channel: 'template', wamid: null, code: 'template_unavailable' };

  const finished = deps.now();
  const recorded = await quietly(() =>
    store.transitionRun(run.id, ['sending'], result.ok ? 'sent' : 'failed', {
      channel: result.channel,
      outboundWamid: result.wamid,
      errorCode: result.ok ? null : result.code,
      sentAt: result.ok ? new Date(finished).toISOString() : null,
    }),
  );
  if (recorded !== true) {
    // The run stays `sending`; no later handler will send for it.
    deps.log(`[owner-agent] report status_not_recorded run=${run.id}`);
  }
  await audit(deps, ctx, {
    outcome: result.ok ? 'sent' : 'send_failed',
    reasonCode: result.ok ? (result.fellBack ? 'template_fallback' : degraded) : result.code,
    sections: auditSections(content),
    latencyMs: finished - ctx.started,
  });
  return result.ok ? 'sent' : 'send_failed';
}

/** The first line of a report whose model run failed and fell back to the numbers. */
export const MODEL_FALLBACK_NOTE = 'לא הצלחתי להכין את הדוח לפי ההנחיות שלך, אז זה הדוח הרגיל:';

const CODE = /^[a-z][a-z0-9_]{0,63}$/;
function runFailureCode(e: unknown): string {
  if (e instanceof OwnerAgentRunError) return e.code;
  return e instanceof Error && CODE.test(e.message) ? e.message : 'run_exception';
}

// What the audit's tool_names records: the deterministic sections, or the
// tools a model report used.
function auditSections(content: ReportContent): readonly string[] {
  return content.sections.length > 0 ? content.sections : (content.toolNames ?? []);
}

// The report's gate, against the state NOW. Identity exactly as reply.ts
// agentGate: verified_staff — still staff and the row phone is still their
// verified phone; staff_unverified_override — still staff; external_override —
// not staff, no platform permissions. Permissions: one RPC per key, from the
// staff member's role, server-side.
async function reportGate(run: ReportRunRow, deps: ReportDeps): Promise<GateResult> {
  const { store } = deps;
  const settings = await store.readSettings();
  if (!settings) return { ok: false, reason: 'not_configured' };
  if (!settings.enabled) return { ok: false, reason: 'kill_switch_off' };
  if (!settings.reportsEnabled) return { ok: false, reason: 'reports_off' };
  if (!settings.phoneNumberId) return { ok: false, reason: 'no_number' };

  const sub = await store.loadSubscription(run.subscriptionId);
  if (!subscriptionHoldsSlot(sub, run)) return { ok: false, reason: 'subscription_off' };

  const entry = await store.loadEntry(sub.allowlistEntryId);
  if (!entry || !entry.enabled) return { ok: false, reason: 'not_allowlisted' };
  if (!entry.reportOptIn) return { ok: false, reason: 'not_opted_in', entry };

  let staffUserId: string | null = null;
  if (entry.approvalKind !== 'external_override') {
    if (!entry.staffUserId || !(await store.isStaff(entry.staffUserId))) {
      return { ok: false, reason: 'not_staff', entry };
    }
    staffUserId = entry.staffUserId;
  }
  if (entry.approvalKind === 'verified_staff' && staffUserId) {
    if ((await store.verifiedPhone(staffUserId)) !== entry.e164) {
      return { ok: false, reason: 'phone_unverified', entry };
    }
  }

  const staffId = staffUserId;
  const granted = staffId
    ? await Promise.all(
        OWNER_AGENT_PERMISSIONS.map(async (key) => ((await store.hasPermission(staffId, key)) ? key : null)),
      )
    : [];
  return {
    ok: true,
    entry,
    staffUserId,
    phoneNumberId: settings.phoneNumberId,
    numericTemplate: { name: settings.templateName, lang: settings.templateLang },
    customTemplate: { name: settings.customTemplateName, lang: settings.customTemplateLang },
    permissions: granted.filter((key): key is OwnerAgentPermission => key !== null),
  };
}

// Still enabled, still the daily report, and still THIS slot. The admin screen
// never moves a subscription's slot_time (it adds and disables rows), but a
// row edited by hand must not send a report for a slot it no longer has.
function subscriptionHoldsSlot(sub: ReportSubscriptionRow | null, run: ReportRunRow): sub is ReportSubscriptionRow {
  if (!sub || !sub.enabled || sub.reportKey !== DAILY_BUSINESS_REPORT) return false;
  const a = normalizeSlotTime(sub.slotTime);
  return a !== null && a === normalizeSlotTime(run.slotTime);
}

// The subscription's own name and language first (each on its own, as stored),
// then app_settings', then Hebrew. No name anywhere = no template.
function resolveTemplate(sub: ReportSubscriptionRow | null, configured: ConfiguredTemplate): Template | null {
  const templateName = sub?.templateName ?? configured.name;
  if (!templateName) return null;
  return { templateName, language: sub?.templateLang ?? configured.lang ?? DEFAULT_TEMPLATE_LANG };
}

type DeliveryResult =
  | { ok: true; channel: 'text' | 'template'; wamid: string | null; fellBack: boolean }
  | { ok: false; channel: 'text' | 'template'; wamid: string | null; code: string };

async function send(fn: () => Promise<DeliveryOutcome>): Promise<DeliveryOutcome> {
  try {
    return await fn();
  } catch {
    return { kind: 'unknown', reason: 'send_threw' };
  }
}

function failureCode(outcome: Exclude<DeliveryOutcome, { kind: 'accepted' }>, sentBefore: number): string {
  if (sentBefore > 0) return 'partial_send';
  if (outcome.kind === 'definitely_not_sent') {
    if (outcome.providerCode === '131047') return 'window_closed';
    // Meta's own code, so the log says WHY it was refused (meta_<digits>).
    return outcome.providerCode && /^[0-9]{1,12}$/.test(outcome.providerCode)
      ? `meta_${outcome.providerCode}`
      : 'provider_rejected';
  }
  return 'send_unknown';
}

async function deliverText(
  from: WhatsAppSender,
  to: string,
  content: ReportContent,
  template: Template | null,
  deps: ReportDeps,
): Promise<DeliveryResult> {
  let sent = 0;
  let firstWamid: string | null = null;
  for (const part of splitForWhatsApp(content.text)) {
    const outcome = await send(() => deps.sendText(from, { to, body: part }));
    if (outcome.kind === 'accepted') {
      firstWamid ??= outcome.providerId;
      sent += 1;
      continue;
    }
    // The one fallback: nothing went out, and Meta said so with 131047.
    const closedWindow =
      sent === 0 && outcome.kind === 'definitely_not_sent' && outcome.providerCode === '131047';
    if (closedWindow && template) {
      const viaTemplate = await deliverTemplate(from, to, content, template, deps);
      return viaTemplate.ok ? { ...viaTemplate, fellBack: true } : viaTemplate;
    }
    return { ok: false, channel: 'text', wamid: firstWamid, code: failureCode(outcome, sent) };
  }
  return { ok: true, channel: 'text', wamid: firstWamid, fellBack: false };
}

async function deliverTemplate(
  from: WhatsAppSender,
  to: string,
  content: ReportContent,
  template: Template,
  deps: ReportDeps,
): Promise<DeliveryResult> {
  const outcome = await send(() =>
    deps.sendTemplate(from, {
      to,
      templateName: template.templateName,
      language: template.language,
      bodyParams: content.templateParams,
    }),
  );
  if (outcome.kind === 'accepted') {
    return { ok: true, channel: 'template', wamid: outcome.providerId, fellBack: false };
  }
  return { ok: false, channel: 'template', wamid: null, code: failureCode(outcome, 0) };
}

async function skip(
  deps: ReportDeps,
  ctx: Ctx,
  from: Array<'queued' | 'processing'>,
  outcome: 'gated' | 'send_gated' | 'skipped',
  reason: string,
  sections?: readonly string[],
): Promise<ReportOutcome> {
  if (await deps.store.transitionRun(ctx.run.id, from, 'skipped', { errorCode: reason })) {
    await audit(deps, ctx, { outcome, reasonCode: reason, sections });
  }
  return outcome;
}

async function audit(
  deps: ReportDeps,
  ctx: Ctx,
  row: Omit<ReportAuditInput, 'reportRunId' | 'staffUserId' | 'allowlistEntryId'>,
): Promise<void> {
  const ok = await deps.store.writeAudit({
    ...row,
    reportRunId: ctx.run.id,
    staffUserId: ctx.staffUserId,
    allowlistEntryId: ctx.entryId,
  });
  if (ok) return;
  deps.log(`[owner-agent] report audit_failed run=${ctx.run.id} outcome=${row.outcome}`);
  await quietly(() =>
    deps.alert({
      level: 'error',
      category: 'errors',
      source: 'owner-agent',
      title: 'סוכן הבעלים — שורת audit של דוח לא נכתבה',
      detail: 'הטיפול בדוח הסתיים, אבל שורת ה-audit שלו לא נשמרה.',
      fields: { run: ctx.run.id, outcome: row.outcome },
    }),
  );
}

async function quietly<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
