// P0-1 (A6) kill-switch for the authorized-set reconciliation wiring.
//
// When this returns false (the code DEFAULT), every reconcile_authorized_set
// call site — guest add/update/delete, the pruneOrphanContact set-member guard
// — is INERT, so the app behaves exactly as it did before the P0-1
// migrations. The DB billing gate (app_settings.billing_exposure_gate) is a
// SEPARATE, also-default-off toggle.
//
// LIVE STATE (verified 2026-08-30, not just the code default): the env var is
// TRUE in production — owner signed off 2026-07-21. Both bulk-import passes
// (import-actions.ts and whatsapp/actions.ts) call reconcile since 2026-08-30.
// The funded_cap that once bounded the set was retired 2026-09-25 (migration
// 20260925003335), so the hold no longer limits who is admitted. Read per-call
// (not cached) so it can be toggled without a code deploy. Dependency-free leaf
// module so the pg-boss worker can import it without dragging in server-only
// code.
export function isReconcileEnabled(): boolean {
  return process.env.RECONCILE_AUTHORIZED_SET_ENABLED === 'true';
}
