import type { Metadata } from 'next';

import { getSlackAlertsView, listOpsAlerts } from '@/lib/data/admin/alerts';
import { AlertsClient } from '../integrations/slack/alerts-client';
import { AlertsHistory } from '../integrations/slack/alerts-history';
import { PageHeading, parsePageParam } from '../_components';

export const metadata: Metadata = { title: 'התראות תפעול' };

// WHAT IS LEFT OF THIS FILE, AND WHY.
//
// Every control and the alert log itself now live under
// src/app/(admin)/admin/integrations/slack/ and are IMPORTED BACK. Lifted, not
// copied: one definition, two surfaces, so this page and the provider page cannot
// drift while both exist. Task 0.6 retires this page — as its own commit, after a
// clean deploy, which is what keeps Phase 0 reversible by removing a redirect line
// instead of reverting a phase.
//
// requirePlatformPermission('manage_settings') is enforced in the data layer (and
// the /admin layout). The bot token is NEVER passed to the browser —
// getSlackAlertsView() returns only a `hasToken` boolean.
//
// `basePath` differs between the two callers on purpose: pagination links have to
// stay on the page the reader is actually on.

export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePageParam((await searchParams).page);
  const [view, alerts] = await Promise.all([
    getSlackAlertsView(),
    listOpsAlerts({ page }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeading>התראות תפעול (Slack)</PageHeading>

      <AlertsClient view={view} />

      <AlertsHistory alerts={alerts} basePath="/admin/alerts" />
    </div>
  );
}
