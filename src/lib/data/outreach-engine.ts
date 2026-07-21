import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
  getSendPolicy,
} from '@/lib/data/outreach-config';
import { resolveTemplateForEvent } from '@/lib/data/message-templates-resolve';
import { recordTemplateFailure, resolveTemplateMedia, sendOneWhatsApp } from '@/lib/data/outreach';
import {
  buildBodyParams,
  deriveGuestFirstName,
  type TemplateParamsContext,
} from '@/lib/whatsapp/template-spec';
import { recordReached, type ReachedArgs } from '@/lib/data/billing';
import { setContactOpStatus } from '@/lib/data/interactions';
import { isPastEventDay } from '@/lib/data/event-date';
import { isReconcileEnabled } from '@/lib/data/reconcile-config';
import {
  detId,
  stepPlanRev,
  stepAuditId,
  type Touchpoint,
} from '@/lib/outreach/schedule';
import {
  evaluateStep,
  plannedSendTime,
} from '@/lib/outreach/send-window';
import { buildJewishCalendar } from '@/lib/outreach/jewish-calendar';
import { enqueueStepJob, type StepSendResult } from '@/lib/outreach/enqueue';
import { CALL_RETRY, QUEUES, type OutreachCallRequest, type OutreachStepMode } from '@/lib/queue/queues';
import type { PgBoss } from 'pg-boss';

const DAY_MS = 86_400_000;

// The C1 outreach-engine data layer. REQUEST-FREE (no cookies / requireUser) —
// it runs from the pg-boss worker (a long-lived process), scoping by loading the
// campaign/event rows, and writes via the service-role admin client. The worker
// (worker/main.ts) owns all pg-boss send/work/schedule; this module is the
// testable decision + DB layer. Nothing runs until outreach_enabled is on.

type AdminClient = ReturnType<typeof createAdminClient>;

export type CampaignContext = {
  status: string;
  event_id: string;
  allowed_channels: string[];
  start_at: string | null;
  close_at: string | null;
  schedule: Touchpoint[];
  eventDate: string;
  eventStatus: string;
  /**
   * events.rsvp_deadline — a plain `date` (no time), or null for "no deadline".
   * Loaded for the AI-call dispatcher, which must not place a call whose answer
   * submit_rsvp would refuse. stepGate deliberately does NOT gate on it: a
   * WhatsApp reminder after the deadline is still informational, whereas a call
   * exists only to collect an RSVP.
   */
  rsvpDeadline: string | null;
  inviteImagePath: string | null;
  // The template-binding slice of the event row (event_date repeats eventDate —
  // kept flat above for the worker's scheduling math, nested here in exactly
  // the shape buildTemplateParams consumes).
  event: TemplateParamsContext['event'];
};

// Seed one outreach_state row per FROZEN-set contact at activation (idempotent).
// The set is the binding cap, so the engine can never target a non-set contact.
export async function seedOutreachState(
  eventId: string,
  campaignId: string,
): Promise<number> {
  const admin = createAdminClient();
  const { data: set, error } = await admin
    .from('campaign_authorized_contacts')
    .select('contact_id')
    .eq('campaign_id', campaignId);
  if (error) throw new Error('טעינת מערך אנשי הקשר נכשלה');
  const rows = (set ?? []).map((r) => ({
    event_id: eventId,
    campaign_id: campaignId,
    contact_id: r.contact_id,
  }));
  if (rows.length > 0) {
    const { error: insErr } = await admin
      .from('outreach_state')
      .upsert(rows, {
        onConflict: 'campaign_id,contact_id',
        ignoreDuplicates: true,
      });
    if (insErr) throw new Error('יצירת מצב ה-outreach נכשלה');
  }
  return rows.length;
}

// Active campaigns the arm cron drives (worker side).
export async function listActiveCampaigns(): Promise<
  Array<{ id: string; event_id: string }>
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id')
    .eq('status', 'active');
  if (error) throw new Error('טעינת הקמפיינים הפעילים נכשלה');
  return data ?? [];
}

