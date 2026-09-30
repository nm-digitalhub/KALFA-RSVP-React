'use client';

import { useLocalStorage } from '@mantine/hooks';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Switch } from '@/components/ui/switch';

// Same opt-in refresh pattern as admin/debug/_auto-refresh-toggle.tsx (see the
// full rationale there): default OFF, 30s floor, localStorage via Mantine's
// useLocalStorage, so SSR/first paint renders the OFF default with no
// hydration mismatch. This page's refresh is cheap (one local file read), but
// a relocation run lasts minutes and is watched occasionally — opt-in fits.
const REFRESH_MS = 30_000;
const STORAGE_KEY = 'kalfa-relocation-auto-refresh';

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
