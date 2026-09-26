'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { buttonVariants } from '@/components/ui/button';

export function StatsRefreshButton() {
  const router = useRouter();
  // router.refresh() returns immediately; the transition stays pending until
  // the refreshed server payload has rendered.
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={buttonVariants({ variant: 'outline' })}
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? 'מרענן…' : 'רענן נתונים'}
    </button>
  );
}