// The active engine cursors for a campaign (one per still-running contact).
export async function listActiveOutreach(
  campaignId: string,
): Promise<Array<{ contact_id: string; current_step_index: number }>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('outreach_state')
    .select('contact_id, current_step_index')
    .eq('campaign_id', campaignId)
    .eq('status', 'active');
  if (error) throw new Error('טעינת מצב ה-outreach נכשלה');
  return data ?? [];
}

export async function getCampaignContext(
  campaignId: string,
): Promise<CampaignContext | null> {
  const admin = createAdminClient();
  const { data: c, error } = await admin
    .from('campaigns')
    .select('status, event_id, allowed_channels, start_at, close_at, outreach_schedule')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !c) return null;
  const { data: ev } = await admin
    .from('events')
    .select('event_date, status, rsvp_deadline, name, event_type, venue_name, venue_address, celebrants, invite_image_path')
    .eq('id', c.event_id)
    .maybeSingle();
  if (!ev?.event_date) return null;
  return {
    status: c.status,
    event_id: c.event_id,
    allowed_channels: (c.allowed_channels ?? []) as string[],
    start_at: c.start_at,
    close_at: c.close_at,
    schedule: (c.outreach_schedule as Touchpoint[] | null) ?? [],
    eventDate: ev.event_date,
    eventStatus: ev.status,
    rsvpDeadline: ev.rsvp_deadline ?? null,
    inviteImagePath: ev.invite_image_path ?? null,
    event: {
      name: ev.name,
      event_type: ev.event_type,
      event_date: ev.event_date,
      venue_name: ev.venue_name,
      venue_address: ev.venue_address,
      celebrants: ev.celebrants,
    },
  };
}

// A contact is reached (billed) for this event → the stop-on-reach guarantee.
// billed_results UNIQUE(event_id, contact_id) makes reach event-scoped /
// cross-channel — this execution-time check is the real stop (not job cancel).
export async function isContactReached(
  eventId: string,
  contactId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { count } = await admin
    .from('billed_results')
    .select('contact_id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('contact_id', contactId);
  return (count ?? 0) > 0;
}

// Call-consent gate for the AI-call channel (C2). The dispatcher is the FIRST and
// ONLY enforcement point (nothing upstream checks it — only allowed_channels).
// True ONLY when the contact exists, is not opted out (removal_requested), AND has
// a recorded call consent. Fail-CLOSED: any read error → false (no call).
export async function hasCallConsent(contactId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('contacts')
      .select('removal_requested, call_consent_at')
      .eq('id', contactId)
      .maybeSingle();
    if (error || !data) return false;
    return !data.removal_requested && data.call_consent_at != null;
  } catch {
    return false;
  }
}

// Do-Not-Call suppression for the AI-call channel. True when the number is on the
// call_dnc_list. Fail-CLOSED: on error treat as listed (suppress the call).
export async function isDncListed(normalizedPhone: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('call_dnc_list')
      .select('normalized_phone')
      .eq('normalized_phone', normalizedPhone)
      .maybeSingle();
    if (error) return true;
    return data != null;
  } catch {
    return true;
  }
}

