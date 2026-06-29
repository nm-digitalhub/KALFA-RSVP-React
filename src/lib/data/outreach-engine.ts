import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import { getTemplateByKey } from '@/lib/data/message-templates';
import { sendOneWhatsApp } from '@/lib/data/outreach';
import { recordReached, type ReachedArgs } from '@/lib/data/billing';
import { setContactOpStatus } from '@/lib/data/interactions';
import type { Touchpoint } from '@/lib/outreach/schedule';
import type { OutreachCallRequest } from '@/lib/queue/queues';

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
    .select('event_date')
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
  if (ctx.status !== 'active') return { reason: 'stopped' };
  if (ctx.close_at && nowMs > new Date(ctx.close_at).getTime()) {
    return { reason: 'stopped' };
  }
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
    const template = await getTemplateByKey(tp.message_key);
    if (!config || !template || template.channel !== 'whatsapp') {
      return { action: 'skipped' };
    }
    const ok = await sendOneWhatsApp(
      admin,
      { id: campaignId, event_id: eventId },
      { id: contactId, normalized_phone: contact.normalized_phone },
      template,
      config,
    );
    if (!ok) return { action: 'skipped' };
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
