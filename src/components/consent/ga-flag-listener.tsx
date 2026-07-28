'use client';

import { useEffect } from 'react';

import {
  GA_FLAG_COOKIE_NAME,
  parseFlagCookieValue,
} from '@/lib/analytics/ga-event-contracts';
import { sendBusinessEvent } from './send-ga-event';

// Completes the one-shot cookie relay for events that happen inside a Server
// Action ending in redirect() (sign_up, agreement_signed): reads the flag
// cookie on the destination page, DELETES IT FIRST (exactly-once across
// refresh / back-forward cache / a second tab — whoever reads it consumes
// it), validates the value (allowlisted name + UUID-shaped id segments only),
// and queues the event. Renders nothing. Mount once per destination tree.
export function GaFlagListener() {
  useEffect(() => {
    const match = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${GA_FLAG_COOKIE_NAME}=`));
    if (!match) return;
    const value = decodeURIComponent(match.slice(GA_FLAG_COOKIE_NAME.length + 1));
    // Consume before acting — the delete is the exactly-once guarantee.
    document.cookie = `${GA_FLAG_COOKIE_NAME}=; Max-Age=0; path=/; SameSite=Lax`;
    const event = parseFlagCookieValue(value);
    if (!event) return;
    sendBusinessEvent(event);
  }, []);

  return null;
}