// The gate the worker checks at the top of every step. nowMs is injectable.
export type GateReason = 'paused' | 'stopped' | 'reached' | 'ok';
export async function stepGate(
  campaignId: string,
  contactId: string,
  eventId: string,
  nowMs: number = Date.now(),
): Promise<{ reason: GateReason; ctx?: CampaignContext }> {
  if (!(await getOutreachEnabled())) return { reason: 'paused' };
  const ctx = await getCampaignContext(campaignId);
  if (!ctx) return { reason: 'stopped' };
  // §11.7: pause is REVERSIBLE — never terminalize. A paused campaign re-polls
  // (id-less, like the global outreach_enabled-off gate); only closed/cancelled/
  // past-event/event-not-active are terminal ('stopped').
  if (ctx.status === 'paused') return { reason: 'paused' };
  if (ctx.status !== 'active') return { reason: 'stopped' };
  if (ctx.close_at && nowMs > new Date(ctx.close_at).getTime()) {
    return { reason: 'stopped' };
  }
  // L1: stop on the LIVE event_date (not just the close_at snapshot, which can go
  // stale if the date is edited) — never send/bill for an event whose day has passed.
  if (isPastEventDay(ctx.eventDate, nowMs)) return { reason: 'stopped' };
  // R9: every commercial campaign action requires event.status='active' — app
  // defense-in-depth (campaign.status='active' here already structurally
  // implies it via the DB trigger + R7), explicit per the plan's "ALL
  // commercial paths" requirement.
  if (ctx.eventStatus !== 'active') return { reason: 'stopped' };
  if (await isContactReached(eventId, contactId)) return { reason: 'reached' };
  return { reason: 'ok', ctx };
}

// Atomic compare-and-advance: only the FIRST delivery of step N matches and
// advances the cursor; duplicates/retries get 0 rows and must not send.
export async function claimStep(
  campaignId: string,
  contactId: string,
  stepIndex: number,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('outreach_state')
    .update({ current_step_index: stepIndex + 1 })
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .eq('current_step_index', stepIndex)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('עדכון מצב ה-outreach נכשל');
  return data !== null;
}

export async function setOutreachStatus(
  campaignId: string,
  contactId: string,
  status: 'reached' | 'stopped' | 'exhausted' | 'not_eligible',
  stopReason?: string,
): Promise<void> {
  const admin = createAdminClient();
  const patch: { status: string; stop_reason?: string; reached_at?: string } = {
    status,
  };
  if (stopReason) patch.stop_reason = stopReason;
  if (status === 'reached') patch.reached_at = new Date().toISOString();
  await admin
    .from('outreach_state')
    .update(patch)
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId);
}

// Record the first-decided send instant for a contact's current step (the
// send-timing re-plan anchor / audit). Best-effort; correctness rests on the
// deterministic plan + det-id queue idempotency + the execution-time gate.
export async function setPlannedAt(
  campaignId: string,
  contactId: string,
  plannedAtIso: string | null,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('outreach_state')
    .update({ planned_at: plannedAtIso })
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId);
}

async function bumpCount(
  admin: AdminClient,
  campaignId: string,
  contactId: string,
  field: 'whatsapp_sent_count' | 'call_request_count',
): Promise<void> {
  const { data } = await admin
    .from('outreach_state')
    .select(field)
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .maybeSingle();
  const cur = (data as Record<string, number> | null)?.[field] ?? 0;
  const patch =
    field === 'whatsapp_sent_count'
      ? { whatsapp_sent_count: cur + 1 }
      : { call_request_count: cur + 1 };
  await admin
    .from('outreach_state')
    .update(patch)
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId);
}

export type StepAction =
  | { action: 'whatsapp_sent' }
  | { action: 'call_request'; callRequest: OutreachCallRequest }
  | { action: 'skipped' };

