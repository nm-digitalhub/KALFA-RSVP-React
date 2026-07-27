'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Gentle realtime refresh: re-runs the page's server components every 60s,
// only while the tab is visible. Cheap by design — the core batches sit
// behind a 5-minute cache, so each cycle costs at most the realtime fetch
// (45s TTL). If a non-cached section is ever added to the page, this interval
// multiplies its load — revisit then. Renders nothing.
const REFRESH_MS = 60_000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
