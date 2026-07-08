import Link from 'next/link';

// Prev/next pager driven by ?page= in the URL. Promoted out of the admin route
// group's `_components.tsx` so admin, customer and any future list can share it
// without a cross-route-group import. `total`, `page`, `pageSize` come from the
// server query; links preserve the base path and extra query params, and
// first/last pages disable the respective control. Plain <Link>s — works without
// JS and is bookmarkable.

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
    'inline-flex items-center rounded-md border border-border px-3 py-2 text-sm hover:bg-muted';
  const disabledClass =
    'inline-flex items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground opacity-50';

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
