import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getSlackAlertsView, listOpsAlerts } from '@/lib/data/admin/alerts';

import { PageHeading, parsePageParam } from '../../_components';
import { AlertsClient } from './alerts-client';
import { AlertsHistory } from './alerts-history';

export const metadata: Metadata = { title: 'Slack — אינטגרציות' };

// Slack is the operational alerting channel: the connection, who gets @-mentioned,
// which categories fire, and the log of what was actually delivered.
//
// The bot token NEVER reaches the browser — getSlackAlertsView() returns a `hasToken`
// boolean and nothing else, which is why the form renders a placeholder instead of a
// value and why a blank submission means "keep the stored one".
//
// ⚠️ NO SCHEDULED HEALTH CHECK EXISTS HERE, AND THE PAGE SAYS SO. Slack has no cron
// queue — only the manual "send a test" button. The index card carries
// healthCheckAvailable: false for exactly this reason; claiming otherwise printed
// "נבדק לאחרונה: טרם רץ" under a note saying the check is manual, which reads as a
// scheduled job that has never fired. Anything that adds a queue here has to flip
// that flag too, or the two surfaces disagree again.

export default async function SlackIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requirePlatformPermission('manage_settings');

  const page = parsePageParam((await searchParams).page);
  const [view, alerts] = await Promise.all([
    getSlackAlertsView(),
    listOpsAlerts({ page }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/integrations"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden />
          חזרה לאינטגרציות
        </Link>
        <PageHeading>Slack (התראות תפעול)</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          ערוץ ההתראות התפעוליות. אין כאן בדיקה מתוזמנת — האימות היחיד הוא כפתור
          &quot;שלח התראת בדיקה&quot; שלמטה.
        </p>
      </div>

      <AlertsClient view={view} />

      <AlertsHistory alerts={alerts} basePath="/admin/integrations/slack" />
    </div>
  );
}
