'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';

export function StatsRefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      className={buttonVariants({ variant: 'outline' })}
      disabled={loading}
      onClick={() => {
        setLoading(true);
        router.refresh();
        setLoading(false);
      }}
    >
      {loading ? 'מרענן…' : 'רענן נתונים'}
    </button>
  );
}
