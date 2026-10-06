'use client';

import { useLocalStorage } from '@mantine/hooks';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Switch } from '@/components/ui/switch';

// Unlike admin/analytics/_auto-refresh.tsx (always-on, 60s), this page's
// refresh defaults OFF: each cycle costs two RPCs + up to four sidecar HTTP
// calls, and the DB already runs 25/60 connections in normal operation. The
// admin opts in explicitly, and the interval floor is 30s.
const REFRESH_MS = 30_000;
// localStorage, not a cookie/DB setting — this is a per-browser UI
// preference with no server-side meaning. Mantine's useLocalStorage renders the
// OFF default first (on the server and in the first client render, so no
// hydration mismatch) and takes the stored value in an effect right after. It
// also follows the switch across tabs (the `storage` event) and within this tab,
// and a browser with site data blocked falls back to the default.
const STORAGE_KEY = 'kalfa-debug-auto-refresh';

export function AutoRefreshToggle() {
  const router = useRouter();
  const [enabled, setEnabled] = useLocalStorage({ key: STORAGE_KEY, defaultValue: false });

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, router]);

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Switch checked={enabled} onCheckedChange={setEnabled} />
      רענון אוטומטי (30 שנ&apos;)
    </label>
  );
}
