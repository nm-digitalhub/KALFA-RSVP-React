import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Search } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { loadWhatsAppTemplateAdmin } from '@/lib/data/admin/whatsapp-templates';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import { listMessageTemplates } from '@/lib/data/message-templates';
import { formatIsraelDateTime } from '@/lib/date';
import { cn } from '@/lib/utils';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import { EmptyState, firstParam, PageHeading, Pagination, parsePageParam } from '../_components';
import { TemplatesClient } from './templates-client';
import { IssueList, StatusBadge } from './template-admin-parts';
import { EventTypePicker, RouteControl, StepActiveSwitch, SyncButton } from './template-admin-client';
import {
  CATALOG_FILTER_LABELS,
  CATALOG_FILTERS,
  catalog,
  journey,
  pendingReclassification,
  type CatalogFilter,
  type JourneyRow,
} from './view-model';

export const metadata: Metadata = { title: 'תבניות פנייה' };

const PAGE_SIZE = 20;
type EventType = (typeof EVENT_TYPES)[number];

// Admin: which WhatsApp template each step sends and what fills it.
// ?view=catalog lists every template Meta has; the default view is the guest
// journey for one audience (?event=<type>&media=1). Every state shown is
// computed on the server by the sender's own rule (view-model.ts).
export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission('manage_settings');
  const params = await searchParams;
  const view = firstParam(params.view) === 'catalog' ? 'catalog' : 'journey';
  const rawEvent = firstParam(params.event);
  const eventType = (EVENT_TYPES as readonly string[]).includes(rawEvent ?? '') ? (rawEvent as EventType) : null;
  const withImage = firstParam(params.media) === '1';
  const rawFilter = firstParam(params.status);
  const filter: CatalogFilter = (CATALOG_FILTERS as readonly string[]).includes(rawFilter ?? '')
    ? (rawFilter as CatalogFilter)
    : 'all';
  const q = firstParam(params.q) ?? '';
  const page = parsePageParam(params.page);

  const [data, legacy] = await Promise.all([loadWhatsAppTemplateAdmin(), listMessageTemplates()]);
  const otherChannels = legacy.filter((t) => t.channel !== 'whatsapp');

  const tab = (active: boolean) =>
    cn(
      'flex h-10 items-center justify-center rounded-md px-3 text-sm',
      active ? 'bg-primary/10 font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)]' : 'bg-muted text-muted-foreground hover:text-foreground',
    );

  return (
    <div className="space-y-6">
      <PageHeading>תבניות פנייה</PageHeading>

      <section className="space-y-4 rounded-lg border border-border bg-card p-3 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">תבניות WhatsApp</h2>
            <p className="text-sm text-muted-foreground">
              {data.lastSyncedAt ? `סונכרן מול Meta: ${formatIsraelDateTime(data.lastSyncedAt)}` : 'עוד לא סונכרן מול Meta'}
            </p>
          </div>
          <SyncButton />
        </div>

        <nav aria-label="תצוגה" className="grid grid-cols-2 gap-2">
          <Link href="/admin/templates" aria-current={view === 'journey' ? 'page' : undefined} className={tab(view === 'journey')}>
            מסע האורח
          </Link>
          <Link
            href="/admin/templates?view=catalog"
            aria-current={view === 'catalog' ? 'page' : undefined}
            className={tab(view === 'catalog')}
          >
            כל התבניות ({data.templates.length})
          </Link>
        </nav>

        {view === 'journey' ? (
          <JourneyView data={data} stepRows={legacy} eventType={eventType} withImage={withImage} />
        ) : (
          <CatalogView data={data} filter={filter} q={q} page={page} />
        )}
      </section>

      {otherChannels.length > 0 ? (
        <section className="space-y-4 rounded-lg border border-border bg-card p-3 sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">תסריטי שיחה</h2>
            <p className="text-sm text-muted-foreground">נקודות מגע שאינן WhatsApp. נשלחות רק לאחר מילוי תוכן והפעלה.</p>
          </div>
          <TemplatesClient templates={otherChannels} />
        </section>
      ) : null}
    </div>
  );
}

