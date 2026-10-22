'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { subscribePermissionChanges } from '@/lib/realtime/permission-changes';

/**
 * Re-renders the admin area when the signed-in user's permissions change. The admin layout computes the CASL rules,
 * the navigation grants and the softphone gate once, and a layout does not re-render on client navigation
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md). router.refresh() makes a new server request and
 * re-renders the Server Components, the layout included, keeping client state (use-router.md). Server gates do not
 * depend on this: they read the live tables on every request.
 *
 * `renderedAt` is the server render time; it is the Broadcast Replay `since`, so each refresh re-subscribes from the
 * new render (see src/lib/realtime/permission-changes.ts).
 */
export function PermissionChangeListener({ userId, renderedAt }: { userId: string; renderedAt: number }) {
  const router = useRouter();

  useEffect(() => subscribePermissionChanges(userId, renderedAt, () => router.refresh()), [userId, renderedAt, router]);

  return null;
}
