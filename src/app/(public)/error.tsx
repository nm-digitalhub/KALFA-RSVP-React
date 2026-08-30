'use client';

import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { isVersionSkewError } from '@/lib/version-skew';

// Error boundary for every unauthenticated token surface (/r, /g, /ty, /rate,
// /join) that has no more specific boundary of its own. No session exists
// here, so there is nothing to sign back into and nowhere on the site the
// guest was "navigating" from — a single retry action is the whole recovery
// surface. (public)/(site) overrides this with its own error.tsx (site
// visitors DO have a home to return to). Same generic, privacy-safe message
// and version-skew handling as the admin/customer boundaries.
export default function PublicError({
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
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        נסו שוב
      </button>
    </div>
  );
}
