import type { Metadata } from 'next';
import Link from 'next/link';

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  getContactMessage,
  listContactMessages,
  listInquiryMessages,
  resolveInquiryUrgency,
  type ContactMessage,
} from '@/lib/data/admin/contacts';
import { contactStatusLabel, contactStatusVariant } from '@/lib/data/admin/labels';
import {
  PageHeading,
  EmptyState,
  Pagination,
  Badge,
  formatDateTime,
  parsePageParam,
  firstParam,
} from '../_components';
import { ContactSearchBar } from './contact-search-bar';
import { ContactStatusForm } from './contact-status-form';
import { ContactReplyForm } from './contact-reply-form';
import { InquiryThread } from './inquiry-thread';

export const metadata: Metadata = { title: 'פניות' };

const BASE_PATH = '/admin/contacts';

// The silence-followup cascade's progress (inquiry-followup.ts), derived —
// never stored as its own label. At most one applies at a time since each
// stage's timestamp is only ever set after the previous one's.
function cascadeStageBadge(
  msg: Pick<ContactMessage, 'reminder_sent_at' | 'closing_warning_sent_at' | 'auto_closed_at'>,
) {
  if (msg.auto_closed_at) return { label: 'נסגר אוטומטית', variant: 'neutral' as const };
  if (msg.closing_warning_sent_at) return { label: 'נשלחה אזהרה אחרונה', variant: 'warning' as const };
  if (msg.reminder_sent_at) return { label: 'נשלחה תזכורת', variant: 'info' as const };
  return null;
}

