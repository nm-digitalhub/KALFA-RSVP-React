import Link from 'next/link';

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

// Status pill used across lists.
export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
      {children}
    </span>
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
