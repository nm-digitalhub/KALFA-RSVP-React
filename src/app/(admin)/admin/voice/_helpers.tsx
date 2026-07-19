import type { BadgeVariant } from '@/components/ui/badge';

// Shared presentational maps for the voice-ops dashboard. Per-domain status →
// Badge tone follows the established convention (Record<Enum, BadgeVariant>),
// reusing the semantic tones rather than inline color classes.

// call_attempts.status → Hebrew label.
export const CALL_STATUS_LABELS: Record<string, string> = {
  queued: 'בתור',
  dialing: 'מחייג',
  in_progress: 'בשיחה',
  completed: 'הושלמה',
  no_answer: 'אין מענה',
  no_response: 'ללא תגובה',
  failed: 'נכשלה',
  cancelled: 'בוטלה',
  failed_to_start: 'כשל בהפעלה',
  start_unknown: 'הפעלה לא ודאית',
};

export const CALL_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  completed: 'success',
  no_answer: 'warning',
  no_response: 'warning',
  failed: 'destructive',
  cancelled: 'neutral',
  dialing: 'info',
  in_progress: 'info',
  queued: 'info',
  failed_to_start: 'destructive',
  start_unknown: 'warning',
};

export const callStatusLabel = (s: string): string => CALL_STATUS_LABELS[s] ?? s;
export const callStatusVariant = (s: string): BadgeVariant => CALL_STATUS_VARIANTS[s] ?? 'neutral';

// account-callback wiring state → Hebrew label + tone.
export const WIRING_STATE_LABELS: Record<string, string> = {
  unwired: 'לא מחווט',
  pending: 'ממתין',
  wired: 'מחווט',
  failed: 'נכשל',
  rollback_pending: 'ממתין לביטול',
  rolled_back: 'בוטל',
};
export const WIRING_STATE_VARIANTS: Record<string, BadgeVariant> = {
  unwired: 'neutral',
  pending: 'warning',
  wired: 'success',
  failed: 'destructive',
  rollback_pending: 'warning',
  rolled_back: 'neutral',
};

// A live balance → tone against the two thresholds.
export function balanceVariant(
  balance: number | null,
  minReserve: number,
  lowThreshold: number,
): BadgeVariant {
  if (balance === null) return 'warning';
  if (balance < minReserve) return 'destructive';
  if (balance < lowThreshold) return 'warning';
  return 'success';
}

export function formatBalance(balance: number | null, currency: string | null): string {
  if (balance === null) return '—';
  return `${balance.toFixed(2)} ${currency ?? 'USD'}`;
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
