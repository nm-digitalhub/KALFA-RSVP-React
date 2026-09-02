'use client';

import Script from 'next/script';
import { useCallback, useMemo, useState } from 'react';

// Loads the Google Maps JavaScript API once (next/script dedupes by src) with
// `loading=async` — nothing runs on load; the places library is pulled lazily
// via google.maps.importLibrary('places') by the autocomplete component.
// Installed from the shadcn-google-maps registry (2.9.2026) and adapted:
// Hebrew results + Israel bias by default. The key is a referrer-restricted
// BROWSER key (public by design) read from NEXT_PUBLIC_GOOGLE_MAPS_API_KEY at
// build time; no key → no script, and the component falls back to a plain
// input.
export type UseGooglePlacesScriptOptions = {
  apiKey?: string;
  id?: string;
  language?: string;
  region?: string;
};

export function useGooglePlacesScript({
  apiKey,
  id = 'google-maps-places',
  language = 'he',
  region = 'IL',
}: UseGooglePlacesScriptOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = useMemo(() => {
    if (!resolvedApiKey) {
      return null;
    }
    const params = new URLSearchParams({
      key: resolvedApiKey,
      libraries: 'places',
      loading: 'async',
      language,
      region,
    });
    return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
  }, [language, region, resolvedApiKey]);

  const handleReady = useCallback(() => {
    setIsLoaded(true);
    setError(null);
  }, []);

  const handleError = useCallback(() => {
    setIsLoaded(false);
    setError('Google Maps failed to load');
  }, []);

  const GoogleMapsScript = useMemo(() => {
    if (!src) {
      return null;
    }

    const scriptSrc = src;

    function GoogleMapsScriptComponent() {
      return (
        <Script
          id={id}
          src={scriptSrc}
          strategy="afterInteractive"
          onLoad={handleReady}
          onReady={handleReady}
          onError={handleError}
        />
      );
    }

    return GoogleMapsScriptComponent;
  }, [handleError, handleReady, id, src]);

  return {
    apiKey: resolvedApiKey,
    isLoaded,
    error,
    hasApiKey: Boolean(resolvedApiKey),
    GoogleMapsScript,
  };
}
