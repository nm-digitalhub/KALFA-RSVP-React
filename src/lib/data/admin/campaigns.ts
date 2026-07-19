import 'server-only';

import { notFound } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
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
}

// Statuses that may still need a wind-down action (close/pause/settle/cancel).
// Terminal states (billed/paid/cancelled) are excluded — nothing left to do.
const WINDDOWN_STATUSES: readonly CampaignStatus[] = [
  'active',
  'paused',
  'closed',
];

// List campaigns that may need an admin wind-down action, newest first. Reads
// via the service-role client (camp_admin_all RLS also covers this) under
// requireAdmin(). Returns only what the list needs — charge OUTCOME fields
// (status/amount/credit), never card/token fields.
export async function listCampaignsForAdmin(): Promise<AdminCampaignListItem[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select(
      'id, status, event_id, created_at, charge_status, final_charge_amount, credit_applied, events(name, event_date)',
    )
    .in('status', [...WINDDOWN_STATUSES])
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
  }));
}