function JourneyView({
  data,
  stepRows,
  eventType,
  withImage,
}: {
  data: Awaited<ReturnType<typeof loadWhatsAppTemplateAdmin>>;
  stepRows: Awaited<ReturnType<typeof listMessageTemplates>>;
  eventType: EventType | null;
  withImage: boolean;
}) {
  const { guest, other } = journey(data, eventType, withImage);
  const blocked = guest.filter((r) => r.outcome.state !== 'sends' && r.outcome.state !== 'inactive');
  const audience = eventType ? EVENT_TYPE_LABELS[eventType] : 'ברירת מחדל';
  const mediaHref = (media: boolean) => {
    const p = new URLSearchParams();
    if (eventType) p.set('event', eventType);
    if (media) p.set('media', '1');
    const s = p.toString();
    return s ? `/admin/templates?${s}` : '/admin/templates';
  };
  const seg = (active: boolean) =>
    cn('flex h-10 items-center justify-center rounded-md px-3 text-sm', active ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">בחרו סוג אירוע, ותראו מה כל אורח מקבל בכל שלב.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <EventTypePicker value={eventType} withImage={withImage} />
        <div role="group" aria-label="תמונת הזמנה" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:w-80">
          <Link href={mediaHref(false)} aria-current={!withImage ? 'true' : undefined} className={seg(!withImage)}>
            ללא תמונת הזמנה
          </Link>
          <Link href={mediaHref(true)} aria-current={withImage ? 'true' : undefined} className={seg(withImage)}>
            עם תמונת הזמנה
          </Link>
        </div>
      </div>

      {blocked.length > 0 ? (
        <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-semibold">
            {blocked.length === 1 ? 'שלב אחד לא נשלח' : `${blocked.length} שלבים לא נשלחים`} ל{audience}
          </p>
          <p className="text-xs leading-5">שלב שהתבנית שלו לא מאושרת או לא מוכנה לא נשלח בכלל — גם לא בברירת המחדל.</p>
        </div>
      ) : null}

      <ol className="flex flex-col gap-3" aria-label="שלבי המסע">
        {guest.map((row, i) => (
          <JourneyStep key={row.step.messageKey} row={row} n={i + 1} stepRows={stepRows} eventType={eventType} withImage={withImage} audience={audience} />
        ))}
      </ol>

      {other.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">מחוץ למסע האורח</h3>
          <ol className="flex flex-col gap-3">
            {other.map((row) => (
              <JourneyStep key={row.step.messageKey} row={row} stepRows={stepRows} eventType={eventType} withImage={withImage} audience={audience} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

const STATE_BORDER: Record<string, string> = {
  sends: 'border-border',
  inactive: 'border-border bg-muted/40',
  blocked: 'border-destructive/40',
  no_route: 'border-destructive/40',
};

function JourneyStep({
  row,
  n,
  stepRows,
  eventType,
  withImage,
  audience,
}: {
  row: JourneyRow;
  n?: number;
  stepRows: Awaited<ReturnType<typeof listMessageTemplates>>;
  eventType: EventType | null;
  withImage: boolean;
  audience: string;
}) {
  const { step, outcome } = row;
  const template = outcome.decision?.template ?? null;
  const routed = outcome.route;
  // The route that belongs to exactly this audience (not a fallback).
  const ownRoute = step.routes.find((r) => r.eventType === eventType && r.withMedia === withImage) ?? null;
  const options = row.eligible.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category }));
  const pending = template ? pendingReclassification(stepRows, template) : null;
  const issues = pending ? [...outcome.issues, pending] : outcome.issues;

  return (
    <li className={cn('flex flex-col gap-3 rounded-lg border p-3', STATE_BORDER[outcome.state])}>
      <div className="flex items-start gap-3">
        {n ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-semibold">
            {n}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-semibold">{step.label}</span>
          {template ? (
            <Link
              href={`/admin/templates/${template.id}`}
              className="flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <span dir="ltr" className="truncate">
                {template.name}
              </span>
              <ChevronLeft className="size-4 shrink-0" aria-hidden />
            </Link>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {template ? <StatusBadge status={template.status} /> : null}
            {routed ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {outcome.source === 'own' ? `של ${audience}` : 'ברירת המחדל של השלב'}
              </span>
            ) : null}
          </div>
        </div>
        <StepActiveSwitch messageKey={step.messageKey} active={step.active} label={step.label} />
      </div>

      {outcome.imageFallback ? (
        <p className="text-xs text-muted-foreground">לשלב הזה אין גרסה עם תמונה — נשלחת הגרסה בלי תמונה.</p>
      ) : null}
      <IssueList issues={issues} />

      <RouteControl
        messageKey={step.messageKey}
        eventType={eventType}
        withMedia={withImage}
        currentTemplateId={ownRoute?.templateId ?? null}
        hasOwnRoute={ownRoute !== null}
        options={options}
        audienceLabel={withImage ? `${audience} עם תמונה` : audience}
      />
    </li>
  );
}

function CatalogView({
  data,
  filter,
  q,
  page,
}: {
  data: Awaited<ReturnType<typeof loadWhatsAppTemplateAdmin>>;
  filter: CatalogFilter;
  q: string;
  page: number;
}) {
  const { rows, total, counts } = catalog(data, { filter, q, page, pageSize: PAGE_SIZE });
  const href = (next: CatalogFilter) => {
    const p = new URLSearchParams({ view: 'catalog' });
    if (next !== 'all') p.set('status', next);
    if (q) p.set('q', q);
    return `/admin/templates?${p.toString()}`;
  };
  return (
    <div className="space-y-4">
      {/* A plain GET form: search works without JavaScript and stays in the URL. */}
      <form action="/admin/templates" className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
        <input type="hidden" name="view" value="catalog" />
        {filter !== 'all' ? <input type="hidden" name="status" value={filter} /> : null}
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="חיפוש לפי שם או נוסח"
          aria-label="חיפוש לפי שם או נוסח"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </form>

      <nav aria-label="סינון לפי מצב" className="flex flex-wrap gap-2">
        {CATALOG_FILTERS.map((f) => (
          <Link
            key={f}
            href={href(f)}
            aria-current={f === filter ? 'true' : undefined}
            className={cn(
              'flex h-10 items-center rounded-full border px-3 text-sm',
              f === filter ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {CATALOG_FILTER_LABELS[f]} ({counts[f]})
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState>אין תבניות שמתאימות לסינון.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ template, uses, issues }) => (
            <li key={template.id}>
              <Link
                href={`/admin/templates/${template.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span dir="ltr" className="truncate text-start font-medium">
                    {template.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {uses.length === 0
                      ? 'לא בשימוש'
                      : uses
                          .map((u) => `${u.label} · ${u.eventType ? EVENT_TYPE_LABELS[u.eventType as EventType] : 'ברירת מחדל'}${u.withMedia ? ', עם תמונה' : ''}`)
                          .join(' | ')}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={template.status} />
                    {issues
                      .filter((i) => !i.code.startsWith('status:'))
                      .map((i) => (
                        <span
                          key={i.code}
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            i.level === 'block' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
                          )}
                        >
                          {i.title}
                        </span>
                      ))}
                  </div>
                </div>
                <ChevronLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        basePath="/admin/templates"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        queryParams={{ view: 'catalog', status: filter === 'all' ? undefined : filter, q: q || undefined }}
      />
    </div>
  );
}
