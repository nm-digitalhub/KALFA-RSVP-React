'use client';

import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { getT } from '@/lib/i18n';
import { isVersionSkewError } from '@/lib/version-skew';

// Error boundary for every unauthenticated token surface (/r, /g, /ty, /rate,
// /join, /cb) that has no more specific boundary of its own. No session exists
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
  const t = getT('public');
  useVersionSkewReload(error);
  if (isVersionSkewError(error)) {
    return (
      <main className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-xl font-bold">{t('error.updated.title', 'המערכת התעדכנה')}</h1>
        <p className="text-muted-foreground">{t('error.updated.reloading', 'הדף נטען מחדש…')}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-bold">{t('error.generic.title', 'משהו השתבש')}</h1>
      <p className="text-muted-foreground">
        {t('error.generic.body', 'אירעה תקלה בטעינת הדף. אפשר לנסות שוב, ואם הבעיה נמשכת נסו שוב מאוחר יותר.')}
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {t('error.generic.retry', 'נסו שוב')}
      </button>
    </main>
  );
}
