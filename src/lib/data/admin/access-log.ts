import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// The single audited-read primitive. Every TARGETED staff read of an identified
// customer subject records one row through here, so a data-subject investigation
// can answer "who looked at my data, when, under what authority, and why".
//
// Design (from the Step-2 audit brief, verified against the live table):
//   * Fail-closed: an unaudited view of one customer's data is worse than a denied
//     one — the whole justification for routing staff through service_role is that
//     the access becomes observable. If the audit insert fails, the read fails.
//   * reason is REQUIRED only for break-glass permissions (reaching outside normal
//     duty into one specific customer). Routine operational targeted reads carry
//     the permission + subject as their justification; forcing a reason on every
//     one produces reason-fatigue that launders the meaning of a real break-glass
//     reason. Enforced here, not in the column.
//   * Never stores the accessed PII itself — only identifiers + metadata. reason is
//     free text and must never be used to stash what was seen.
//
// This is NOT an authorization check — callers still call requirePlatformPermission
// first. This records that an authorized targeted read is about to happen.

export type StaffAccessSubjectType =
  | 'event'
  | 'user'
  | 'guest_list'
  | 'call_attempts'
  | 'campaign';

// Permissions that mean "staff is reaching outside their normal duty into one
// specific customer" — a break-glass reason is mandatory for these.
const BREAK_GLASS_PERMISSIONS = new Set<string>([
  'view_customer_data',
  'manage_staff',
]);

const MIN_REASON_LENGTH = 10;

export interface StaffAccessRecord {
  /** The acting staff member (auth uid). */
  staffId: string;
  /** The permission key that authorized this read (the authority under which it happened). */
  permission: string;
  /** The kind of subject being accessed. */
  subjectType: StaffAccessSubjectType;
  /** The subject's id (event id, user id, …). */
  subjectId: string;
  /** The customer who owns the subject — the join key for "was my account accessed". */
  ownerId: string;
  /** Break-glass reason. Required iff the permission is break-glass. */
  reason?: string;
  /** Convenience: also fill the legacy event_id column when the subject is an event. */
  eventId?: string;
}

export async function recordStaffAccess(rec: StaffAccessRecord): Promise<void> {
  if (!rec.staffId || !rec.ownerId) {
    // Both are the spine of the trail; a row missing either is not an audit row.
    throw new Error('רישום ביקורת חסר מזהה — הגישה בוטלה');
  }

  const needsReason = BREAK_GLASS_PERMISSIONS.has(rec.permission);
  const reason = rec.reason?.trim() ?? '';
  if (needsReason && reason.length < MIN_REASON_LENGTH) {
    throw new Error('נדרש לציין סיבה מפורטת לגישה — הגישה בוטלה');
  }

  const admin = createAdminClient();
  const { error } = await admin.from('support_access_log').insert({
    staff_id: rec.staffId,
    owner_id: rec.ownerId,
    permission: rec.permission,
    subject_type: rec.subjectType,
    subject_id: rec.subjectId,
    event_id: rec.eventId ?? (rec.subjectType === 'event' ? rec.subjectId : null),
    reason: needsReason ? reason : (reason || null),
  });
  if (error) {
    // Fail closed — the read must not proceed unaudited.
    throw new Error('רישום הביקורת נכשל — הגישה בוטלה');
  }
}
