import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RANGE_OPTIONS, type AnalyticsRange } from '@/lib/analytics/ga4-types';

// Server-rendered segmented range control: four links driving ?range=, styled
// with the shadcn button variants (URL-driven navigation — deliberately not
// the client-state Tabs primitive). A navigation is a full server re-render;
// the per-range DAL cache makes returning to a loaded range instant.
export function RangePicker({ current }: { current: AnalyticsRange }) {
  return (
    <nav aria-label="טווח זמן" className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
      {RANGE_OPTIONS.map(({ value, label }) => {
        const active = value === current;
        return (
          <Link
            key={value}
            href={{ pathname: '/admin/analytics', query: { range: value } }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: active ? 'default' : 'ghost', size: 'sm' }),
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
