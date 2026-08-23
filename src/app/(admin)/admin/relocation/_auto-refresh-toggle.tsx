'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

import { Switch } from '@/components/ui/switch';

// Same opt-in refresh pattern as admin/debug/_auto-refresh-toggle.tsx (see the
// full rationale there): default OFF, 30s floor, localStorage via
// useSyncExternalStore so SSR/first paint renders the OFF default with no
// hydration mismatch. This page's refresh is cheap (one local file read), but
// a relocation run lasts minutes and is watched occasionally — opt-in fits.
const REFRESH_MS = 30_000;
const STORAGE_KEY = 'kalfa-relocation-auto-refresh';
const CHANGE_EVENT = 'kalfa-relocation-auto-refresh-change';

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
