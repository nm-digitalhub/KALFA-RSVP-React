'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { TrendPoint } from '@/lib/analytics/ga4-types';

// The page's single recharts mark (house rule: recharts only where a static
// SVG/CSS read won't do). Data arrives fully mapped+gap-filled from the
// server; nothing is fetched here. Colors ride the semantic tokens through
// ChartConfig → var(--color-…) (donut precedent) — never hex.
const config = {
  activeUsers: { label: 'משתמשים פעילים', color: 'var(--primary)' },
  sessions: { label: 'ביקורים', color: 'var(--info)' },
} satisfies ChartConfig;

const HEIGHT = 256;

// Axis ticks: short day.month; tooltip shows the full date.
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}`;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const total = points.reduce((sum, p) => sum + p.activeUsers + p.sessions, 0);
  const summary =
    total === 0
      ? 'אין נתונים בטווח'
      : `סה"כ ${points.reduce((s, p) => s + p.activeUsers, 0)} משתמשים פעילים ו-${points.reduce((s, p) => s + p.sessions, 0)} ביקורים`;

  // A time axis stays left-to-right even in an RTL page (the accepted
  // convention for Hebrew dashboards); labels and tooltips remain Hebrew.
  return (
    <div dir="ltr" role="img" aria-label={`מגמת שימוש: ${summary}`}>
      <ChartContainer
        config={config}
        className="w-full"
        style={{ height: HEIGHT }}
        initialDimension={{ width: 600, height: HEIGHT }}
      >
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            width={32}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <ChartTooltip
            content={<ChartTooltipContent labelFormatter={(v) => String(v)} />}
          />
          <Area
            dataKey="activeUsers"
            type="monotone"
            stroke="var(--color-activeUsers)"
            strokeWidth={2}
            fill="var(--color-activeUsers)"
            fillOpacity={0.12}
            dot={false}
          />
          <Area
            dataKey="sessions"
            type="monotone"
            stroke="var(--color-sessions)"
            strokeWidth={2}
            fill="var(--color-sessions)"
            fillOpacity={0.12}
            dot={false}
          />
          <ChartLegend content={<ChartLegendContent />} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
