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

// Typed as MeterTone (a subset of BadgeVariant) rather than BadgeVariant
// itself, so `callStatusTone` below can hand these values straight to the
// chart-mark helpers with no cast — every value here is also a valid
// BadgeVariant, so `callStatusVariant`'s wider return type still holds.
export const CALL_STATUS_VARIANTS: Record<string, MeterTone> = {
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
// Same lookup, typed for the chart-mark helpers (BalanceMeter/StatusStackedBar)
// which take a MeterTone rather than the full BadgeVariant union.
export const callStatusTone = (s: string): MeterTone => CALL_STATUS_VARIANTS[s] ?? 'neutral';

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

// A live balance → tone against the two thresholds. Typed as MeterTone (a
// subset of BadgeVariant) so callers that feed a chart mark (BalanceMeter)
// need no cast; passing the result to <Badge variant={…}> still type-checks
// since every MeterTone is a valid BadgeVariant.
export function balanceVariant(
  balance: number | null,
  minReserve: number,
  lowThreshold: number,
): MeterTone {
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

// Fill-color classes for chart marks (meters, stacked bars) keyed by the same
// tones used for status Badges, so a state's color is identical whether it
// renders as a badge or as a bar segment. 'neutral' has no dedicated bg-*
// token (the Badge variant only sets a border+text color), so it falls back
// to a translucent step of the muted-foreground ink.
export type MeterTone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral';
const TONE_FILL_CLASS: Record<MeterTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
  neutral: 'bg-muted-foreground/50',
};

export function toneFillClass(tone: MeterTone): string {
  return TONE_FILL_CLASS[tone] ?? TONE_FILL_CLASS.neutral;
}

// Tinted "icon chip" classes (10%-opacity tone background + full-tone icon)
// for stat-tile icons — the same visual language Badge already uses
// (`bg-<tone>/10 text-<tone>`), spelled out as full literal class strings so
// Tailwind's static scan picks them up (a template-interpolated class name
// would not reliably generate).
const TONE_CHIP_CLASS: Record<MeterTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  neutral: 'bg-muted text-muted-foreground',
};

export function toneChipClass(tone: MeterTone): string {
  return TONE_CHIP_CLASS[tone] ?? TONE_CHIP_CLASS.neutral;
}

// Same tones as a literal CSS `var(--token)` reference, for marks that need
// an actual paintable color (recharts `fill`/`stroke`) rather than a Tailwind
// class — the donut chart. Points at KALFA's own semantic tokens (the ones
// `bg-success` etc. already resolve to), so a slice stays the exact same
// color as its Badge/bar in both themes, with no hex duplicated here.
const TONE_CSS_VAR: Record<MeterTone, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  destructive: 'var(--destructive)',
  info: 'var(--info)',
  neutral: 'var(--muted-foreground)',
};

export function toneCssVar(tone: MeterTone): string {
  return TONE_CSS_VAR[tone] ?? TONE_CSS_VAR.neutral;
}
