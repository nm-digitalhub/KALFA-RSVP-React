import { requirePlatformPermission } from '@/lib/auth/dal';
import { listContactMessages } from '@/lib/data/admin/contacts';
import { callbackStatusLabel } from '@/lib/data/admin/labels';
import {
  PageHeading,
  EmptyState,
  Pagination,
  Badge,
  formatDateTime,
  parsePageParam,
} from '../_components';
import { ContactStatusForm } from './contact-status-form';
import { ContactReplyForm } from './contact-reply-form';

// Admin: contact-form + in-app support submissions, paginated server-side.
// Personal data is shown to authorized staff only — the layout gate is
// optimistic; every query re-checks the permission server-side. Each row shows
// source (anonymous/registered), topic, status workflow, the sent reply (once
// answered), and an inline reply composer that pre-fills the support-drafter's
// draft when one exists — a human reviews/edits and sends it (never auto-sent).

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requirePlatformPermission('view_customer_data');
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
            <li
              key={msg.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{msg.name}</p>
                  <Badge>{callbackStatusLabel(msg.status)}</Badge>
                  <Badge>{msg.user_id ? 'לקוח רשום' : 'פנייה ציבורית'}</Badge>
                  {msg.topic && <span className="text-sm">{msg.topic}</span>}
                </div>
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {[msg.email, msg.phone].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="whitespace-pre-wrap text-sm">{msg.message}</p>

                {msg.sent_reply && (
                  <div className="rounded-md border border-success/40 bg-success/10 p-3">
                    <p className="text-xs font-semibold text-success">
                      מענה נשלח ללקוח
                      {msg.replied_at ? ` · ${formatDateTime(msg.replied_at)}` : ''}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{msg.sent_reply}</p>
                  </div>
                )}

                {msg.email ? (
                  <ContactReplyForm
                    id={msg.id}
                    defaultReply={msg.replied_at ? undefined : msg.draft_reply}
                    alreadyReplied={Boolean(msg.replied_at)}
                  />
                ) : (
                  msg.draft_reply && (
                    <div className="rounded-md border border-border bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-muted-foreground">
                        טיוטת מענה (סוכן) — אין אימייל לפנייה, לא ניתן לשלוח
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{msg.draft_reply}</p>
                    </div>
                  )
                )}

                <p className="text-xs text-muted-foreground">
                  {formatDateTime(msg.created_at)}
                  {msg.handled_at ? ` · טופל: ${formatDateTime(msg.handled_at)}` : ''}
                </p>
              </div>
              <ContactStatusForm id={msg.id} currentStatus={msg.status} />
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
