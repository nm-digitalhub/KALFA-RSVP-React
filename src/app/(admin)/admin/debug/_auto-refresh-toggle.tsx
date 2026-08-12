'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

import { Switch } from '@/components/ui/switch';

// Unlike admin/analytics/_auto-refresh.tsx (always-on, 60s), this page's
// refresh defaults OFF: each cycle costs two RPCs + up to four sidecar HTTP
// calls, and the DB already runs 25/60 connections in normal operation (see
// plan §8). The admin opts in explicitly, and the interval floor is 30s.
const REFRESH_MS = 30_000;
// localStorage, not a cookie/DB setting — this is a per-browser UI
// preference with no server-side meaning. Read via useSyncExternalStore
// (not useEffect+setState, which react-hooks/set-state-in-effect correctly
// flags as a cascading-render anti-pattern) so SSR/first paint renders the
// OFF default with no hydration mismatch, and the real persisted value
// takes over in the same commit right after. localStorage's native
// `storage` event only fires in OTHER tabs, so a same-tab custom event
// covers the toggle click itself.
const STORAGE_KEY = 'kalfa-debug-auto-refresh';
const CHANGE_EVENT = 'kalfa-debug-auto-refresh-change';

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function getServerSnapshot() {
  return false;
}

export function AutoRefreshToggle() {
  const router = useRouter();
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const handleCheckedChange = (next: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, router]);

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Switch checked={enabled} onCheckedChange={handleCheckedChange} />
      רענון אוטומטי (30 שנ&apos;)
    </label>
  );
}
