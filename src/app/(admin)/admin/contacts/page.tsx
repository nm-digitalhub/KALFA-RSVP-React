import { listContactMessages } from '@/lib/data/admin/contacts';
import {
  PageHeading,
  EmptyState,
  Pagination,
  formatDateTime,
  parsePageParam,
} from '../_components';

// Admin: contact-form submissions, paginated server-side. Personal data (name,
// email, phone, message) is shown to authorized admins only — the page is
// inside the requireAdmin()-gated admin layout and every query re-checks the
// admin role server-side.

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePageParam((await searchParams).page);
  const result = await listContactMessages({ page });

  return (
    <div className="space-y-6">
      <PageHeading>פניות</PageHeading>

      {result.items.length === 0 ? (
        <EmptyState>אין פניות עדיין.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.items.map((msg) => (
            <li key={msg.id} className="space-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium">{msg.name}</p>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(msg.created_at)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground" dir="ltr">
                {[msg.email, msg.phone].filter(Boolean).join(' · ') || '—'}
              </p>
              <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/contacts"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
