'use client';

import { useInterval } from '@mantine/hooks';
import { useRouter } from 'next/navigation';

// Gentle realtime refresh: re-runs the page's server components every 60s,
// only while the tab is visible. Cheap by design — the core batches sit
// behind a 5-minute cache, so each cycle costs at most the realtime fetch
// (45s TTL). If a non-cached section is ever added to the page, this interval
// multiplies its load — revisit then. Renders nothing.
const REFRESH_MS = 60_000;

export function AutoRefresh() {
  const router = useRouter();

  // Starts on mount, stops on unmount; the callback is read fresh on every tick.
  useInterval(
    () => {
      if (document.visibilityState === 'visible') router.refresh();
    },
    REFRESH_MS,
    { autoInvoke: true },
  );

  return null;
}
