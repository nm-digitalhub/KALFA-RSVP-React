'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Keeps the page truthful while it waits for something that happens elsewhere (the owner's decision, the end of an
// approved window): re-reads the server data every few seconds while the tab is visible, and once more right after a
// known deadline so a countdown that reaches zero turns into the next state by itself. No state of its own and no
// network call of its own: router.refresh() re-renders the server component, which re-checks the permission.

const DEFAULT_INTERVAL_MS = 10_000;

export function StatusPoller({ deadlineIso, intervalMs = DEFAULT_INTERVAL_MS }: { deadlineIso?: string; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(refreshIfVisible, intervalMs);
    document.addEventListener('visibilitychange', refreshIfVisible);

    let atDeadline: ReturnType<typeof setTimeout> | undefined;
    if (deadlineIso) {
      const wait = Date.parse(deadlineIso) - Date.now() + 1500;
      if (wait > 0) atDeadline = setTimeout(() => router.refresh(), wait);
    }
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      if (atDeadline) clearTimeout(atDeadline);
    };
  }, [router, deadlineIso, intervalMs]);

  return null;
}
