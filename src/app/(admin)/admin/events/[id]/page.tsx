import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import type { LucideIcon } from 'lucide-react';
import { Bot, CreditCard, ScrollText, UserSearch, Users, Voicemail } from 'lucide-react';

import { hasPlatformPermission, requirePlatformPermission } from '@/lib/auth/dal';
import { getEventForStaffView } from '@/lib/data/admin/event-view';
import { formatIsraelDate } from '@/lib/date';
import { Badge, EmptyState, PageHeading } from '../../_components';

// THE STAFF ADDRESS FOR ONE CUSTOMER EVENT.
//
// Every staff surface that deals with an event already existed — the campaign
// board, /admin/voice/events/{id}, /admin/support, /admin/users/{id},
// /admin/activity — but there was no address that IS the event, so nothing
// could link to one. The business mailbox's calendar entries linked to
// /app/events/{id}, which authorizes on ownership alone and 404s for staff.
// This page is that address; event-exchange-sync now points the calendar here.
//
// PERMISSION SEPARATION IS THE POINT OF THIS FILE (owner, 2026-09-07:
// "אתה חייב להפריד בין ההרשאות"). Two rules hold it:
//   1. The page itself requires ONLY 'view_events' — the identity of the event
//      and nothing else. Everything richer lives behind its own key.
//   2. A section whose key the viewer lacks is ABSENT, never a redirect and
//      never a disabled control. Each check uses hasPlatformPermission (which
//      returns false) rather than requirePlatformPermission (which redirects) —
//      otherwise a manage_voice-only viewer would be bounced off a page they
//      are entitled to see.
//
// Nothing customer-identifying is rendered inline: no owner contact details, no
// celebrant names, no guest rows, no figures. Those keep their own gated
// surfaces, which the links below hand off to — including the reason prompt
// /admin/support imposes for guest data.

const getEventCached = cache(getEventForStaffView);

// Dynamic title so a tab says WHICH event. getEventForStaffView calls
// notFound() on a missing event, which Next allows inside generateMetadata.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await getEventCached(id);
  return { title: event.name ? `אירוע — ${event.name}` : 'אירוע' };
}

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

interface StaffLink {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export default async function AdminEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Optimistic gate; the real enforcement is inside getEventForStaffView.
  await requirePlatformPermission('view_events');
  const { id } = await params;
  const event = await getEventCached(id);

  const [canBilling, canVoice, canCustomerData, canStaff, canActivity, canRecordings] =
    await Promise.all([
      hasPlatformPermission('manage_billing'),
      hasPlatformPermission('manage_voice'),
      hasPlatformPermission('view_customer_data'),
      hasPlatformPermission('manage_staff'),
      hasPlatformPermission('view_activity_log'),
      hasPlatformPermission('view_recordings'),
    ]);

  const links: StaffLink[] = [];
  // manage_billing, not view_billing: the campaign board's own reader
  // (getEventForAdminView) demands manage_billing, so a view_billing-only link
  // would land the viewer on a redirect.
  if (canBilling && event.campaignId) {
    links.push({
      href: `/app/events/${event.id}/campaign/${event.campaignId}`,
      label: 'קמפיין וחיוב',
      hint: 'מסירה, תוצאות, חיוב וסגירת הקמפיין',
      icon: CreditCard,
    });
  }
  if (canVoice) {
    links.push({
      href: `/admin/voice/events/${event.id}`,
      label: 'שיחות AI',
      hint: 'ניסיונות חיוג, תוצאות ותמלילים',
      icon: Bot,
    });
  }
  if (canCustomerData) {
    links.push({
      href: '/admin/support',
      label: 'אורחים ופרטי הלקוח',
      hint: 'קריאה בלבד — מחייב לציין סיבה לצפייה',
      icon: UserSearch,
    });
  }
  if (canStaff) {
    links.push({
      href: `/admin/users/${event.ownerId}`,
      label: 'חשבון הלקוח',
      hint: 'פרטי החשבון, זיכויים והשעיה',
      icon: Users,
    });
  }
  if (canActivity) {
    links.push({
      href: `/admin/activity?eventId=${event.id}`,
      label: 'יומן פעילות',
      hint: 'כל הפעולות שבוצעו באירוע הזה',
      icon: ScrollText,
    });
  }
  if (canRecordings) {
    links.push({
      href: '/admin/recordings',
      label: 'הקלטות שיחה',
      hint: 'האזנה להקלטות מוקד השיחות',
      icon: Voicemail,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The event name is customer free text: min-w-0 lets the flex item
            shrink and break-words breaks an unbroken token, so a long name
            wraps instead of pushing the status badge off a phone screen.
            (Badge already carries shrink-0 in its base variant.) */}
        <PageHeading className="min-w-0 break-words">{event.name}</PageHeading>
        <Badge>{event.statusLabel}</Badge>
      </div>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">פרטי האירוע</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">סוג האירוע</dt>
            <dd className="font-medium">{event.eventTypeLabel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">תאריך האירוע</dt>
            <dd className="font-medium">
              {event.eventDate ? formatIsraelDate(event.eventDate) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">מועד אחרון לאישור</dt>
            <dd className="font-medium">
              {event.rsvpDeadline ? formatIsraelDate(event.rsvpDeadline) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">מקום האירוע</dt>
            {/* Also customer free text — a long venue name must wrap inside its
                grid cell, not stretch the column past the viewport. */}
            <dd className="font-medium break-words">{event.venueName ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">המשך טיפול</h2>
        {links.length === 0 ? (
          <EmptyState>
            אין לך הרשאות נוספות לאירוע הזה. פנייה לבעל המערכת תוסיף אותן דרך
            &quot;תפקידי צוות&quot;.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((l) => {
              const Icon = l.icon;
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="flex h-full items-start gap-3 rounded-lg border border-border p-4 transition hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{l.label}</span>
                      <span className="block text-sm text-muted-foreground">{l.hint}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
