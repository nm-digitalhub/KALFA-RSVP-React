import 'server-only';

import { notFound } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import {
  fetchDeliveryBreakdown,
  type CampaignDeliveryBreakdown,
} from '@/lib/data/campaign-delivery';
import {
  CAMPAIGN_COLUMNS,
  type OwnerCampaign,
  type ThankyouSchedule,
} from '@/lib/data/campaigns';
import type { OwnedEvent } from '@/lib/data/events';
import { loadOperationsOf } from '@/lib/payments/ledger';
import { deriveStatus, ledgerMoney, type LedgerMoney, type PaymentState } from '@/lib/payments/status';
import type { CampaignStatus } from '@/lib/data/campaign-status';
import {
  ADMIN_ATTENTION_FILTER,
  WINDDOWN_STATUSES,
} from '@/lib/owner-agent/cores/campaigns';

// Re-exported for existing importers. The predicate itself lives in the
// request-free campaigns core so the owner agent counts by the same definition.
export { WINDDOWN_STATUSES };

// Admin campaign wind-down surface. The four lifecycle controls (close, pause,
// settle, cancel) are platform-admin-only, so admins need to REACH campaigns of
// events they do NOT own. These readers use the service-role client (bypassing
// RLS) and are ALWAYS gated by requirePlatformPermission('manage_billing') — the
// same permission the customer campaign page branches on. No PII beyond event
// name/date is read.

const ADMIN_EVENT_COLUMNS = 'id, name, status, event_type, event_date, rsvp_deadline';

// Fetch a single event for a platform admin who is NOT the owner, so the
// campaign management page can render for admins. Mirrors requireEventAccess's
// return shape (OwnedEvent) so the page stays field-compatible, but authorizes
// via requirePlatformPermission('manage_billing') instead of can_access_event(). Does NOT weaken the
// owner/org path — the page picks this only for admins.
export async function getEventForAdminView(eventId: string): Promise<OwnedEvent> {
  const staff = await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  // Resolve the owner first, then audit (fail-closed), then read the event — a
  // targeted cross-tenant read of one customer's event must be observable. This is
  // an operational read (manage_billing, staff doing their defined job on this
  // event), so no break-glass reason is required.
  const { data: ownerRow } = await admin
    .from('events')
    .select('owner_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ownerRow) {
    notFound();
  }
  await recordStaffAccess({
    staffId: staff.id,
    permission: 'manage_billing',
    subjectType: 'event',
    subjectId: eventId,
    ownerId: ownerRow.owner_id,
    eventId,
  });

  const { data, error } = await admin
    .from('events')
    .select(ADMIN_EVENT_COLUMNS)
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת האירוע נכשלה');
  }
  if (!data) {
    notFound();
  }
  return data;
}

// Gate + audit for ONE cross-tenant campaign read, resolving the owning event on
// the way through. Every admin campaign reader below starts here, so the
// invariant "permission checked, then audit row written, THEN the customer's
// data is read" holds for each of them individually rather than only for
// whichever one happened to run first.
//
// That does mean a single admin page view writes several audit rows — one per
// targeted read. Deliberate: the alternative is a reader that can be called
// from somewhere else without leaving a trace, and an over-full log is a far
// smaller problem than a silent path.
async function auditedCampaignAccess(
  campaignId: string,
): Promise<{ eventId: string; ownerId: string }> {
  const staff = await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  // Resolve the owning event first: it supplies both the ownerId the audit row
  // needs and the existence check. A campaign whose event vanished is a 404,
  // not a crash.
  const { data: link } = await admin
    .from('campaigns')
    .select('event_id, events!inner(owner_id)')
    .eq('id', campaignId)
    .maybeSingle<{ event_id: string; events: { owner_id: string } }>();
  if (!link) {
    notFound();
  }

  await recordStaffAccess({
    staffId: staff.id,
    permission: 'manage_billing',
    subjectType: 'campaign',
    subjectId: campaignId,
    ownerId: link.events.owner_id,
    eventId: link.event_id,
  });

  return { eventId: link.event_id, ownerId: link.events.owner_id };
}

// Fetch ONE campaign for a platform admin who is not the owner.
//
// The owner path reads the campaign through RLS, whose only SELECT policy on
// `campaigns` is can_access_event(...) -> events.owner_id = auth.uid(). RLS
// returns zero rows for staff, so the page would render notFound() with nothing
// explaining why.
//
// Solved the same way the event read is, NOT by adding an admin RLS policy.
// A policy would grant the access silently; Supabase's own guidance is that the
// service-role identifies WHAT is connecting and carries no user identity, so
// the "who looked at this customer's data" answer has to come from the
// application. recordStaffAccess supplies it, fail-closed, BEFORE the read —
// which an RLS grant could never do.
//
// Selects CAMPAIGN_COLUMNS, the same list the owner path uses, so an admin sees
// exactly what the owner sees and the two cannot drift.
export async function getCampaignForAdminView(campaignId: string): Promise<OwnerCampaign> {
  await auditedCampaignAccess(campaignId);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('id', campaignId)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת הקמפיין נכשלה');
  }
  if (!data) {
    notFound();
  }
  return data as OwnerCampaign;
}

