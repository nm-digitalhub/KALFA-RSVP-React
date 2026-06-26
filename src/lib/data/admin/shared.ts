import 'server-only';

import { getAdminPageSize } from '@/lib/constants';

// Shared pagination types and helpers for the admin data layer. Page size comes
// from constants (env-overridable) — never hard-coded per domain.

export interface PageParams {
  page?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Normalise a 1-based page number and compute the inclusive PostgREST range.
// pageSize is resolved here from the single source of truth.
export function resolvePage(page: number | undefined): {
  page: number;
  pageSize: number;
  from: number;
  to: number;
} {
  const pageSize = getAdminPageSize();
  const safePage = Number.isFinite(page) && (page ?? 0) > 0 ? Math.floor(page as number) : 1;
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page: safePage, pageSize, from, to };
}
