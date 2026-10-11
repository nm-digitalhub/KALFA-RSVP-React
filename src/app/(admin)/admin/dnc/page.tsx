import type { Metadata } from 'next';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getRegistryConnectionStatus, listCallDnc } from '@/lib/data/admin/call-dnc';
import { PageHeading, firstParam, parsePageParam } from '../_components';
import { DncClient, type DncTab } from './dnc-client';

export const metadata: Metadata = { title: 'חסימת שיחות (DNC)' };

const TABS: readonly DncTab[] = ['check', 'local', 'status'];

// Admin: Do-Not-Call — checking a number against the national registry, the local list of removal requests, and the
// registry connection (openspec/changes/dnc-registry-dial-gate D9). requirePlatformPermission('manage_voice') is
// enforced in every data-layer function; the call here only redirects early. The local list is governed by the
// is_platform_staff() RLS policy on call_dnc_list. A number on the local list is blocked on EVERY product dial path —
// RSVP calls, sales, meeting confirmation, call-me-now and the console — while the national registry applies to
// marketing calls only.
export default async function AdminDncPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; q?: string | string[]; tab?: string | string[] }>;
}) {
  await requirePlatformPermission('manage_voice');
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const query = firstParam(sp.q);
  const tabParam = firstParam(sp.tab);
  const tab: DncTab = TABS.find((t) => t === tabParam) ?? (query || sp.page ? 'local' : 'check');

  const [list, status] = await Promise.all([listCallDnc({ page, query }), getRegistryConnectionStatus()]);

  return (
    <div className="space-y-6">
      <PageHeading>חסימת שיחות (DNC)</PageHeading>
      <DncClient
        defaultTab={tab}
        entries={list.entries}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        query={query ?? ''}
        status={status}
      />
    </div>
  );
}
