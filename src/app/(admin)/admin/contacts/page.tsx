import type { Metadata } from 'next';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { listContactMessages, listInquiryMessages } from '@/lib/data/admin/contacts';
import { contactStatusLabel } from '@/lib/data/admin/labels';
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
import { InquiryThread } from './inquiry-thread';

export const metadata: Metadata = { title: 'פניות' };

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

  // ONE query for the whole page, then grouped in memory — a per-row read would
  // be an N+1 against a table that grows with every reply.
  const thread = await listInquiryMessages(result.items.map((m) => m.id));
  const byInquiry = new Map<string, typeof thread>();
  for (const m of thread) {
    const list = byInquiry.get(m.inquiry_id);
    if (list) list.push(m);
    else byInquiry.set(m.inquiry_id, [m]);
  }

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
                  <Badge>{contactStatusLabel(msg.status)}</Badge>
                  <Badge>{msg.user_id ? 'לקוח רשום' : 'פנייה ציבורית'}</Badge>
                  {msg.topic && <span className="text-sm">{msg.topic}</span>}
                </div>
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {[msg.email, msg.phone].filter(Boolean).join(' · ') || '—'}
                </p>
                {/* The thread renders the question, every reply and any unsent
                    draft in order. The separate `sent_reply` panel that used to
                    sit here is gone: it showed only the LAST reply, and it now
                    duplicates the outbound entry the thread already carries. */}
                <InquiryThread messages={byInquiry.get(msg.id) ?? []} />

                {msg.email ? (
                  <ContactReplyForm
                    id={msg.id}
                    // Compare TIMES, not "was there ever a reply". The old gate
                    // was `replied_at ? undefined : draft_reply`, and once a
                    // thread had been answered `replied_at` stayed set forever —
                    // so a NEW draft written for a reopened thread was saved to
                    // the database and never shown. The drafter would keep
                    // writing into a field nobody could see: the same silent
                    // stall the fleet trigger is written to avoid, one layer on.
                    defaultReply={
                      msg.draft_created_at &&
                      (!msg.replied_at || msg.draft_created_at > msg.replied_at)
                        ? msg.draft_reply
                        : undefined
                    }
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
