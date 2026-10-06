import { Suspense } from 'react';
import type { Metadata } from 'next';

import { Skeleton } from '@/components/ui/skeleton';
import { listFleetConversations } from '@/lib/data/admin/fleet';
import { ConversationList } from './conversation-list';

export const metadata: Metadata = { title: 'פניות סוכנים' };

// /admin/fleet as a messaging app (plans/fleet-messaging-redesign-2026-09-27.md):
// the conversation list lives HERE, the open conversation is the page
// (?role=&focus=). Layouts do not re-render on navigation
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md),
// so switching conversations re-renders only the page — the list is not
// refetched. Mutations revalidate with revalidatePath('/admin/fleet', 'layout').
//
// Authorization: listFleetConversations() → requirePlatformPermission
// ('manage_settings') + RLS. The (admin) layout's staff gate is defense in
// depth, not the boundary.
//
// Height: desktop panes fill the viewport under the admin header
// (--admin-header-h, admin-shell.tsx) minus the content area's py-8, and
// scroll internally.
export default async function FleetLayout({ children }: { children: React.ReactNode }) {
  const { conversations, rolesUnavailable } = await listFleetConversations();
  return (
    <div className="flex flex-col gap-4 md:h-[calc(100dvh-var(--admin-header-h)-4rem)] md:flex-row">
      {/* useSearchParams inside → its own Suspense boundary. */}
      <Suspense fallback={<ListSkeleton />}>
        <ConversationList conversations={conversations} rolesUnavailable={rolesUnavailable} />
      </Suspense>
      <section aria-label="שיחה" className="min-w-0 md:min-h-0 md:flex-1">
        {children}
      </section>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 md:w-80 md:shrink-0" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}
