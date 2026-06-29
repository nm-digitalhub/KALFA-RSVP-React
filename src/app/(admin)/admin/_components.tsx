import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Shared, server-rendered presentational helpers for the admin pages. Kept in
// the route group (leading underscore = not a route) so they live next to their
// only consumers. No client interactivity — pagination is plain links so it
// works without JS and is bookmarkable.

const currencyFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFormatter.format(d);
}

export function PageHeading({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold">{children}</h1>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
      {children}
    </div>
  );
}

// Status pill used across lists. `neutral` (default) reproduces the original
// classes exactly so existing call-sites are visually unchanged; the semantic
// variants tint background + text from the status tokens (matching the
// `bg-<token>/10 text-<token>` pattern used by ui/button.tsx's destructive).
const badgeVariants = cva('rounded-full border px-3 py-1 text-xs', {
  variants: {
    variant: {
      neutral: 'border-border text-muted-foreground',
      success: 'border-success/20 bg-success/10 text-success',
      warning: 'border-warning/20 bg-warning/10 text-warning',
      info: 'border-info/20 bg-info/10 text-info',
      destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: {
    variant: 'neutral',
  },
});

export type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>['variant']
>;

export function Badge({
  children,
  variant,
  className,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>{children}</span>
  );
}

// Prev/next pager driven by ?page= in the URL. `total`, `page`, `pageSize`
// come from the server query. Links preserve the base path; first/last pages
// disable the respective control.
function buildPageHref(
  basePath: string,
  page: number,
  queryParams?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  params.set('page', String(page));

  for (const [key, value] of Object.entries(queryParams ?? {})) {
    if (value && value.trim() !== '') {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function Pagination({
  basePath,
  page,
  pageSize,
  total,
  queryParams,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  queryParams?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) {
    return null;
  }

  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const linkClass =
    'rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted';
  const disabledClass =
    'rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground opacity-50';

  return (
    <nav
      className="flex items-center justify-between gap-4 pt-2"
      aria-label="עימוד"
    >
      <span className="text-sm text-muted-foreground">
        עמוד {page} מתוך {totalPages}
      </span>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={buildPageHref(basePath, page - 1, queryParams)}
            className={linkClass}
            rel="prev"
          >
            הקודם
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            הקודם
          </span>
        )}
        {hasNext ? (
          <Link
            href={buildPageHref(basePath, page + 1, queryParams)}
            className={linkClass}
            rel="next"
          >
            הבא
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            הבא
          </span>
        )}
      </div>
    </nav>
  );
}

// Parse a ?page= search param into a positive integer (default 1).
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value ? Number(value) : 1;
  return Number.isInteger(n) && n > 0 ? n : 1;
}
