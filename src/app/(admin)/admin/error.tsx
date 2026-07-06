'use client';

import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { isVersionSkewError } from '@/lib/version-skew';

// Error boundary for the admin area. Shows a generic, privacy-safe message —
// never the raw error/stack — and offers a retry. A stale-deployment Server
// Action error triggers a one-time reload instead (useVersionSkewReload).
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
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
        onClick={() => unstable_retry()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        נסו שוב
      </button>
    </div>
  );
}
