// The hold badge of the admin campaigns list — pure, so the page (a Next.js
// route file, which may export only its own conventions) can import it and a
// test can pin every state.
//
// ⚠️ A HOLD'S REAL STATE IS SPREAD OVER THREE COLUMNS, and reading one of them
// lies. capture_status records how the J5 authorization went and then stays
// 'authorized' for the campaign's whole life; what happened to the money after
// that is written elsewhere:
//   - charge_status = 'charged'          → the hold was CAPTURED (final charge,
//                                           recordCampaignCharge in campaigns.ts);
//   - charge_status = 'nothing_to_charge'→ the campaign closed with ₪0, so the
//                                           hold is only ever RELEASED, never
//                                           captured — until the reconciler sees
//                                           that release, the money may still be
//                                           held on the customer's card;
//   - release_status = 'released'        → SUMIT's holds folder showed the hold
//                                           released (sumit-hold-reconcile.ts).
// Before 2026-09-24 the cell read capture_status alone and said "תפוס" for
// every one of those outcomes — verified live that day: all three "תפוס" rows
// were released in SUMIT.
//
// capture_status is text, not a DB enum (verified 2026-08-30 — types.generated.ts
// reflects it as bare string). hold_review is the most severe: it can mean a
// hold SUMIT confirmed but our own DB failed to persist — an admin needs to see
// this distinctly, not lump it with a routine decline.

export type HoldBadgeVariant = 'success' | 'warning' | 'destructive' | 'neutral';

export interface HoldBadge {
  label: string;
  variant: HoldBadgeVariant;
}

export interface HoldColumns {
  captureStatus: string | null;
  releaseStatus: string | null;
  chargeStatus: string | null;
}

// The authorization itself, before anything happened to the money.
export const CAPTURE_STATUS_LABELS: Record<string, HoldBadge> = {
  pending: { label: 'תפיסה בתהליך', variant: 'warning' },
  authorized: { label: 'תפוס', variant: 'success' },
  hold_failed: { label: 'תפיסה נדחתה', variant: 'destructive' },
  hold_review: { label: 'תפיסה — נדרשת בדיקה ידנית', variant: 'destructive' },
};

// What became of an authorized hold. Order matters and is asserted by the
// tests: a capture beats a release mark (a captured hold has nothing left to
// release), and a release mark beats "closed, awaiting release".
export const HOLD_CHARGED_BADGE: HoldBadge = { label: 'חויב', variant: 'neutral' };
export const HOLD_RELEASED_BADGE: HoldBadge = { label: 'שוחרר', variant: 'neutral' };
// Closed with nothing to charge and the release not yet seen in SUMIT: the
// customer's card may still be blocked, so this is the one authorized state
// that stays warm — it is what an admin must go and release (or backfill).
export const HOLD_AWAITING_RELEASE_BADGE: HoldBadge = {
  label: 'תפוס — ממתין לשחרור',
  variant: 'warning',
};

/** null = no hold at all (the cell renders "—"). */
export function holdBadge(c: HoldColumns): HoldBadge | null {
  if (!c.captureStatus) return null;
  if (c.captureStatus === 'authorized') {
    if (c.chargeStatus === 'charged') return HOLD_CHARGED_BADGE;
    if (c.releaseStatus === 'released') return HOLD_RELEASED_BADGE;
    if (c.chargeStatus === 'nothing_to_charge') return HOLD_AWAITING_RELEASE_BADGE;
    return CAPTURE_STATUS_LABELS.authorized;
  }
  return CAPTURE_STATUS_LABELS[c.captureStatus] ?? { label: c.captureStatus, variant: 'neutral' };
}
