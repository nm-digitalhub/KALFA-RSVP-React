// Pure logic for the `withdraw` verb's ownership check (fleet-agent-cli.ts's
// cmdWithdraw wires this to the actual fleet_requests read). A role may
// withdraw only requests IT filed — the same ownership principle
// publish-social.ts's validatePublishRequestRow enforces for publish_social
// requests, applied here to the narrower withdraw case: role only. Status
// (pending -> expired) is still enforced by cmdWithdraw's own atomic CAS
// UPDATE, not duplicated here.

export type WithdrawRequestRow = { role: string } | null | undefined;

export function validateWithdrawOwnership(row: WithdrawRequestRow, callerRole: string): string | null {
  // A missing row is not an ownership violation — cmdWithdraw's existing
  // pending-status CAS UPDATE already turns "not found" into its usual
  // benign no-op, unchanged by this check.
  if (!row) return null;
  if (row.role !== callerRole) {
    return `request belongs to role "${row.role}", not "${callerRole}" — a role may only withdraw its own requests`;
  }
  return null;
}
