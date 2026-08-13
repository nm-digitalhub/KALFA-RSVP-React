'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchConsoleSdkAuthHash } from '@/lib/voximplant/sdk-auth-client';
import {
  CONNECTION_NODES,
  connectAndLogin,
  disconnectPhone,
  getPhoneSnapshot,
  subscribePhone,
  type ConnectionNodeName,
  type ConsolePhoneSnapshot,
} from '@/lib/voximplant/web-client';

// Dev login surface (stage 2). The ConnectionNode of the account is UNVERIFIED —
// this panel exists to determine it empirically: pick a node, connect, log in.
// The chosen node is remembered locally; once proven it graduates to real
// configuration in stage 3.
const NODE_STORAGE_KEY = 'kalfa-console-node';

// Hebrew labels per business state; sdkState is shown raw for diagnostics.
const STATE_LABELS: Record<ConsolePhoneSnapshot['state'], string> = {
  idle: 'לא מחובר',
  connecting: 'מתחבר…',
  logging_in: 'מבצע התחברות…',
  logged_in: 'מחובר ומזוהה',
  reconnecting: 'מתחבר מחדש…',
  disconnected: 'מנותק',
  other_tab: 'פעיל בלשונית אחרת',
  error: 'שגיאה',
};

const STATE_VARIANTS: Partial<Record<ConsolePhoneSnapshot['state'], 'default' | 'secondary' | 'destructive' | 'outline'>> = {
  logged_in: 'default',
  error: 'destructive',
  other_tab: 'destructive',
};

export function ConsolePhoneDev({
  voxUsername,
  displayName,
}: {
  voxUsername: string;
  displayName: string;
}) {
  const [snap, setSnap] = useState<ConsolePhoneSnapshot>(() => getPhoneSnapshot());
  const [node, setNode] = useState<ConnectionNodeName>('NODE_1');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePhone(setSnap), []);
  useEffect(() => {
    // Deferred by a macrotask (availability-status.tsx precedent): setting
    // state straight inside the effect body would set state synchronously
    // during the same commit (cascading render).
    const timer = setTimeout(() => {
      const saved = window.localStorage.getItem(NODE_STORAGE_KEY);
      if (saved && (CONNECTION_NODES as readonly string[]).includes(saved)) {
        setNode(saved as ConnectionNodeName);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const onConnect = useCallback(async () => {
    setBusy(true);
    try {
      window.localStorage.setItem(NODE_STORAGE_KEY, node);
      await connectAndLogin({ voxUsername, node, fetchHash: fetchConsoleSdkAuthHash });
    } catch {
      // Snapshot already carries the honest error state.
    } finally {
      setBusy(false);
    }
  }, [node, voxUsername]);

  const onDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      await disconnectPhone();
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATE_VARIANTS[snap.state] ?? 'secondary'}>
          {STATE_LABELS[snap.state]}
        </Badge>
        {snap.sdkState ? (
          <span className="text-xs text-muted-foreground" dir="ltr">
            SDK: {snap.sdkState}
          </span>
        ) : null}
      </div>

      {snap.detail ? (
        <p className="text-sm text-destructive">{snap.detail}</p>
      ) : null}
      {snap.diag ? (
        <p className="font-mono text-xs text-muted-foreground" dir="ltr">
          {snap.diag}
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">נציג</dt>
          <dd>{displayName || '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">זהות טלפוניה</dt>
          <dd dir="ltr" className="font-mono text-xs">{voxUsername}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Connection Node (בירור אמפירי)</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={node}
            onChange={(e) => setNode(e.target.value as ConnectionNodeName)}
            disabled={busy || snap.state === 'logged_in'}
            dir="ltr"
          >
            {CONNECTION_NODES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={onConnect} disabled={busy || snap.state === 'logged_in'}>
          התחברות
        </Button>
        <Button
          variant="outline"
          onClick={onDisconnect}
          disabled={busy || snap.state === 'idle' || snap.state === 'disconnected'}
        >
          ניתוק
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        שלב 2 בלבד: התחברות וזיהוי, ללא שיחות. ההתחברות חתומה בשרת — הסיסמה לעולם
        אינה מגיעה לדפדפן.
      </p>
    </div>
  );
}
