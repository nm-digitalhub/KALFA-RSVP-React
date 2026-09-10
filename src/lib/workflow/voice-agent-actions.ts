import 'server-only';

import { createHash } from 'node:crypto';

import { dispatchOutreachCall, type CallDispatchResult } from '@/lib/data/outreach-calls';
import { createAdminClient } from '@/lib/supabase/admin';

export type WorkflowRsvpAiCallbackResult = {
  ok: boolean;
  status: string;
  reason?: string;
  attemptId?: string;
  callSessionHistoryId?: number;
};

function deterministicDispatchId(runId: string, nodeId: string): string {
  const digest = createHash('sha256')
    .update('kalfa-workflow:rsvp-ai-callback\0')
    .update(runId)
    .update('\0')
    .update(nodeId)
    .digest();

  // RFC-4122-shaped deterministic UUID. It is an idempotency/correlation key,
  // not a credential. Version/variant bits make it valid for the uuid column.
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function mapDispatchResult(result: CallDispatchResult): WorkflowRsvpAiCallbackResult {
  switch (result.kind) {
    case 'dialed':
      return {
        ok: true,
        status: result.kind,
        attemptId: result.attemptId,
        callSessionHistoryId: result.callSessionHistoryId,
      };
    case 'already_dispatched':
      return { ok: true, status: result.kind, attemptId: result.attemptId };
    case 'already_concluded':
      return { ok: true, status: result.status, attemptId: result.attemptId };
    case 'failed_to_start':
      return {
        ok: false,
        status: result.kind,
        reason: result.code == null ? 'provider_rejected' : `provider_rejected_${result.code}`,
        attemptId: result.attemptId,
      };
    case 'start_unknown':
      return {
        ok: false,
        status: result.kind,
        reason: 'ambiguous_provider_start',
        attemptId: result.attemptId,
      };
    case 'transient_error':
    case 'blocked':
    case 'skipped':
      return { ok: false, status: result.kind, reason: result.reason };
  }
}

export async function dispatchWorkflowRsvpAiCallback(input: {
  runId: string;
  nodeId: string;
  eventId: string;
  contactId: string;
}): Promise<WorkflowRsvpAiCallbackResult> {
  const admin = createAdminClient();
  const dispatchId = deterministicDispatchId(input.runId, input.nodeId);

  // A workflow step may be replayed after a lease reclaim. The dispatch id is
  // stable for that exact (run,node), so an attempt row proves the side effect
  // was already claimed. Never allocate a new manual touchpoint in that case.
  const { data: existing, error: existingError } = await admin
    .from('call_attempts')
    .select('id, status, vox_call_session_history_id')
    .eq('dispatch_id', dispatchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return { ok: false, status: 'blocked', reason: 'attempt_lookup_failed' };
  }
  if (existing) {
    const historyId = existing.vox_call_session_history_id;
    return {
      ok: true,
      status: existing.status ?? 'already_dispatched',
      attemptId: existing.id,
      ...(typeof historyId === 'number' ? { callSessionHistoryId: historyId } : {}),
    };
  }

  // One non-cancelled campaign per event is a repository/database invariant.
  // Resolve it server-side; the diagram never owns or forges a campaign id.
  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id')
    .eq('event_id', input.eventId)
    .neq('status', 'cancelled')
    .maybeSingle();
  if (campaignError) {
    return { ok: false, status: 'blocked', reason: 'campaign_lookup_failed' };
  }
  if (!campaign) {
    return { ok: false, status: 'skipped', reason: 'campaign_not_found' };
  }

  const { data: contact, error: contactError } = await admin
    .from('contacts')
    .select('event_id, normalized_phone')
    .eq('id', input.contactId)
    .maybeSingle();
  if (contactError) {
    return { ok: false, status: 'blocked', reason: 'contact_lookup_failed' };
  }
  if (!contact || contact.event_id !== input.eventId) {
    return { ok: false, status: 'skipped', reason: 'contact_event_mismatch' };
  }
  if (!contact.normalized_phone) {
    return { ok: false, status: 'skipped', reason: 'no_phone_for_contact' };
  }

  const result = await dispatchOutreachCall({
    campaignId: campaign.id,
    eventId: input.eventId,
    contactId: input.contactId,
    normalizedPhone: contact.normalized_phone,
    scriptKey: 'workflow_rsvp_ai_callback',
    // Ignored when isManual=true. The dispatcher atomically allocates the real
    // index through next_manual_touchpoint under a DB advisory lock.
    touchpointIndex: 0,
    isManual: true,
    // This action represents a guest-initiated callback from an inbound
    // workflow. It only exempts the stop-on-reach gate; consent, DNC, dial
    // hours, event state and all other gates remain enforced in the dispatcher.
    isCallback: true,
    dispatchId,
  });

  return mapDispatchResult(result);
}
