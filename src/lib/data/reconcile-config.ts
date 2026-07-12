// P0-1 (A6) kill-switch for the authorized-set reconciliation wiring.
//
// When this returns false (the DEFAULT), every reconcile_authorized_set call
// site — guest add/update/delete, the bulk-import pass, the pruneOrphanContact
// set-member guard, and the outreach send-gate — is INERT, so the app behaves
// exactly as it did before the P0-1 migrations. The DB billing gate
// (app_settings.billing_exposure_gate) is a SEPARATE, also-default-off toggle.
//
// Flip RECONCILE_AUTHORIZED_SET_ENABLED=true only after A-TEST is green, the P1
// cap design is settled, and the owner signs off. Read per-call (not cached) so
// it can be toggled without a code deploy. Dependency-free leaf module so the
// pg-boss worker can import it without dragging in server-only code.
export function isReconcileEnabled(): boolean {
  return process.env.RECONCILE_AUTHORIZED_SET_ENABLED === 'true';
}
