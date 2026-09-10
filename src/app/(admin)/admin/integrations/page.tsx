import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock, Plug } from 'lucide-react';

import { getIntegrationsIndex, type IntegrationCard } from '@/lib/data/admin/integrations';
import { Badge } from '@/components/ui/badge';
import { LocalDateTime } from '@/components/local-date-time';

import { EmptyState, PageHeading } from '../_components';

export const metadata: Metadata = { title: 'אינטגרציות' };

// One card per provider: is it connected, is it switched on, and where do I go to
// change it.
//
// The gate is the STAFF FLOOR (requirePlatformStaff, inside getIntegrationsIndex),
// not manage_settings. The page is navigation plus read-only status; every staff
// member may see where things stand, and each card is opened — or not — by the
// permission its own destination enforces. The reasoning, including the two wrong
// answers it took to get there, is in src/lib/data/admin/integrations/index.ts.
//
// A card the viewer cannot use says so and is NOT a link. Rendering it as a link
// would send them to a page that redirects to /app — ejecting them from the admin
// area entirely — which is precisely the behaviour this consolidation exists to stop.

function StatusBadges({ card }: { card: IntegrationCard }) {
  if (!card.configured) return <Badge variant="neutral">לא מוגדר</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="success">מוגדר</Badge>
      {/* Separate from "מוגדר" on purpose: a provider can be fully set up and
          deliberately switched off. Collapsing the two is what made the panel report
          ExtrA as unconfigured whenever the SMS switch was off. */}
      <Badge variant={card.enabled ? 'success' : 'warning'}>
        {card.enabled ? 'פעיל' : 'כבוי'}
      </Badge>
    </div>
  );
}

function CardBody({ card, showsLastChecked }: { card: IntegrationCard; showsLastChecked: boolean }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">{card.label}</h2>
        <StatusBadges card={card} />
      </div>

      {card.note ? <p className="mt-2 text-xs text-muted-foreground">{card.note}</p> : null}

      {showsLastChecked ? (
        <p className="mt-2 text-xs text-muted-foreground">
          נבדק לאחרונה:{' '}
          {card.lastCheckedAt ? (
            <LocalDateTime iso={card.lastCheckedAt} />
          ) : card.healthCheckAvailable ? (
            '—'
          ) : (
            'אין בדיקת בריאות זמינה'
          )}
        </p>
      ) : null}
    </>
  );
}

export default async function AdminIntegrationsPage() {
  const { cards, canManageSettings, showsLastChecked } = await getIntegrationsIndex();

  return (
    <div className="space-y-6">
      <div>
        <PageHeading>אינטגרציות</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          מצב החיבור של כל הספקים במקום אחד. &quot;מוגדר&quot; אומר שהפרטים קיימים;
          &quot;פעיל/כבוי&quot; הוא המתג של הספק עצמו — אלה שתי שאלות נפרדות.
        </p>
      </div>

      {cards.length === 0 ? (
        <EmptyState>לא נמצאו ספקים להצגה.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) =>
            card.href ? (
              <Link
                key={card.key}
                href={card.href}
                className="block rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <CardBody card={card} showsLastChecked={showsLastChecked} />
              </Link>
            ) : (
              <div
                key={card.key}
                className="rounded-lg border border-dashed border-border bg-muted/30 p-5"
              >
                <CardBody card={card} showsLastChecked={showsLastChecked} />
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden />
                  אין הרשאה — נדרשת {card.permissionLabel}
                </p>
              </div>
            ),
          )}
        </div>
      )}

      {canManageSettings ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold">ניהול ערוצים</h2>
            <p className="text-sm text-muted-foreground">
              המתג הראשי לשליחות וקטלוג הערוצים. הוספת ערוץ חדש אינה עריכת-תצוגה אלא
              שינוי סכמה וקוד — ראו את עמוד הערוצים.
            </p>
          </div>
          <Link
            href="/admin/channels"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plug className="size-4" aria-hidden />
            מעבר לערוצי תקשורת
          </Link>
        </section>
      ) : null}
    </div>
  );
}
