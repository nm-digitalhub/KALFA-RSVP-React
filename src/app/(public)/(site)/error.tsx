'use client';

import Link from 'next/link';

import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { isVersionSkewError } from '@/lib/version-skew';

// Error boundary for the marketing site (home, faq, terms, privacy, contact,
// cookies) — overrides the broader (public)/error.tsx for this segment only.
// Unlike the token routes (/r, /g, /ty…) a site visitor is browsing between
// pages, so a way back to the homepage is worth offering alongside retry.
// Same generic, privacy-safe message and version-skew handling as the other
// boundaries.
export default function SiteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useVersionSkewReload(error);
  if (isVersionSkewError(error)) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-xl font-bold">המערכת התעדכנה</h1>
        <p className="text-muted-foreground">הדף נטען מחדש…</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-bold">משהו השתבש</h1>
      <p className="text-muted-foreground">
        אירעה תקלה בטעינת הדף. אפשר לנסות שוב, ואם הבעיה נמשכת נסו שוב מאוחר יותר.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          נסו שוב
        </button>
        <Link
          href="/"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          לדף הבית
        </Link>
      </div>
    </div>
  );
}
