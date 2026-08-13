'use client';

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { BellRing } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { urlBase64ToUint8Array } from '@/lib/push/browser';
import { subscribeConsolePushAction, unsubscribeConsolePushAction } from './push-alert-actions';

// Compact push-subscribe control for the softphone panel — the agent-facing
// half of the inbound-call alert (route-inbound's
// notifyRoutableAgentsOfInboundCall fires the notification; this component
// only manages whether there's a subscription for it to land on). Same
// mechanism as the customer settings page's PushNotificationManager
// (src/app/(customer)/app/settings/push-notification-manager.tsx): same
// service worker (/sw.js), same push_subscriptions table, same VAPID keys —
// just a compact badge+button shape that fits inside an existing panel
// section instead of a full settings page.
//
// Deliberately NOT auto-subscribing: the browser permission prompt requires
// a user gesture anyway, and an agent opting in explicitly matches the
// settings page's own pattern (project rule: no state the user didn't ask
// for).

function noopSubscribe() {
  return () => {};
}

function getIsSupportedSnapshot() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function getFalseServerSnapshot() {
  return false;
}

export function ConsolePushAlertToggle() {
  const [isPending, startTransition] = useTransition();
  const isSupported = useSyncExternalStore(
    noopSubscribe,
    getIsSupportedSnapshot,
    getFalseServerSnapshot,
  );
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => registration.pushManager.getSubscription())
      .then(setSubscription)
      .catch(() => {
        // Silent — the badge below simply stays "כבויות"; the phone-connection
        // section already surfaces the panel's own error states.
      });
  }, [isSupported]);

  function subscribe() {
    startTransition(async () => {
      setError(null);
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setError('מפתח VAPID ציבורי לא מוגדר.');
        return;
      }
      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission !== 'granted') {
        setError('לא ניתנה הרשאה להתראות בדפדפן.');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const next = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const result = await subscribeConsolePushAction(JSON.parse(JSON.stringify(next)));
        if (!result.success) {
          setError(result.error ?? 'שמירת ההתראה נכשלה.');
          await next.unsubscribe();
          return;
        }
        setSubscription(next);
      } catch {
        setError('הפעלת ההתראות נכשלה. בדקו הרשאות דפדפן ו-HTTPS.');
      }
    });
  }

  function unsubscribe() {
    startTransition(async () => {
      setError(null);
      if (!subscription) return;
      const endpoint = subscription.endpoint;
      try {
        await subscription.unsubscribe();
      } catch {
        // Still attempt the server-side revoke below even if the browser-side
        // unsubscribe itself failed (e.g. already gone) — same fail-forward
        // shape as unsubscribeFromPush in the settings page.
      }
      const result = await unsubscribeConsolePushAction(endpoint);
      if (!result.success) {
        setError(result.error ?? 'ביטול ההתראה נכשל.');
        return;
      }
      setSubscription(null);
    });
  }

  if (!isSupported) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={subscription ? 'success' : 'neutral'}>
        <BellRing className="size-3" aria-hidden />
        {subscription ? 'התראות שיחה פעילות' : 'התראות שיחה כבויות'}
      </Badge>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={isPending}
        onClick={subscription ? unsubscribe : subscribe}
      >
        {subscription ? 'כיבוי' : 'הפעלה'}
      </Button>
      {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
