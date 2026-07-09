import Link from 'next/link';
import { MailOpen, PhoneCall, Package } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { getDashboardCounts } from '@/lib/data/admin/dashboard';
import { describeActivity, recentActivity } from '@/lib/data/admin/activity';
import { PageHeading, EmptyState, formatDateTime } from './_components';

// Admin dashboard: headline counts (each links to its section) plus the most
// recent activity. All data is fetched server-side under the admin RLS gate.

type Card = {
  href: string;
  label: string;
  icon: LucideIcon;
  value: number;
};

export default async function AdminDashboardPage() {
  const [counts, activity] = await Promise.all([
    getDashboardCounts(),
    recentActivity(5),
  ]);
  const items = activity.map((entry) => describeActivity(entry));

  const cards: Card[] = [
    { href: '/admin/contacts', label: 'פניות', icon: MailOpen, value: counts.contacts },
    { href: '/admin/callbacks', label: 'בקשות חזרה', icon: PhoneCall, value: counts.callbacks },
    { href: '/admin/packages', label: 'חבילות', icon: Package, value: counts.packages },
  ];

  return (
    <div className="space-y-8">
      <PageHeading>סקירה</PageHeading>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(({ href, label, icon: Icon, value }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-muted"
          >
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4" aria-hidden />
              {label}
            </span>
            <span className="text-3xl font-bold">{value}</span>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">פעילות אחרונה</h2>
        {items.length === 0 ? (
          <EmptyState>אין פעילות להצגה עדיין.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {items.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {entry.actionLabel}
                      </span>
                      <span className="text-sm font-medium">{entry.summary}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-md border border-border px-2 py-1">
                        {entry.actorLabel}
                      </span>
                      <span className="rounded-md border border-border px-2 py-1">
                        {entry.targetLabel}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