// Execute touchpoint N for a contact (called AFTER the worker schedules N+1).
// Re-checks eligibility, atomically claims the step, then sends (WhatsApp) or
// signals a call dispatch. At-most-once by design (a missed nudge beats a double
// message; the multi-touchpoint schedule self-covers).
export async function executeStep(
  ctx: CampaignContext,
  campaignId: string,
  contactId: string,
  eventId: string,
  stepIndex: number,
): Promise<StepAction> {
  const tp = ctx.schedule[stepIndex];
  if (!tp) return { action: 'skipped' };
  const admin = createAdminClient();

  const { data: contact } = await admin
    .from('contacts')
    .select('id, normalized_phone, removal_requested, whatsapp_consent_at')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact || contact.removal_requested) return { action: 'skipped' };
  if (tp.channel === 'whatsapp' && !contact.whatsapp_consent_at) {
    return { action: 'skipped' };
  }
  if (tp.channel === 'call' && !ctx.allowed_channels.includes('call')) {
    return { action: 'skipped' };
  }

  // Claim — only the first delivery proceeds; duplicates exit here.
  if (!(await claimStep(campaignId, contactId, stepIndex))) {
    return { action: 'skipped' };
  }

  if (tp.channel === 'whatsapp') {
    const config = await getWhatsAppConfig();
    if (!config) {
      // Expected fail-closed state (WhatsApp not yet configured) — NOT a
      // template-integrity failure. Do not log here, or every environment
      // that hasn't configured WhatsApp yet floods the sink for no reason.
      return { action: 'skipped' };
    }
    // Event-type-aware resolution: the generic row's components.variants may
    // swap in the wedding-family template name for this event type.
    const template = await resolveTemplateForEvent(tp.message_key, ctx.event.event_type);
    if (!template) {
      await recordTemplateFailure(admin, campaignId, stepIndex, 'template_missing', tp.message_key, tp.channel);
      return { action: 'skipped' };
    }
    if (template.channel !== 'whatsapp') {
      await recordTemplateFailure(admin, campaignId, stepIndex, 'channel_mismatch', tp.message_key, tp.channel);
      return { action: 'skipped' };
    }
    // {{1}} source: the recipient's linked guest name, oldest guest first
    // (deterministic when a family shares one phone → several guests per
    // contact). No linked guest → null; buildTemplateParams falls back to the
    // generic greeting rather than dropping the touchpoint.
    const { data: guest } = await admin
      .from('guests')
      .select('full_name')
      .eq('event_id', eventId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    // Shared {{1}} rule (deriveGuestFirstName): first token of the linked
    // guest's name; households ("משפחת …")/no-guest → null → generic greeting.
    const guestFirstName = deriveGuestFirstName(guest?.full_name);
    // Which side of the Meta positional contract to bind — the wedding family
    // renders groom/bride in {{2}}/{{3}} (docs/whatsapp-templates-meta-submission.md).
    const family = template.name.startsWith('kalfa_wedding_') ? 'wedding' : 'generic';
    const built = buildBodyParams({
      paramContract: template.paramContract,
      family,
      ctx: { event: ctx.event, guestFirstName },
    });
    if ('missing' in built) {
      // Fail-closed: never send a template with an empty positional parameter.
      // Recorded like the other integrity failures (missing-key list is
      // event-level data, not PII — guest name never blocks).
      await recordTemplateFailure(admin, campaignId, stepIndex, 'params_incomplete', tp.message_key, tp.channel);
      return { action: 'skipped' };
    }
    // Media invite: swap to the IMAGE-header sibling when the row maps one
    // AND the event has an uploaded invitation image (fail-open to text).
    const media = await resolveTemplateMedia(template, ctx.inviteImagePath);
    const outcome = await sendOneWhatsApp(
      admin,
      { id: campaignId, event_id: eventId },
      { id: contactId, normalized_phone: contact.normalized_phone },
      media.template,
      config,
      tp.message_key,
      built.params,
      media.headerImage ? { headerImage: media.headerImage } : undefined,
    );
    if (outcome.kind !== 'accepted') return { action: 'skipped' };
    await bumpCount(admin, campaignId, contactId, 'whatsapp_sent_count');
    await setContactOpStatus(contactId, 'whatsapp_sent');
    return { action: 'whatsapp_sent' };
  }

  // call — the worker enqueues C2's per-contact dial.
  await bumpCount(admin, campaignId, contactId, 'call_request_count');
  await setContactOpStatus(contactId, 'pending_call');
  return {
    action: 'call_request',
    callRequest: {
      campaignId,
      eventId,
      contactId,
      normalizedPhone: contact.normalized_phone,
      scriptKey: tp.message_key,
      touchpointIndex: stepIndex,
    },
  };
}

