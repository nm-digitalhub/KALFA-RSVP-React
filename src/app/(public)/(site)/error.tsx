'use client';

import { SiteLink as Link } from '@/components/site/site-link';

import { RouteErrorView, routeErrorSecondaryActionClass } from '@/components/route-error-view';
import { useT } from 'next-i18next/client';

// Error boundary for the marketing site (every page under (public)/(site)) —
// overrides the broader (public)/error.tsx for this segment only.
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
  const { t } = useT('public');
  return (
    <RouteErrorView
      error={error}
      retry={retry}
      texts={{
        updatedTitle: t('site.error.updated.title', 'המערכת התעדכנה'),
        reloading: t('site.error.updated.reloading', 'הדף נטען מחדש…'),
        title: t('site.error.generic.title', 'משהו השתבש'),
        body: t('site.error.generic.body', 'אירעה תקלה בטעינת הדף. אפשר לנסות שוב, ואם הבעיה נמשכת נסו שוב מאוחר יותר.'),
        retry: t('site.error.generic.retry', 'נסו שוב'),
      }}
      secondaryAction={
        <Link href="/" className={routeErrorSecondaryActionClass}>
          {t('site.error.generic.home', 'לדף הבית')}
        </Link>
      }
    />
  );
}
