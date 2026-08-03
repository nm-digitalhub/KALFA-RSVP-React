'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Switch } from '@/components/ui/switch';

// Unlike admin/analytics/_auto-refresh.tsx (always-on, 60s), this page's
// refresh defaults OFF: each cycle costs two RPCs + up to four sidecar HTTP
// calls, and the DB already runs 25/60 connections in normal operation (see
// plan §8). The admin opts in explicitly, and the interval floor is 30s.
const REFRESH_MS = 30_000;

export function AutoRefreshToggle() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);

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
