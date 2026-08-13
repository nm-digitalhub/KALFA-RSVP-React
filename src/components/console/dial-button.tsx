'use client';

import { useEffect, useState } from 'react';
import { Loader2, Phone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import type { DialIntentBody } from '@/lib/validation/console-calls';
import { CALL_ACTIVE_STATES, getCallSnapshot, startCall, subscribeCall } from '@/lib/voximplant/web-client';

// Generic outbound-dial control: POST /api/console-calls/dial-intent with
// the server-verified target descriptor ONLY (never a phone number — see
// dial-intent's own route comment on the consent-matrix union), then
// startCall(dial) on the returned one-time token.
//
// Not yet mounted on any page: no existing browser-console surface shows an
// operator a specific {kind:'callback', id} or {kind:'guest_service',
// eventId, contactId} target today — /admin/callbacks/[id] is a deliberate
// tel: mobile-dial flow (its own page comment: "read on a phone... the whole
// point is to tap it and dial"), not the browser softphone. This component
// is ready to drop into whichever page eventually surfaces that target
// (a future callback-queue view keyed to the browser console, plan stages
// 7-9) — see the task report for this note in full.
export function DialButton({
  target,
  label = 'חיוג',
  disabled,
}: {
  target: DialIntentBody;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState(() => CALL_ACTIVE_STATES.includes(getCallSnapshot().state));

  useEffect(
    () => subscribeCall((snap) => setCallBusy(CALL_ACTIVE_STATES.includes(snap.state))),
    [],
  );

  const dial = async () => {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('אין session פעיל — יש להתחבר מחדש למערכת');

      const res = await fetch('/api/console-calls/dial-intent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as
        | { dial?: string; error?: string; reason?: string }
        | null;
      if (!res.ok || !body?.dial) {
        // Generic message + reason code, exactly as dial-intent's route
        // returns it — never invented, never a raw phone/name.
        setError(body?.error ? `${body.error}${body.reason ? ` (${body.reason})` : ''}` : 'החיוג נכשל');
        return;
      }
      await startCall(body.dial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'החיוג נכשל');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={disabled || busy || callBusy}
        onClick={() => void dial()}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Phone className="size-3.5" aria-hidden />}
        {label}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