// The SHARED reach path (both channels). Records the billed reach through the
// SAME try_record_billed_result RPC (cross-channel dedup) — never a raw insert —
// and on 'billed' stops the contact's outreach. Called by the WhatsApp webhook
// and (C2) the call result webhook. Must carry campaignId + attemptId.
export async function writeReach(args: ReachedArgs): Promise<string> {
  const outcome = await recordReached(args);
  if (outcome === 'billed') {
    await setOutreachStatus(args.campaignId, args.contactId, 'reached', 'reached');
  }
  return outcome;
}

// Stop a contact's outreach when reached (the data-side cancel; the worker also
// cancels pending pg-boss jobs, but the execution-time reach check is the
// guarantee). Idempotent.
export async function cancelOutreachForContact(
  campaignId: string,
  contactId: string,
): Promise<void> {
  await setOutreachStatus(campaignId, contactId, 'reached', 'reached');
}

// ─────────────────────────────────────────────────────────────────────────────
// §12 FINAL (M1) SERIAL FLOW — cursor-first reserve → send → resolve.
// The four RPCs below are SECURITY INVOKER / service_role-only (createAdminClient
// runs as service_role). Each returns the RPC's text verdict; a transport error
// surfaces as 'error' (the caller decides — never silently advance). Some SQL
// params are NULLABLE (the CAS uses IS NOT DISTINCT FROM) but supabase codegen
// types them non-null, so we assert `as string` at exactly those call sites —
// this bridges a codegen nullability gap, it does not suppress a real type bug.
// ─────────────────────────────────────────────────────────────────────────────

export async function recordPlan(input: {
  campaignId: string;
  contactId: string;
  expectedStepIndex: number;
  expectedPlanRev: string | null;
  expectedPlannedAt: string | null;
  nextPlanRev: string;
  nextPlannedAtIso: string;
}): Promise<'recorded' | 'stale' | 'missing' | 'error'> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('record_step_plan', {
    p_campaign: input.campaignId,
    p_contact: input.contactId,
    p_expected_step: input.expectedStepIndex,
    p_expected_plan_rev: input.expectedPlanRev as string,
    p_expected_planned_at: input.expectedPlannedAt as string,
    p_next_plan_rev: input.nextPlanRev,
    p_next_planned_at: input.nextPlannedAtIso,
  });
  if (error) return 'error';
  return (data as 'recorded' | 'stale' | 'missing') ?? 'error';
}

export async function reserveStep(input: {
  campaignId: string;
  contactId: string;
  stepIndex: number;
  planRev: string;
  plannedAtIso: string;
  jobId: string;
}): Promise<'reserved' | 'stale' | 'error'> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('reserve_outreach_step', {
    p_campaign: input.campaignId,
    p_contact: input.contactId,
    p_step: input.stepIndex,
    p_expected_plan_rev: input.planRev,
    p_expected_planned_at: input.plannedAtIso,
    p_job_id: input.jobId,
  });
  if (error) return 'error';
  return (data as 'reserved' | 'stale') ?? 'error';
}

export async function releaseReservation(input: {
  campaignId: string;
  contactId: string;
  stepIndex: number;
  planRev: string;
  jobId: string;
}): Promise<'released' | 'stale' | 'error'> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('release_outreach_reservation', {
    p_campaign: input.campaignId,
    p_contact: input.contactId,
    p_step: input.stepIndex,
    p_expected_plan_rev: input.planRev,
    p_job_id: input.jobId,
  });
  if (error) return 'error';
  return (data as 'released' | 'stale') ?? 'error';
}

