'use client';

import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { CancellationListSort } from '@/lib/data/event-cancellation';
import { cn } from '@/lib/utils';

// The sort button of the cancellation-requests list: it opens a list of the orders to choose from. Every item is a plain
// link the server reads (?sort=), like the status tabs; this is a client component only because the menu portals
// (same pattern as contacts/contact-search-bar.tsx).
const OPTIONS: ReadonlyArray<{ value: CancellationListSort; label: string; Icon: typeof ArrowUpNarrowWide }> = [
  { value: 'oldest', label: 'הישנות קודם', Icon: ArrowUpNarrowWide },
  { value: 'newest', label: 'החדשות קודם', Icon: ArrowDownWideNarrow },
];

export function SortMenu({ sort, hrefs }: { sort: CancellationListSort; hrefs: Record<CancellationListSort, string> }) {
  const current = OPTIONS.find((o) => o.value === sort) ?? OPTIONS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={`מיון: ${current.label}`}
            className="h-11 shrink-0 gap-1.5 rounded-[10px] bg-card px-3 text-sm font-medium"
          >
            <current.Icon aria-hidden className="size-4" />
            <span className="max-sm:sr-only">{current.label}</span>
            <ChevronDown aria-hidden className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            render={
              <Link
                href={hrefs[o.value]}
                aria-current={o.value === sort ? 'true' : undefined}
                className={cn('min-h-10', o.value === sort && 'font-semibold')}
              >
                <o.Icon aria-hidden className="size-4" />
                <span className="flex-1">{o.label}</span>
                {o.value === sort ? <Check aria-hidden className="size-4" /> : null}
              </Link>
            }
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
