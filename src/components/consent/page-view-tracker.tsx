'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { normalizeAnalyticsPath, normalizeAnalyticsUrl } from '@/lib/analytics/normalize-path';

// Manual page_view sender (plans/ga4-url-normalization.md): the tag is
// configured with send_page_view:false, and the stream's history-based
// enhanced measurement is off — THIS component is the single source of
// page_view events, and every URL field it sends is normalized so internal
// UUIDs never reach GA4. Mounted only inside GoogleAnalyticsGated (i.e. only
// after consent, never on guest token routes). Renders nothing.
//
// page_referrer mirrors browser semantics: document.referrer (normalized) on
// the first view, then the previous page's normalized location on SPA
// navigations.
export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousLocation = useRef<string | null>(null);

  useEffect(() => {
    const search = searchParams.toString();
    const location = normalizeAnalyticsUrl(
      `${window.location.origin}${pathname}${search ? `?${search}` : ''}`,
    );
    // Deduplicate: React strict-mode double-invoke and searchParams object
    // identity changes must not double-count a view of the same URL.
    if (previousLocation.current === location) return;
    const referrer =
      previousLocation.current ?? normalizeAnalyticsUrl(document.referrer);
    previousLocation.current = location;

    type DataLayerWindow = Window & { dataLayer?: unknown[] };
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer || [];
    function gtag(..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    }
    gtag('event', 'page_view', {
      page_title: document.title,
      page_location: location,
      page_path: normalizeAnalyticsPath(pathname),
      page_referrer: referrer,
    });
  }, [pathname, searchParams]);

  return null;
}