export async function resolveStep(input: {
  campaignId: string;
  contactId: string;
  stepIndex: number;
  planRev: string;
  // null = a NON-reserved skip/terminal (superseded/missed/expired/internal_fault);
  // non-null = a send-path resolve guarded to the reserving job.
  jobId: string | null;
  advance: boolean;
  terminalStatus: string | null;
  reason: string;
  eventId: string;
  auditId: string;
}): Promise<'resolved' | 'stale' | 'error'> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('resolve_outreach_step', {
    p_campaign: input.campaignId,
    p_contact: input.contactId,
    p_step: input.stepIndex,
    p_expected_plan_rev: input.planRev,
    p_job_id: input.jobId as string,
    p_advance: input.advance,
    p_terminal_status: input.terminalStatus as string,
    p_reason: input.reason,
    p_event_id: input.eventId,
    p_audit_id: input.auditId,
  });
  if (error) return 'error';
  return (data as 'resolved' | 'stale') ?? 'error';
}

// The live planning snapshot for one contact — the CAS `expected` inputs + the
// reservation marker. Loaded fresh at each evaluation (never trusted from a job).
export async function loadOutreachRow(
  campaignId: string,
  contactId: string,
): Promise<{
  current_step_index: number;
  status: string;
  plan_rev: string | null;
  planned_at: string | null;
  dispatched_job_id: string | null;
} | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('outreach_state')
    .select('current_step_index, status, plan_rev, planned_at, dispatched_job_id')
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .maybeSingle();
  return data ?? null;
}

// Build + send the WhatsApp/call for the CURSOR step, classified into a
// StepSendResult. It does NOT reserve/advance (the RPCs own that) — it only
// performs the external, non-idempotent side effect and reports the outcome:
//   accepted/definitely_not_sent/unknown — the WhatsApp delivery classification.
//   skip{reason}     — config/template integrity (advance-skip; schedule covers).
//   terminal{reason} — opt-out / no consent (terminalize the contact).
//   advance{reason}  — a call request was dispatched (advance the cursor).
// On accepted it bumps whatsapp_sent_count + op status adjacent to the send (a
// resolve failure after accept ⇒ possible sent-count under-count, never resend).
// The terminal-precheck conditions for one step as a PURE function — the SINGLE
// source of truth shared by prepareAndSendStep (its first gate) and the
// crash-recovery re-check. removal_requested terminates on ANY channel; missing
// WhatsApp consent terminates only a WhatsApp step.
export function terminalReasonFor(
  contact: { removal_requested: boolean | null; whatsapp_consent_at: string | null },
  channel: string,
): string | null {
  if (contact.removal_requested) return 'removal_requested';
  if (channel === 'whatsapp' && !contact.whatsapp_consent_at) return 'no_whatsapp_consent';
  return null;
}

// Read-only terminal re-check for the crash-recovery path (terminal-recovery
// fix): NO send. Lets runStepExecution re-terminalize an opt-out / no-consent
// contact instead of blindly advancing a failed terminalize. null → not terminal
// (a prior real send may have happened → advance once, at-most-once).
export async function checkStepTerminal(
  ctx: CampaignContext,
  contactId: string,
  stepIndex: number,
): Promise<{ reason: string } | null> {
  const tp = ctx.schedule[stepIndex];
  if (!tp) return null;
  const admin = createAdminClient();
  const { data: contact } = await admin
    .from('contacts')
    .select('removal_requested, whatsapp_consent_at')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return null;
  const reason = terminalReasonFor(contact, tp.channel);
  return reason ? { reason } : null;
}