// Admin: contact-form + in-app support submissions, as a responsive
// master-detail inbox. Desktop shows the list and the selected inquiry
// side by side; mobile shows one pane at a time, switched by whether `id` is
// present in the URL — a pure CSS/data-attribute split (no client JS, no
// hydration flicker), the same responsive idiom `sidebar.tsx` already uses
// elsewhere in the admin. Personal data is shown to authorized staff only —
// the layout gate is optimistic; every query re-checks the permission
// server-side.
export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; q?: string | string[]; status?: string | string[]; id?: string | string[] }>;
}) {
  await requirePlatformPermission('view_customer_data');
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const search = firstParam(sp.q);
  const status = firstParam(sp.status);
  const selectedId = firstParam(sp.id);

  const [result, selected] = await Promise.all([
    listContactMessages({ page, search, status }),
    selectedId ? getContactMessage(selectedId) : Promise.resolve(null),
  ]);

  // Urgency is computed for the visible page PLUS the selected inquiry when it
  // isn't on the current page (a filter/page change can move it off-screen
  // while it stays open in the detail pane).
  const urgencyInputs = new Map(result.items.map((m) => [m.id, m]));
  if (selected && !urgencyInputs.has(selected.id)) urgencyInputs.set(selected.id, selected);
  const urgency = await resolveInquiryUrgency([...urgencyInputs.values()]);

  // The thread loads ONLY for the selected inquiry — with a detail pane there
  // is only ever one open at a time, unlike the old flat list that loaded
  // every visible row's thread up front.
  const realThread = selected ? await listInquiryMessages([selected.id]) : [];
  // Every inquiry NOW gets an initial `inbound` thread row on intake — but
  // rows created before that fix (or a rare best-effort insert failure) can
  // still have an empty thread with the original question sitting only in the
  // flat `message` column. Synthesize a single entry from it rather than let
  // the detail pane silently show nothing.
  const thread =
    realThread.length === 0 && selected
      ? [
          {
            id: `${selected.id}-message`,
            inquiry_id: selected.id,
            direction: 'inbound' as const,
            body: selected.message,
            created_at: selected.created_at,
          },
        ]
      : realThread;

  // Split in two: `filterParams` alone goes to <Pagination>, which sets its
  // OWN `page` value from the target page it links to — folding a stale
  // `page` into its queryParams would let that overwrite the real target
  // (URLSearchParams.set is last-write-wins) and break prev/next entirely.
  // `linkParams` is for row/back-link hrefs, which stay on THIS page and so
  // must carry it forward explicitly.
  const filterParams = { q: search, status };
  const linkParams = { ...filterParams, page: page > 1 ? String(page) : undefined };
  const hrefWith = (overrides: Record<string, string | undefined>): string => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...linkParams, ...overrides })) {
      if (v) qs.set(k, v);
    }
    const s = qs.toString();
    return s ? `${BASE_PATH}?${s}` : BASE_PATH;
  };

  return (
    <div className="space-y-4">
      <PageHeading>פניות</PageHeading>
      <ContactSearchBar basePath={BASE_PATH} search={search} status={status} />

      {result.items.length === 0 ? (
        <EmptyState>
          {search || status ? 'לא נמצאו פניות התואמות את החיפוש.' : 'אין פניות עדיין.'}
        </EmptyState>
      ) : (
        <div
          className="group/contacts flex flex-col gap-4 md:flex-row md:items-start"
          data-has-selection={Boolean(selected)}
        >
          <ul
            className="group-data-[has-selection=true]/contacts:max-md:hidden w-full shrink-0 divide-y divide-border rounded-lg border border-border md:w-[360px]"
          >
            {result.items.map((msg) => (
              <li key={msg.id}>
                <Link
                  href={hrefWith({ id: msg.id })}
                  aria-current={selected?.id === msg.id ? 'true' : undefined}
                  className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted aria-[current=true]:bg-muted"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{msg.name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(msg.last_activity_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={contactStatusVariant(msg.status)}>
                      {contactStatusLabel(msg.status)}
                    </Badge>
                    {(() => {
                      const stage = cascadeStageBadge(msg);
                      if (!stage) return null;
                      return <Badge variant={stage.variant}>{stage.label}</Badge>;
                    })()}
                    {msg.topic && (
                      <span className="truncate text-xs text-muted-foreground">{msg.topic}</span>
                    )}
                    {(() => {
                      const u = urgency.get(msg.id);
                      if (!u) return null;
                      return (
                        <Badge variant={u.daysToEvent <= 7 ? 'destructive' : 'neutral'}>
                          {u.eventName} · בעוד {u.daysToEvent} ימים
                        </Badge>
                      );
                    })()}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div
            className="group-data-[has-selection=false]/contacts:max-md:hidden min-w-0 flex-1 rounded-lg border border-border"
          >
            {selected ? (
              <ContactDetail
                message={selected}
                thread={thread}
                urgency={urgency.get(selected.id)}
                backHref={hrefWith({ id: undefined })}
              />
            ) : (
              <div className="hidden h-full items-center justify-center p-10 text-center text-muted-foreground md:flex">
                בחרו פנייה מהרשימה כדי לצפות בפרטים
              </div>
            )}
          </div>
        </div>
      )}

      <Pagination basePath={BASE_PATH} page={result.page} pageSize={result.pageSize} total={result.total} queryParams={filterParams} />
    </div>
  );
}

function ContactDetail({
  message: msg,
  thread,
  urgency,
  backHref,
}: {
  message: ContactMessage;
  thread: Awaited<ReturnType<typeof listInquiryMessages>>;
  urgency: { daysToEvent: number; eventName: string } | undefined;
  backHref: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 space-y-3 border-b border-border bg-background p-4">
        <Link
          href={backHref}
          className="text-sm text-muted-foreground hover:underline md:hidden"
        >
          ← חזרה לרשימה
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{msg.name}</p>
              <Badge variant={contactStatusVariant(msg.status)}>
                {contactStatusLabel(msg.status)}
              </Badge>
              {(() => {
                const stage = cascadeStageBadge(msg);
                return stage ? <Badge variant={stage.variant}>{stage.label}</Badge> : null;
              })()}
              <Badge>{msg.user_id ? 'לקוח רשום' : 'פנייה ציבורית'}</Badge>
              {urgency && (
                <Badge variant={urgency.daysToEvent <= 7 ? 'destructive' : 'neutral'}>
                  {urgency.eventName} · בעוד {urgency.daysToEvent} ימים
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground" dir="ltr">
              {[msg.email, msg.phone].filter(Boolean).join(' · ') || '—'}
            </p>
            {msg.topic && <p className="text-sm text-muted-foreground">{msg.topic}</p>}
          </div>
          <ContactStatusForm id={msg.id} currentStatus={msg.status} />
        </div>
      </div>

      <div className="flex-1 space-y-3 p-4">
        <InquiryThread messages={thread} />

        {msg.status === 'cancelled' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">הפנייה בוטלה — לא ניתן לשלוח מענה.</p>
            {msg.draft_reply && (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  טיוטת מענה (סוכן) — נשארה ללא שליחה
                </p>
                <p className="whitespace-pre-wrap text-sm">{msg.draft_reply}</p>
              </div>
            )}
          </div>
        ) : msg.email ? (
          <ContactReplyForm
            key={msg.id}
            id={msg.id}
            // Compare TIMES, not "was there ever a reply". The old gate was
            // `replied_at ? undefined : draft_reply`, and once a thread had
            // been answered `replied_at` stayed set forever — so a NEW draft
            // written for a reopened thread was saved to the database and
            // never shown.
            defaultReply={
              msg.draft_created_at && (!msg.replied_at || msg.draft_created_at > msg.replied_at)
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
          {msg.handled_at
            ? ` · ${msg.auto_closed_at ? 'נסגר אוטומטית' : 'טופל'}: ${formatDateTime(msg.handled_at)}`
            : ''}
        </p>
      </div>
    </div>
  );
}
