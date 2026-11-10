'use client';

import { RouteErrorView, routeErrorTouchRetryClass } from '@/components/route-error-view';
import { useT } from 'next-i18next/client';

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
  const { t } = useT('public');
  return (
    <RouteErrorView
      error={error}
      retry={retry}
      as="main"
      retryClassName={routeErrorTouchRetryClass}
      texts={{
        updatedTitle: t('error.updated.title', 'המערכת התעדכנה'),
        reloading: t('error.updated.reloading', 'הדף נטען מחדש…'),
        title: t('error.generic.title', 'משהו השתבש'),
        body: t('error.generic.body', 'אירעה תקלה בטעינת הדף. אפשר לנסות שוב, ואם הבעיה נמשכת נסו שוב מאוחר יותר.'),
        retry: t('error.generic.retry', 'נסו שוב'),
      }}
    />
  );
}
