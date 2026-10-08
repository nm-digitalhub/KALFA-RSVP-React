'use client';

import { useEffect, useRef, useState } from 'react';

// Time left until `expiresAt`, ticking every second.
//
// The first render (server AND browser) is computed from the server's own clock (`serverNow`), so the markup is
// identical and hydration is clean. Once mounted, the hook measures how far this device's clock is from the server's
// and corrects every later tick by that difference, so a laptop that is five minutes off still shows the real time
// left. It is only a display: the database decides when access ends, never this number.

export function useCountdown(expiresAtIso: string, serverNowIso: string): number {
  const expiresAt = Date.parse(expiresAtIso);
  const [nowMs, setNowMs] = useState(() => Date.parse(serverNowIso));
  const offsetRef = useRef(0);

  useEffect(() => {
    offsetRef.current = Date.parse(serverNowIso) - Date.now();
    const timer = setInterval(() => setNowMs(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(timer);
  }, [serverNowIso]);

  return Math.max(0, expiresAt - nowMs);
}
