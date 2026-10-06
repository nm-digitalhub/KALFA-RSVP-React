'use client';

import { useEffect } from 'react';
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
//
// The previous location lives at module scope, not in a ref: moving between
// route groups (marketing site → /app) remounts GoogleAnalyticsGated, and a
// ref would reset to null — the first /app view would then re-send the
// original external document.referrer instead of the page the user came from.
// Module state survives client navigations and resets on a full page load,
// which is exactly the browser's referrer semantics.
let previousLocation: string | null = null;

export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const search = searchParams.toString();
    const location = normalizeAnalyticsUrl(
      `${window.location.origin}${pathname}${search ? `?${search}` : ''}`,
    );
    // Deduplicate: React strict-mode double-invoke and searchParams object
    // identity changes must not double-count a view of the same URL.
    if (previousLocation === location) return;
    const referrer = previousLocation ?? normalizeAnalyticsUrl(document.referrer);
    previousLocation = location;

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
