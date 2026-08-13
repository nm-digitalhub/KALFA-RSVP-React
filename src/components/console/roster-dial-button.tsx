'use client';

import { useCallback, useEffect, useState } from 'react';
import { Phone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { agentVoxUsernameFor } from '@/lib/voximplant/agent-vox-username';
import {
  CALL_ACTIVE_STATES,
  getCallSnapshot,
  getPhoneSnapshot,
  startCall,
  subscribeCall,
  subscribePhone,
} from '@/lib/voximplant/web-client';

// One roster row's internal-call ("חיוג") affordance. Self-contained (reads
// the phone/call snapshots directly) so softphone-panel.tsx only needs to
// drop this in — no extra state threading through the panel.
//
// Internal calls need NO server round trip and NO consent gate: destination
// `agent_<uuid>` matches the ConsoleInternal rule (^agent_.*), and the Web
// SDK login on the calling leg IS the authorization (ConsoleDial.voxengine.js
// header comment, verified) — requireConsoleAgent/enrollConsoleAgent already
// gated who can log in as that identity.
export function RosterDialButton({
  userId,
  displayName,
  provisioned,
  ready,
  isSelf,
}: {
  userId: string;
  displayName: string;
  provisioned: boolean;
  /** agent_status.status === 'ready' */
  ready: boolean;
  isSelf: boolean;
}) {
  const [loggedIn, setLoggedIn] = useState(() => getPhoneSnapshot().state === 'logged_in');
  const [busyState, setBusyState] = useState(() => getCallSnapshot().state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribePhone((snap) => setLoggedIn(snap.state === 'logged_in')), []);
  useEffect(() => subscribeCall((snap) => setBusyState(snap.state)), []);

  const dial = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await startCall(agentVoxUsernameFor(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'החיוג נכשל');
    } finally {
      setBusy(false);
    }
  }, [userId]);

  if (isSelf || !provisioned) return null;

  const disabled = busy || !loggedIn || !ready || CALL_ACTIVE_STATES.includes(busyState);

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={disabled}
        onClick={() => void dial()}
        aria-label={`חיוג ל${displayName}`}
        title={`חיוג ל${displayName}`}
      >
        <Phone className="size-3.5" aria-hidden />
      </Button>
      {error ? <span className="text-[10px] text-destructive">{error}</span> : null}
    </span>
  );
}
