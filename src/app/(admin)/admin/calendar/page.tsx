import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarX2 } from 'lucide-react';

import { getMyActiveExchangeConnection } from '@/lib/data/exchange-connections';
import { PageHeading } from '../_components';
import { AdminExchangeCalendar } from './calendar-client';

export const metadata: Metadata = { title: 'יומן Exchange' };

// Admin-only Exchange calendar (owner ruling 27.07: business-management
// feature, never customer-facing). Authorization is enforced in the data
// layer — every DAL call requires requirePlatformPermission('manage_settings')
// — on top of the /admin layout's admin gate.
export default async function AdminCalendarPage() {
  const connection = await getMyActiveExchangeConnection();

  return (
    <div className="space-y-6">
      <PageHeading>יומן Exchange</PageHeading>

      {connection ? (
        <AdminExchangeCalendar
          connectionId={connection.id}
          mailboxEmail={connection.mailboxEmail}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
          <CalendarX2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">אין חיבור Exchange מאומת</p>
          <p className="max-w-md text-sm text-muted-foreground">
            כדי להציג את היומן יש לחבר את תיבת ה-Exchange של העסק ולאמת את
            החיבור (״בדיקת חיבור״) במסך ההגדרות.
          </p>
          <Link
            href="/admin/settings"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            לחיבור Exchange בהגדרות
          </Link>
        </div>
      )}
    </div>
  );
}