export async function prepareAndSendStep(
  boss: PgBoss,
  ctx: CampaignContext,
  campaignId: string,
  contactId: string,
  eventId: string,
  stepIndex: number,
): Promise<StepSendResult> {
  const tp = ctx.schedule[stepIndex];
  if (!tp) return { kind: 'skip', reason: 'no_touchpoint' };
  const admin = createAdminClient();

  const { data: contact } = await admin
    .from('contacts')
    .select('id, normalized_phone, removal_requested, whatsapp_consent_at')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return { kind: 'skip', reason: 'contact_missing' };
  const terminal = terminalReasonFor(contact, tp.channel);
  if (terminal) return { kind: 'terminal', reason: terminal };

  // P0-1 (A6): a contact PINNED in the authorized set (exposed/billed) but no
  // longer referenced by a live guest keeps its billing legitimacy for a late
  // callback, but must receive NO new outbound touchpoints. Kill-switch gated —
  // inert (no extra query) unless reconciliation is enabled.
  if (isReconcileEnabled()) {
    const { count: liveGuest } = await admin
      .from('guests')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('contact_id', contactId);
    if ((liveGuest ?? 0) === 0) return { kind: 'skip', reason: 'no_live_guest' };
  }

  if (tp.channel === 'whatsapp') {
    const config = await getWhatsAppConfig();
    if (!config) return { kind: 'skip', reason: 'whatsapp_not_configured' };
    const template = await resolveTemplateForEvent(tp.message_key, ctx.event.event_type);
    if (!template) {
      await recordTemplateFailure(admin, campaignId, stepIndex, 'template_missing', tp.message_key, tp.channel);
      return { kind: 'skip', reason: 'template_missing' };
    }
    if (template.channel !== 'whatsapp') {
      await recordTemplateFailure(admin, campaignId, stepIndex, 'channel_mismatch', tp.message_key, tp.channel);
      return { kind: 'skip', reason: 'channel_mismatch' };
    }
    const { data: guest } = await admin
      .from('guests')
      .select('full_name')
      .eq('event_id', eventId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const guestFirstName = deriveGuestFirstName(guest?.full_name);
    const family = template.name.startsWith('kalfa_wedding_') ? 'wedding' : 'generic';
    const built = buildBodyParams({
      paramContract: template.paramContract,
      family,
      ctx: { event: ctx.event, guestFirstName },
    });
    if ('missing' in built) {
      await recordTemplateFailure(admin, campaignId, stepIndex, 'params_incomplete', tp.message_key, tp.channel);
      return { kind: 'skip', reason: 'params_incomplete' };
    }
    const media = await resolveTemplateMedia(template, ctx.inviteImagePath);
    const outcome = await sendOneWhatsApp(
      admin,
      { id: campaignId, event_id: eventId },
      { id: contactId, normalized_phone: contact.normalized_phone },
      media.template,
      config,
      tp.message_key,
      built.params,
      media.headerImage ? { headerImage: media.headerImage } : undefined,
    );
    if (outcome.kind === 'accepted') {
      await bumpCount(admin, campaignId, contactId, 'whatsapp_sent_count');
      await setContactOpStatus(contactId, 'whatsapp_sent');
    }
    return outcome;
  }

  if (tp.channel !== 'call') return { kind: 'skip', reason: 'unknown_channel' };
  if (!ctx.allowed_channels.includes('call')) return { kind: 'skip', reason: 'call_not_allowed' };
  // A call touchpoint is dispatched async (C2 dials; the result arrives by
  // webhook). Enqueue the per-contact dial (deterministic id), count it, advance.
  await boss.send(
    QUEUES.callRequest,
    {
      campaignId,
      eventId,
      contactId,
      normalizedPhone: contact.normalized_phone,
      scriptKey: tp.message_key,
      touchpointIndex: stepIndex,
    },
    { id: detId(campaignId, contactId, 100000 + stepIndex, 'call'), ...CALL_RETRY },
  );
  await bumpCount(admin, campaignId, contactId, 'call_request_count');
  await setContactOpStatus(contactId, 'pending_call');
  return { kind: 'advance', reason: 'call_requested' };
}

// Evaluate the CURSOR step and drive the intent-first plan: record the anchor
// (CAS), then enqueue (send/defer) OR resolve-without-enqueue (skip/terminal),
// walking one step at a time through superseded/missed touchpoints. This is the
// single scheduling entry point for the arm (mode 'plan'), resume (mode 'defer',
// enqueues via deferId to sidestep the completed original detId), and replan
// (mode 'replan'). It NEVER enqueues a step > cursor and NEVER reserves/sends.
export async function ensureCurrentStep(
  boss: PgBoss,
  campaignId: string,
  contactId: string,
  mode: OutreachStepMode,
): Promise<void> {
  const policy = await getSendPolicy();
  const ctx = await getCampaignContext(campaignId);
  if (!ctx || ctx.status !== 'active') return;
  const schedule = ctx.schedule;
  const maxWalk = schedule.length + 1;

  for (let walk = 0; walk < maxWalk; walk++) {
    const row = await loadOutreachRow(campaignId, contactId);
    if (!row || row.status !== 'active') return;
    const cursor = row.current_step_index;
    if (cursor >= schedule.length) {
      await setOutreachStatus(campaignId, contactId, 'exhausted');
      return;
    }
    const nowMs = Date.now();
    // Calendar from now−1d so an overdue same-day slot (evaluated deterministically
    // from its planned instant, which may be earlier today) is covered.
    const cal = buildJewishCalendar(nowMs - DAY_MS, Date.parse(ctx.eventDate) + DAY_MS);
    const tp = schedule[cursor];
    const planRev = stepPlanRev(ctx.eventDate, tp, policy);
    const decision = evaluateStep({
      schedule,
      cursorIndex: cursor,
      eventDateIso: ctx.eventDate,
      nowMs,
      policy,
      calendar: cal,
      campaignId,
      contactId,
    });

    // The anchor's planned_at: the STABLE targetSlotMs for send/defer; the
    // deterministic planned instant for a skip/terminal (cleared on resolve).
    const anchorMs =
      decision.decision === 'send' || decision.decision === 'defer'
        ? decision.targetSlotMs
        : Math.round(plannedSendTime(ctx.eventDate, tp.days_before, policy));
    const anchorIso = new Date(anchorMs).toISOString();

    // CAS the anchor from the row's current values (NULL when fresh) to
    // (planRev, anchorIso). Blocked while a reservation is held → 'stale' → leave
    // the in-flight send alone (this IS the replan-lock-while-reserved rule).
    const rp = await recordPlan({
      campaignId,
      contactId,
      expectedStepIndex: cursor,
      expectedPlanRev: row.plan_rev,
      expectedPlannedAt: row.planned_at,
      nextPlanRev: planRev,
      nextPlannedAtIso: anchorIso,
    });
    if (rp !== 'recorded') return;

    if (decision.decision === 'terminal') {
      await resolveStep({
        campaignId,
        contactId,
        stepIndex: cursor,
        planRev,
        jobId: null,
        advance: false,
        terminalStatus: 'exhausted',
        reason: decision.reason,
        eventId: ctx.event_id,
        auditId: stepAuditId(campaignId, contactId, cursor, planRev, decision.reason),
      });
      return;
    }
    if (decision.decision === 'skip') {
      const res = await resolveStep({
        campaignId,
        contactId,
        stepIndex: cursor,
        planRev,
        jobId: null,
        advance: true,
        terminalStatus: null,
        reason: decision.reason,
        eventId: ctx.event_id,
        auditId: stepAuditId(campaignId, contactId, cursor, planRev, decision.reason),
      });
      if (res !== 'resolved') return;
      continue; // walk to the new cursor
    }

    // send | defer → enqueue (the anchor is already recorded). mode 'defer'
    // (resume) routes even an immediate send through deferId (fresh identity).
    const enqMode: OutreachStepMode =
      decision.decision === 'defer'
        ? 'defer'
        : mode === 'defer'
          ? 'defer'
          : mode === 'replan'
            ? 'replan'
            : 'plan';
    await enqueueStepJob(boss, {
      mode: enqMode,
      campaignId,
      contactId,
      eventId: ctx.event_id,
      stepIndex: cursor,
      planRev,
      targetSlotMs: decision.targetSlotMs,
      runAtMs: decision.decision === 'send' ? decision.at : decision.targetSlotMs,
    });
    return;
  }
}
