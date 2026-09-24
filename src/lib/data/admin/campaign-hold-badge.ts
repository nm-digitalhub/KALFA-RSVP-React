// The hold badge of the admin campaigns list — pure, so the page (a Next.js
// route file, which may export only its own conventions) can import it and a
// test can pin it.
//
// capture_status is text, not a DB enum (verified 2026-08-30 — types.generated.ts
// reflects it as bare string). hold_review is the most severe: it can mean a
// hold SUMIT confirmed but our own DB failed to persist — an admin needs to see
// this distinctly, not lump it with a routine decline.
//
// release_status is the hold-release reconciler's mark (sumit-hold-reconcile.ts):
// 'released' once SUMIT's holds folder showed the hold released. capture_status
// stays 'authorized' for the campaign's whole life, so without it the screen
// kept saying "תפוס" for money that was long released — verified live
// 2026-09-24: every "תפוס" row was released in SUMIT.

export type HoldBadgeVariant = 'success' | 'warning' | 'destructive' | 'neutral';

export interface HoldBadge {
  label: string;
  variant: HoldBadgeVariant;
}

export const CAPTURE_STATUS_LABELS: Record<string, HoldBadge> = {
  pending: { label: 'תפיסה בתהליך', variant: 'warning' },
  authorized: { label: 'תפוס', variant: 'success' },
  hold_failed: { label: 'תפיסה נדחתה', variant: 'destructive' },
  hold_review: { label: 'תפיסה — נדרשת בדיקה ידנית', variant: 'destructive' },
};

export const HOLD_RELEASED_BADGE: HoldBadge = { label: 'שוחרר', variant: 'neutral' };

/** null = no hold at all (the cell renders "—"). */
export function holdBadge(c: {
  captureStatus: string | null;
  releaseStatus: string | null;
}): HoldBadge | null {
  if (!c.captureStatus) return null;
  if (c.captureStatus === 'authorized' && c.releaseStatus === 'released') return HOLD_RELEASED_BADGE;
  return CAPTURE_STATUS_LABELS[c.captureStatus] ?? { label: c.captureStatus, variant: 'neutral' };
}
