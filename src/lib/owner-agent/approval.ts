// How an owner-agent allow-list row was approved
// (plans/owner-agent-allowlist-override-plan.md; migration
// 20260927003348_owner_agent_allowlist_manual_approval.sql). Pure: shared by the
// route-side gate (intake.ts), the reply consumer and the owner's admin screen.
//
//   verified_staff             — platform staff, row phone = their SMS-verified
//                                phone. The original gate, unchanged.
//   staff_unverified_override  — platform staff whose phone is not verified; the
//                                owner approved the row by hand, with a reason.
//   external_override          — not platform staff; approved by hand, with a
//                                reason. Has no platform permissions, so none of
//                                the count tools is offered (only the free-read
//                                SQL tools every allow-listed phone gets).

export const APPROVAL_KINDS = ['verified_staff', 'staff_unverified_override', 'external_override'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export function isApprovalKind(value: unknown): value is ApprovalKind {
  return typeof value === 'string' && (APPROVAL_KINDS as readonly string[]).includes(value);
}

/** True for the two kinds the owner approved by hand. */
export function isManualApproval(kind: ApprovalKind): boolean {
  return kind !== 'verified_staff';
}

/**
 * The audit reason code recorded when a message gets through thanks to a manual
 * approval (owner requirement: every such pass is logged). null for verified_staff.
 */
export function overrideReasonCode(kind: ApprovalKind): string | null {
  if (kind === 'staff_unverified_override') return 'override_staff_unverified';
  if (kind === 'external_override') return 'override_external';
  return null;
}
