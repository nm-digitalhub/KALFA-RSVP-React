'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { sendBusinessEvent } from '@/components/consent/send-ga-event';

// payment_authorized (phase-1 plan): the card-hold flow is a native form POST
// to a Route Handler that 303-redirects back here with ?held=1. This fires the
// event once and immediately strips the param (router.replace) so refresh /
// back-forward-cache cannot refire — and so the flag never lingers in
// page_location. Deliberately NO value param: a hold ceiling is not a
// transaction value (owner decision pending). NO UUID context params either —
// held per the minimization ruling (27.7 afternoon): no consumer exists.
// Renders nothing.
export function HeldAnalytics() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (searchParams.get('held') !== '1') return;
    fired.current = true;
    sendBusinessEvent({ name: 'payment_authorized' });
    const rest = new URLSearchParams(searchParams);
    rest.delete('held');
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  return null;
}
