import { formatIsraelDateTime } from '@/lib/date';

// Shared, server-rendered presentational helpers for the admin pages. Kept in
// the route group (leading underscore = not a route) so they live next to their
// only consumers.
//
// `Badge` (+ `badgeVariants`/`BadgeVariant`) and `Pagination` were promoted to
// neutral shared locations — `@/components/ui/badge` and `@/components/pagination`
// — so customer/public code can use them without importing across the `(admin)`
// route-group boundary. They are re-exported here so the existing admin
// call-sites (which import them from `../_components`) keep working unchanged.
export { Badge, badgeVariants, type BadgeVariant } from '@/components/ui/badge';
export { Pagination } from '@/components/pagination';

const currencyFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

// Central Israel formatter (he-IL + Asia/Jerusalem + h23) — see src/lib/date.ts.
export function formatDateTime(iso: string): string {
  return formatIsraelDateTime(iso) || iso;
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

// Parse a ?page= search param into a positive integer (default 1).
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value ? Number(value) : 1;
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// Take the first value of a possibly-array search param and trim it,
// returning undefined for empty/whitespace-only input.
export function firstParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() !== '' ? value.trim() : undefined;
}
