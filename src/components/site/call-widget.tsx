'use client';

import { useEffect, useState } from 'react';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { Loader2, Phone, PhoneOff, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  MEASURED_CONNECTION_NODE,
  type ConnectionNodeName,
} from '@/lib/voximplant/web-client';
import {
  getWidgetPhoneSnapshot,
  hangupWidgetCall,
  resetWidgetPhone,
  startWidgetCall,
  subscribeWidgetPhone,
  type WidgetPhoneSnapshot,
} from '@/lib/voximplant/widget-client';

// Floating call-center widget — capability A, REVISED (owner-directed pivot,
// 12.8): a real browser-to-agent call on a SHARED Voximplant identity, not
// the earlier callback-request substitute (deleted — see git history,
// callback-widget.tsx). See console-calls.ts's evaluateWidgetCallCaps
// header for the full research trail on why a shared identity is safe (DOCS:
// MAU is per unique credential/month, not per login — one shared identity
// for every visitor costs 1 MAU/month regardless of traffic).
//
// DELIBERATELY NOT MOUNTED anywhere yet (see (public)/(site)/layout.tsx's
// comment) — app_settings.console_widget_enabled defaults FALSE and there is
// no Voximplant rule/scenario for it to reach yet, so mounting this today
// would show every site visitor a button that always refuses. Mounting is
// the LAST step of the single approval gate in the report, once the whole
// chain (shared identity provisioned, rule+scenario created, flag flipped)
// actually works end-to-end — same discipline as console_softphone_enabled
// staying dark until its own go-live.
//
// Portaled? No — this widget has no Sheet/Dialog/Popover, just a fixed-
// position panel toggled by local state, so it does NOT need
// DirectionProvider for THAT reason. It still wraps in one anyway because
// nothing in the (public)/(site) tree sets it, and a future addition inside
// this panel (e.g. a text disclosure link that opens a portaled tooltip)
// would silently render LTR without it — cheap insurance, same posture as
// every other portal-adjacent component in this codebase.
//
// TEXT disclosure BEFORE connecting, not spoken — per the call-center
// research (finding d): a visitor who deliberately opens a call widget has
// already chosen the moment (unlike an unsuspecting PSTN callee), so the
// project's spoken DISCLOSURE_LINE_* constants don't apply as-is; this is a
// visible line shown before the "התחלת שיחה" button does anything, matching
// the project-wide "כנות UI" principle that no connecting-state may be
// implied before a real signal.

const STATE_LABEL: Record<WidgetPhoneSnapshot['state'], string> = {
  idle: '',
  connecting: 'מתחברים…',
  logging_in: 'מתחברים…',
  requesting: 'בודקים זמינות…',
  calling: 'מחייגים…',
  connected: 'מחובר למוקד',
  ended: 'השיחה הסתיימה',
  failed: '',
  mic_denied: '',
  refused: '',
};

const BUSY_STATES: ReadonlySet<WidgetPhoneSnapshot['state']> = new Set([
  'connecting',
  'logging_in',
  'requesting',
  'calling',
]);

async function fetchWidgetHash(oneTimeKey: string): Promise<{ hash: string }> {
  const res = await fetch('/api/widget/sdk-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ one_time_key: oneTimeKey }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`sdk-auth ${res.status}`);
  return res.json();
}

async function requestWidgetCallIntent(): Promise<
  { ok: true; token: string } | { ok: false; reason?: string }
> {
  const res = await fetch('/api/widget/call-intent', { method: 'POST', cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as
    | { ok: true; token: string }
    | { ok: false; reason?: string }
    | null;
  if (!res.ok || !body) return { ok: false };
  return body;
}

const NODE: ConnectionNodeName = MEASURED_CONNECTION_NODE;

export function CallWidget() {
  const [open, setOpen] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [snap, setSnap] = useState<WidgetPhoneSnapshot>(() => getWidgetPhoneSnapshot());

  useEffect(() => subscribeWidgetPhone(setSnap), []);

  function onStartCall() {
    void startWidgetCall({ node: NODE, fetchHash: fetchWidgetHash, requestCallIntent: requestWidgetCallIntent });
  }

  function onClose() {
    if (snap.state === 'connected' || BUSY_STATES.has(snap.state)) {
      hangupWidgetCall();
    }
    resetWidgetPhone();
    setDisclosureAccepted(false);
    setOpen(false);
  }

  const errorDetail =
    snap.state === 'failed' || snap.state === 'refused' || snap.state === 'mic_denied'
      ? snap.detail
      : null;

  return (
    <DirectionProvider direction="rtl">
      <div dir="rtl" className="fixed bottom-4 end-4 z-40">
        {!open ? (
          <Button
            type="button"
            size="lg"
            className="shadow-lg"
            aria-label="שיחה עם מוקד קלפה"
            onClick={() => setOpen(true)}
          >
            <Phone aria-hidden />
            שיחה עם המוקד
          </Button>
        ) : (
          <div className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Phone className="size-4 text-muted-foreground" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">שיחה עם המוקד</p>
              <button
                type="button"
                aria-label="סגירה"
                onClick={onClose}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3 text-sm">
              {snap.state === 'idle' && !disclosureAccepted ? (
                <>
                  <p className="text-muted-foreground">
                    השיחה מתבצעת דרך הדפדפן ומועברת לנציג במוקד קלפה. השיחה
                    מוקלטת לצורך תיעוד ושיפור השירות.
                  </p>
                  <Button type="button" className="w-full" onClick={() => setDisclosureAccepted(true)}>
                    הבנתי, המשך
                  </Button>
                </>
              ) : null}

              {snap.state === 'idle' && disclosureAccepted ? (
                <Button type="button" className="w-full" onClick={onStartCall}>
                  <Phone aria-hidden />
                  התחלת שיחה
                </Button>
              ) : null}

              {BUSY_STATES.has(snap.state) ? (
                <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {STATE_LABEL[snap.state]}
                </div>
              ) : null}

              {snap.state === 'connected' ? (
                <>
                  <p className="text-center font-medium text-emerald-600 dark:text-emerald-400">
                    {STATE_LABEL.connected}
                  </p>
                  <Button type="button" variant="destructive" className="w-full" onClick={onClose}>
                    <PhoneOff aria-hidden />
                    ניתוק
                  </Button>
                </>
              ) : null}

              {snap.state === 'ended' ? (
                <p className="text-center text-muted-foreground">{STATE_LABEL.ended}</p>
              ) : null}

              {errorDetail ? <p className="text-destructive">{errorDetail}</p> : null}

              {(snap.state === 'ended' ||
                snap.state === 'failed' ||
                snap.state === 'refused' ||
                snap.state === 'mic_denied') ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    resetWidgetPhone();
                    setDisclosureAccepted(false);
                  }}
                >
                  סגירה
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </DirectionProvider>
  );
}
