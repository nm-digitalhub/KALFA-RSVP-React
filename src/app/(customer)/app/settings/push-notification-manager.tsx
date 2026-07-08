'use client';

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  sendTestPushAction,
  subscribePushAction,
  unsubscribePushAction,
} from './push-actions';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandaloneDisplayMode() {
  return window.matchMedia('(display-mode: standalone)').matches;
}

// Browser capability/state is external to React and must be read after mount to
// stay SSR- and hydration-safe. Like src/hooks/use-mobile.ts, each value is
// exposed through useSyncExternalStore instead of a synchronous setState inside
// an effect (React 19 / react-hooks/set-state-in-effect). Server snapshots return
// the inert defaults so SSR and the first client render agree.
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

function subscribeStandalone(callback: () => void) {
  const mql = window.matchMedia('(display-mode: standalone)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getPermissionSnapshot(): NotificationPermission {
  return typeof Notification !== 'undefined' ? Notification.permission : 'default';
}

function getFalseServerSnapshot() {
  return false;
}

function getDefaultPermissionServerSnapshot(): NotificationPermission {
  return 'default';
}

export function PushNotificationManager() {
  const [isPending, startTransition] = useTransition();
  const isSupported = useSyncExternalStore(
    noopSubscribe,
    getIsSupportedSnapshot,
    getFalseServerSnapshot,
  );
  const isIos = useSyncExternalStore(noopSubscribe, isIosDevice, getFalseServerSnapshot);
  const isStandalone = useSyncExternalStore(
    subscribeStandalone,
    isStandaloneDisplayMode,
    getFalseServerSnapshot,
  );
  const syncedPermission = useSyncExternalStore(
    noopSubscribe,
    getPermissionSnapshot,
    getDefaultPermissionServerSnapshot,
  );
  const [permissionOverride, setPermissionOverride] =
    useState<NotificationPermission | null>(null);
  const permission = permissionOverride ?? syncedPermission;
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function registerServiceWorker() {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    return registration.pushManager.getSubscription();
  }

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    void registerServiceWorker()
      .then((existingSubscription) => {
        setSubscription(existingSubscription);
      })
      .catch(() => {
        setMessage('רישום מנגנון ההתראות נכשל בדפדפן הזה.');
      });
  }, [isSupported]);

  function subscribeToPush() {
    startTransition(async () => {
      setMessage(null);

      if (!isSupported) {
        setMessage('הדפדפן הזה אינו תומך בהתראות דחיפה.');
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setMessage('מפתח VAPID ציבורי לא מוגדר.');
        return;
      }

      const requestedPermission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;

      setPermissionOverride(requestedPermission);

      if (requestedPermission !== 'granted') {
        setMessage('לא ניתנה הרשאה לשליחת התראות בדפדפן.');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const nextSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        const result = await subscribePushAction(
          JSON.parse(JSON.stringify(nextSubscription)),
        );

        if (!result.success) {
          setMessage(result.error ?? 'שמירת ההתראה נכשלה.');
          await nextSubscription.unsubscribe();
          return;
        }

        setSubscription(nextSubscription);
        setMessage('ההתראות הופעלו במכשיר הזה.');
      } catch {
        setMessage('הפעלת ההתראות נכשלה. בדקו הרשאות דפדפן ו-HTTPS.');
      }
    });
  }

  function unsubscribeFromPush() {
    startTransition(async () => {
      setMessage(null);

      try {
        const registration = await navigator.serviceWorker.ready;
        const currentSubscription =
          subscription ?? (await registration.pushManager.getSubscription());

        if (!currentSubscription) {
          setSubscription(null);
          setMessage('לא נמצאה התראה פעילה במכשיר הזה.');
          return;
        }

        const endpoint = currentSubscription.endpoint;
        await currentSubscription.unsubscribe();

        const result = await unsubscribePushAction(endpoint);
        if (!result.success) {
          setMessage(result.error ?? 'ביטול ההתראה נכשל.');
          return;
        }

        setSubscription(null);
        setMessage('ההתראות בוטלו במכשיר הזה.');
      } catch {
        setMessage('ביטול ההתראה נכשל. נסו שוב.');
      }
    });
  }

  function sendTestPush() {
    startTransition(async () => {
      setMessage(null);
      const result = await sendTestPushAction();

      if (!result.success) {
        setMessage(result.error ?? 'שליחת התראת בדיקה נכשלה.');
        return;
      }

      setMessage('נשלחה התראת בדיקה.');
    });
  }

  if (!isSupported) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        הדפדפן הנוכחי לא תומך בהתראות דחיפה. ב-iPhone נדרש להתקין את האתר למסך
        הבית, ובמחשב נדרש דפדפן מודרני עם הרשאות התראה.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">התראות דחיפה בדפדפן</p>
        <p className="text-sm text-muted-foreground">
          מאפשר קבלת התראות גם כשהאתר לא פתוח, בהתאם להרשאות הדפדפן והמכשיר.
        </p>
      </div>

      {isIos && !isStandalone ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          ב-iPhone יש לפתוח את האתר דרך Safari, לבחור שיתוף, ואז לבחור הוספה למסך
          הבית. לאחר פתיחה ממסך הבית ניתן להפעיל התראות.
        </p>
      ) : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">סטטוס הרשאה</dt>
          <dd className="mt-1 font-medium">
            {permission === 'granted'
              ? 'מאושר'
              : permission === 'denied'
                ? 'חסום בדפדפן'
                : 'טרם התבקשה הרשאה'}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">סטטוס מכשיר</dt>
          <dd className="mt-1 font-medium">
            {subscription ? 'התראות פעילות' : 'לא רשום להתראות'}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {subscription ? (
          <>
            <Button type="button" onClick={unsubscribeFromPush} disabled={isPending}>
              ביטול התראות
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={sendTestPush}
              disabled={isPending}
            >
              שליחת בדיקה
            </Button>
          </>
        ) : (
          <Button type="button" onClick={subscribeToPush} disabled={isPending}>
            הפעלת התראות
          </Button>
        )}
      </div>

      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
