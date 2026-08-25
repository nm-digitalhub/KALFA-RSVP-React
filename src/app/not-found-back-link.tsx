'use client';

import { useRouter } from 'next/navigation';

// A "back" action needs client-side navigation state, which only a Client
// Component can touch — kept as a tiny leaf so not-found.tsx stays a Server
// Component otherwise. router.back() (next/navigation's useRouter, not raw
// window.history.back()) per the installed docs' use-router.md: it goes
// through the App Router's own history stack instead of the bare browser API.
export function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
    >
      חזרה לעמוד הקודם
    </button>
  );
}
