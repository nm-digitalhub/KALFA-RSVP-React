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
import type { CampaignStatus } from '@/lib/data/campaign-status';

// Admin campaign wind-down surface. The four lifecycle controls (close, pause,
// settle, cancel) are platform-admin-only, so admins need to REACH campaigns of
// events they do NOT own. These readers use the service-role client (bypassing
// RLS) and are ALWAYS gated by requireAdmin() — the same trusted has_role('admin')
// check the customer page and the server actions use. No PII beyond event
// name/date is read.

const ADMIN_EVENT_COLUMNS = 'id, name, status, event_type, event_date, rsvp_deadline';

// Fetch a single event for a platform admin who is NOT the owner, so the
// campaign management page can render for admins. Mirrors requireEventAccess's
// return shape (OwnedEvent) so the page stays field-compatible, but authorizes
// via requireAdmin() instead of can_access_event(). Does NOT weaken the
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

// Fetch ONE campaign for a platform admin who is not the owner.
//
// Without this the admin "manage" button was a dead end: the page already
// branched to getEventForAdminView for the event, but then read the campaign
// through the owner path, whose only SELECT policy on `campaigns` is
// can_access_event(...) -> events.owner_id = auth.uid(). RLS returned zero rows
// for staff and the page rendered notFound() with nothing explaining why.
//
// Fixed the same way the event read is, NOT by adding an admin RLS policy.
// A policy would grant the access silently; Supabase's own guidance is that the
// service-role identifies WHAT is connecting and carries no user identity, so
// the "who looked at this customer's data" answer has to come from the
// application. recordStaffAccess supplies it, fail-closed, BEFORE the read —
// which an RLS grant could never do.
//
// Selects CAMPAIGN_COLUMNS, the same list the owner path uses, so an admin sees
// exactly what the owner sees and the two cannot drift.
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
// Read only is not a limitation to route around: updateThankyouSchedule gates
// on requireOwnedEvent, so a form rendered for a non-owner would be a control
// whose submit is guaranteed to fail. The page decides what to render from
// ownership (viewerOwnsCampaignEvent), not from this reader.
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
// owning event's name/date, and the charge/credit outcome so an admin can see
// the billing state at a glance.
export interface AdminCampaignListItem {
  id: string;
  status: CampaignStatus;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  chargeStatus: string | null;
  finalChargeAmount: number | null;
  creditApplied: number;
  // Hold-tracking (verified gap, 2026-08-30): capture_status was previously
  // invisible on this screen entirely, and a stuck hold (pending/hold_failed/
  // hold_review) never even reaches status='active', so it never appeared in
  // WINDDOWN_STATUSES-filtered results — see the STUCK_CAPTURE_STATUSES query
  // below. captureStatus itself is text, not a typed enum (types.generated.ts
  // reflects capture_status as bare string — no DB enum backs it).
  captureStatus: string | null;
  holdOrderDocumentNumber: number | null;
  holdOrderDocumentUrl: string | null;
}

// Statuses that may still need a wind-down action (close/pause/settle/cancel).
// Terminal states (billed/paid/cancelled) are excluded — nothing left to do.
// Exported so nav-counts.ts can count against the same predicate this list
// already filters by, instead of duplicating the status list.
export const WINDDOWN_STATUSES: readonly CampaignStatus[] = [
  'active',
  'paused',
  'closed',
];

// A campaign whose hold never went through never leaves status='approved'
// (activateCampaign requires capture_status='authorized' — campaigns.ts:889),
// so on its own it would never satisfy WINDDOWN_STATUSES above and would stay
// permanently invisible on this screen. These are exactly the states an admin
// needs to see: a stuck lock (pending, e.g. a crash between the hold request
// and its outcome), a declined hold, or an ambiguous/needs-manual-reconciliation
// outcome. Matches the same three values markCampaignHoldFailed/
// lockCampaignForHold already use (campaigns.ts / authorize/route.ts).
const STUCK_CAPTURE_STATUSES = ['pending', 'hold_failed', 'hold_review'] as const;

// List campaigns that may need admin attention — either a wind-down action
// (close/pause/settle/cancel) or a stuck hold that never activated. Reads via
// the service-role client (camp_admin_all RLS also covers this) under
// requireAdmin(). Returns only what the list needs — charge/hold OUTCOME
// fields, never card/token fields.
export async function listCampaignsForAdmin(): Promise<AdminCampaignListItem[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select(
      'id, status, event_id, created_at, charge_status, final_charge_amount, credit_applied, capture_status, hold_order_document_number, hold_order_document_url, events(name, event_date)',
    )
    .or(
      `status.in.(${WINDDOWN_STATUSES.join(',')}),and(status.eq.approved,capture_status.in.(${STUCK_CAPTURE_STATUSES.join(',')}))`,
    )
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
    creditApplied: Number(c.credit_applied ?? 0),
    captureStatus: c.capture_status,
    holdOrderDocumentNumber: c.hold_order_document_number,
    holdOrderDocumentUrl: c.hold_order_document_url,
  }));
}