// The delivery/outcome breakdown for a campaign a platform admin does not own.
//
// The other half of the same fix as getCampaignForAdminView. Reaching the page
// was never enough: the owner-path reader resolves the campaign under RLS,
// whose only SELECT policy is can_access_event(...) -> owner_id = auth.uid().
// For staff that returns NO ROW AND NO ERROR, so the reader returned null and
// the page rendered "נתוני המסירה יוצגו לאחר הוספת אנשי קשר" over a customer's
// campaign that had contacts and outreach — beside a billing panel showing that
// same campaign's real numbers, because the billing summary reads through the
// service-role client and worked all along. Two panels, one screen, opposite
// claims.
//
// Same shared fetch the owner path uses, so the two cannot diverge; the only
// difference is which client executes it and that this one is audited first.
export async function getCampaignDeliveryForAdminView(
  campaignId: string,
): Promise<CampaignDeliveryBreakdown> {
  await auditedCampaignAccess(campaignId);
  return fetchDeliveryBreakdown(createAdminClient(), campaignId);
}

// The thank-you schedule for a campaign a platform admin does not own — read
// only. getThankyouSchedule uses the cookie client, so for staff it returned
// null and the panel simply vanished with nothing said.
//
// This reader only reads: the write is updateThankyouSchedule, which authorizes
// the owner OR platform staff holding manage_billing on its own. The page
// decides whether to render the form (canEditThankyou, from the same
// owner-or-staff rule), not this reader.
export async function getThankyouScheduleForAdminView(
  campaignId: string,
): Promise<ThankyouSchedule> {
  await auditedCampaignAccess(campaignId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('thankyou_auto_enabled, thankyou_send_at, thankyou_sent_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת לוח הזמנים לתודה נכשלה');
  }
  if (!data) {
    notFound();
  }
  return {
    // Same fail-open-to-the-default reading as the owner path: an absent column
    // must not read as "disabled".
    autoEnabled: data.thankyou_auto_enabled !== false,
    sendAt: data.thankyou_send_at,
    sentAt: data.thankyou_sent_at,
  };
}

// A campaign row for the admin wind-down list: the campaign, its status, the
// owning event's name/date, and the hold/charge columns its single payment
// status is derived from (campaign-payment-status.ts). Amounts and documents are
// not listed: they are on the campaign page's payments list.
export interface AdminCampaignListItem {
  id: string;
  status: CampaignStatus;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  chargeStatus: string | null;
  finalChargeAmount: number | null;
  // Hold-tracking: a stuck hold (pending/hold_failed/hold_review) never even
  // reaches status='active', so it would never appear in WINDDOWN_STATUSES-
  // filtered results — see ADMIN_ATTENTION_FILTER / STUCK_CAPTURE_STATUSES
  // below. captureStatus itself is text, not a typed enum (types.generated.ts
  // reflects capture_status as bare string — no DB enum backs it).
  captureStatus: string | null;
  // 'released' once the hold-release reconciler (sumit-hold-reconcile.ts)
  // has seen SUMIT mark the hold released. capture_status stays 'authorized'
  // for the campaign's whole life, so without this the screen kept saying
  // "תפוס" for holds SUMIT had long released (verified live 2026-09-24: all
  // three "תפוס" rows were released in SUMIT's holds folder).
  releaseStatus: string | null;
}

// WINDDOWN_STATUSES (wind-down actions: close/pause/settle/cancel) and
// STUCK_CAPTURE_STATUSES (a hold that never went through, so the campaign
// never leaves status='approved') live in the request-free campaigns core
// (src/lib/owner-agent/cores/campaigns.ts), together with
// ADMIN_ATTENTION_FILTER — the exact `or` filter this list uses. The core's
// needsAttention count uses the same string, so the owner agent's number is
// the length of this list by construction. See the core for the reasoning
// behind each status set.

// List campaigns that may need admin attention — either a wind-down action
// (close/pause/settle/cancel) or a stuck hold that never activated. Reads via
// the service-role client under
// requirePlatformPermission('manage_billing'). Returns only what the list needs — charge/hold OUTCOME
// fields, never card/token fields.
export async function listCampaignsForAdmin(): Promise<AdminCampaignListItem[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select(
      'id, status, event_id, created_at, charge_status, final_charge_amount, capture_status, release_status, events(name, event_date)',
    )
    .or(ADMIN_ATTENTION_FILTER)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error('טעינת הקמפיינים נכשלה');
  }
  return (data ?? []).map((c) => ({
    id: c.id,
    status: c.status,
    eventId: c.event_id,
    eventName: c.events?.name ?? '—',
    eventDate: c.events?.event_date ?? null,
    chargeStatus: c.charge_status,
    finalChargeAmount: c.final_charge_amount,
    captureStatus: c.capture_status,
    releaseStatus: c.release_status,
  }));
}

// What the payment ledger says about each listed campaign — its derived state and its paid / refunded sums — read in
// ONE query for the whole list and folded per campaign by each kind's effect. A campaign with no ledger rows has no
// entry. null = the ledger could not be read: the list says so instead of showing every campaign as unpaid.
export async function ledgerForAdmin(
  campaignIds: readonly string[],
): Promise<Map<string, { state: PaymentState; money: LedgerMoney }> | null> {
  await requirePlatformPermission('manage_billing');
  try {
    const rows = await loadOperationsOf(createAdminClient(), campaignIds);
    return new Map([...rows].map(([id, ops]) => [id, { state: deriveStatus(ops), money: ledgerMoney(ops) }]));
  } catch (err) {
    console.error('[admin-campaigns] the payment ledger could not be read', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
