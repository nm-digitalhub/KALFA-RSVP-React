'use client';

import { Cell, Pie, PieChart } from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { toneCssVar } from './_helpers';
import { SegmentLegend, type StackedBarSegment } from './_meters';

// A small donut for a part-to-whole outcome mix (≤6 status-toned segments).
// This is the dataviz skill's one exception to "no donut" — a glance-level
// part-to-whole read, not a precise comparison of close values (the thing
// donuts are actually bad at, per anti-patterns.md). recharts needs
// 'use client'; every count it renders was already fetched server-side and
// arrives as a plain prop — no fetching happens in here.
//
// Colors come from KALFA's own status tokens (`var(--success)` etc, via
// `toneCssVar`) fed through the ChartContainer/ChartConfig pattern in
// `chart.tsx`, so a slice, its Badge, and its legend chip are the exact same
// color in both themes — never a hardcoded hex, and no separate dark-mode
// palette to keep in sync.
export function StatusDonut({
  segments,
  ariaLabel,
  centerLabel,
  centerSubLabel,
  size = 140,
}: {
  segments: StackedBarSegment[];
  ariaLabel: string;
  /** Defaults to the segment total (e.g. total call attempts). */
  centerLabel?: string;
  centerSubLabel?: string;
  size?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const present = segments.filter((s) => s.value > 0);

  // Never a broken empty ring — a muted placeholder that holds the same
  // footprint so the layout doesn't jump once data arrives.
  if (total === 0) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${ariaLabel}: אין נתונים`}
      >
        אין נתונים
      </div>
    );
  }

  const config: ChartConfig = Object.fromEntries(
    present.map((s) => [s.key, { label: s.label, color: toneCssVar(s.tone) }]),
  );
  // The numeric breakdown, spelled out for the aria-label — the legend below
  // repeats it as visible text, so nothing here is reachable only by hover.
  const summary = present.map((s) => `${s.label} ${s.value}`).join(', ');

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${ariaLabel}: ${summary}`}
      >
        <ChartContainer
          config={config}
          className="aspect-square h-full w-full"
          initialDimension={{ width: size, height: size }}
        >
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="key" />} />
            <Pie
              data={present}
              dataKey="value"
              nameKey="key"
              innerRadius="62%"
              outerRadius="90%"
              strokeWidth={2}
              stroke="var(--card)"
            >
              {present.map((s) => (
                <Cell key={s.key} fill={`var(--color-${s.key})`} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        {/* Center label rides over the ring's hole, same technique as
            AnswerRateRing in `_meters.tsx`. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums">{centerLabel ?? total}</span>
          {centerSubLabel ? (
            <span className="text-[10px] text-muted-foreground">{centerSubLabel}</span>
          ) : null}
        </div>
      </div>
      <SegmentLegend segments={segments} />
    </div>
  );
}
