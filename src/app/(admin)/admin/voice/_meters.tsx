import { balanceVariant, formatBalance, toneFillClass, type MeterTone } from './_helpers';

// Small, dependency-free chart marks for the voice-ops dashboard (a balance
// meter, a quota progress bar, an answer-rate ring, and the shared
// part-to-whole legend). Plain SVG/CSS rather than recharts — these are
// static reads of already-fetched data with no interaction beyond a native
// `title`, so a server-rendered mark keeps the bundle smaller than a client
// chart library would (see CLAUDE.md: prefer Server Components; add
// 'use client' only for browser state/effects/APIs, none of which apply
// here). The one mark that DOES need recharts — the outcome-mix donut — is a
// separate client component in `_donut.tsx`, which imports `SegmentLegend`
// and `StackedBarSegment` from here so the legend stays identical either way.
//
// Color follows the established convention: every fill is a `bg-<tone>`
// class from the same status-token set the Badge component uses (see
// `toneFillClass` in `_helpers.tsx`) — never a hardcoded hex — so a state's
// color reads identically as a badge, a table row, or a chart segment.

// A horizontal meter showing a live balance's position against two gates:
// the reserve (below it, calls are blocked) and the low-balance threshold
// (below it, a warning fires). The fill's tone reuses `balanceVariant` — the
// same tone already driving the Badge elsewhere on these pages.
export function BalanceMeter({
  balance,
  currency,
  minReserve,
  lowThreshold,
}: {
  balance: number | null;
  currency: string | null;
  minReserve: number;
  lowThreshold: number;
}) {
  if (balance === null) {
    return (
      <div className="h-2 w-full rounded-full bg-muted" role="img" aria-label="יתרת Voximplant לא זמינה" />
    );
  }

  // Headroom above the highest of {balance, low threshold} so the fill and
  // both threshold ticks stay comfortably inside the track even when the
  // balance sits close to zero or far above the low-balance threshold.
  const domainMax = Math.max(balance, lowThreshold * 2, 1) * 1.15;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / domainMax) * 100));
  const tone = balanceVariant(balance, minReserve, lowThreshold);
  const valueLabel = formatBalance(balance, currency);

  return (
    <div className="space-y-1">
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="יתרת Voximplant"
        aria-valuemin={0}
        aria-valuemax={domainMax}
        aria-valuenow={balance}
        aria-valuetext={valueLabel}
      >
        <div className={`h-full rounded-full ${toneFillClass(tone)}`} style={{ width: `${pct(balance)}%` }} />
        {/* Threshold ticks — logical inset so they stay correct under RTL. */}
        <span
          className="absolute inset-y-0 w-px bg-destructive/70"
          style={{ insetInlineStart: `${pct(minReserve)}%` }}
          aria-hidden
        />
        <span
          className="absolute inset-y-0 w-px bg-warning/70"
          style={{ insetInlineStart: `${pct(lowThreshold)}%` }}
          aria-hidden
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>רזרבה {minReserve}</span>
        <span>סף נמוך {lowThreshold}</span>
      </div>
    </div>
  );
}

// A labeled progress bar for the ElevenLabs character quota. Tone escalates
// as the quota fills — a display-only threshold for the bar's color, not a
// billing rule (ElevenLabs enforces the real cutoff at 100%).
export function QuotaProgressBar({
  count,
  limit,
  tier,
}: {
  count: number | null;
  limit: number | null;
  tier: string | null;
}) {
  if (count === null || limit === null || limit <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        מכסת תווים: {count ?? '—'} / {limit ?? '—'}
        {tier ? ` · תוכנית ${tier}` : ''}
      </p>
    );
  }

  const ratio = Math.min(1, count / limit);
  const pctLabel = `${Math.round(ratio * 100)}%`;
  const tone: MeterTone = ratio >= 0.95 ? 'destructive' : ratio >= 0.8 ? 'warning' : 'success';
  const countLabel = count.toLocaleString('he-IL');
  const limitLabel = limit.toLocaleString('he-IL');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>מכסת תווים{tier ? ` · תוכנית ${tier}` : ''}</span>
        <span className="font-medium text-foreground">
          {countLabel} / {limitLabel} ({pctLabel})
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="מכסת תווים ElevenLabs"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={count}
        aria-valuetext={`${countLabel} מתוך ${limitLabel} (${pctLabel})`}
      >
        <div className={`h-full rounded-full ${toneFillClass(tone)}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

// A compact ring showing the 7-day answer rate as a percentage. No
// good/bad threshold is encoded — the DAL exposes a plain ratio with no
// target defined anywhere, so the fill stays a single neutral (primary) hue,
// the safe sequential default for a bare magnitude (see dataviz skill:
// "sequential is the safe default… unless the job is specifically identity
// or polarity"). `role="img"` names the whole mark; the percentage is also
// rendered as visible text at its center, so nothing is hover-only.
export function AnswerRateRing({ rate, size = 48 }: { rate: number | null; size?: number }) {
  const pct = rate === null ? null : Math.round(rate * 100);
  const circumference = 100; // r chosen so the circle's circumference is 100 units
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={pct === null ? 'אחוז מענה: אין נתונים' : `אחוז מענה: ${pct} אחוז`}
    >
      <svg viewBox="0 0 36 36" className="-rotate-90" style={{ width: size, height: size }} aria-hidden>
        <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3" className="stroke-muted" />
        {pct !== null ? (
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${pct} ${circumference - pct}`}
            className="stroke-primary"
          />
        ) : null}
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums">{pct === null ? '—' : `${pct}%`}</span>
    </span>
  );
}

export interface StackedBarSegment {
  key: string;
  label: string;
  value: number;
  tone: MeterTone;
}

// The tone-chip legend row shared by every part-to-whole mark on this
// dashboard (the donut in `_donut.tsx` included) — a swatch + label + count
// per segment, always rendered as visible text so the breakdown never lives
// only inside a hover tooltip or an aria-label.
export function SegmentLegend({ segments }: { segments: StackedBarSegment[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {segments.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-[2px] ${toneFillClass(s.tone)}`} aria-hidden />
          {s.label} <span className="font-medium text-foreground">{s.value}</span>
        </span>
      ))}
    </div>
  );
}
