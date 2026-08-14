'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid3x3, Headset, Mic, MicOff, Pause, Phone, PhoneOff, Play, Users, X } from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import {
  answerCall,
  dismissCall,
  getCallSnapshot,
  hangupCall,
  rejectCall,
  sendDtmf,
  subscribeCall,
  toggleHold,
  toggleMute,
  type ConsoleCallSnapshot,
  type ConsoleCallState,
} from '@/lib/voximplant/web-client';
import {
  makePollingFallback,
  REALTIME_SUBSCRIBE_STATES,
  subscribeConsoleCalls,
} from '@/lib/realtime/console-channels';
import type { RosterAgent } from '@/components/console/softphone-panel';
import { cn } from '@/lib/utils';

// Every visible label here is driven ONLY by the CALL snapshot (SDK events
// via the pure reducer in call-snapshot.ts) — never optimistic, per the
// project's honest-UI rule.
//
// "מחובר למערכת" (not "מחובר") for the connected state is deliberate: on
// ConsoleDial.voxengine.js BOTH branches answer the operator/browser leg
// before the far party is confirmed reachable (internal: before the callee
// even rings; outbound: before the PSTN leg connects and before
// disclosure+bridge). CallEvent.Connected — the only signal this file is
// allowed to call "connected" — therefore proves only that the browser is
// connected to the PLATFORM, never that the other party answered. See the
// matching comment in web-client.ts before changing this wording.
const STATE_LABEL: Partial<Record<ConsoleCallState, string>> = {
  ringing_out: 'מחייג…',
  ringing_in: 'שיחה נכנסת',
  connected: 'מחובר למערכת',
  ended: 'השיחה הסתיימה',
  failed: 'השיחה נכשלה',
};
const STATE_VARIANT: Partial<Record<ConsoleCallState, BadgeVariant>> = {
  ringing_out: 'info',
  ringing_in: 'info',
  connected: 'success',
  ended: 'neutral',
  failed: 'destructive',
};

const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Stage 2 (consult-before-transfer + conference). console_calls.kind values
// that carry a real customer leg — mirrors LIVE_CUSTOMER_CALL_KINDS in
// src/lib/data/console-calls.ts (`import 'server-only'`, so it cannot be
// imported into this Client Component — same reasoning ai-handoff-section.tsx
// documents for its own AI_CALL_TERMINAL_STATUSES duplication). KEEP IN SYNC.
const CONSULTABLE_KINDS = new Set(['manual', 'inbound_customer']);

// The console_calls row for the OPERATOR'S OWN currently-bridged customer
// call (never the operator's own SDK Call — the browser's `snap` above is a
// DIFFERENT object; this is the scenario-side row the consult/conference
// commands act on).
interface CollabCallInfo {
  id: string;
  status: string;
  kind: string;
  consultAgentId: string | null;
  /** Set only once the consult target actually ANSWERED — see below. */
  consultConnectedAt: string | null;
  conferenceAgentIds: string[];
}

async function bearerToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// conference_agent_ids is jsonb — generated as `Json` (a union wide enough to
// include objects/numbers/etc.), not `string[]` — so reading it back needs a
// runtime narrow, not a blind assertion. Same idiom as parseReactive in
// src/lib/fleet/handoff.ts for the identical Json-array-of-strings shape.
// Writing a `string[]` into a `Json` column (console-calls.ts's
// updateConsoleCallStatus) needs no such narrow: that direction is already a
// valid widening.
function asAgentIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function CallBar({
  selfUserId,
  roster,
  consultConferenceEnabled,
}: {
  selfUserId: string | null;
  roster: RosterAgent[];
  consultConferenceEnabled: boolean;
}) {
  const [snap, setSnap] = useState<ConsoleCallSnapshot>(() => getCallSnapshot());
  const [showKeypad, setShowKeypad] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeCall(setSnap), []);

  useEffect(() => {
    if (snap.state !== 'connected') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snap.state]);

  // Stage 2 — the console_calls row behind the operator's own bridged
  // customer call. Own effect, deliberately separate from anything else in
  // the panel (softphone-panel.tsx's own activeCall query, own realtime
  // subscription) so a failure here can never touch that query's error
  // handling.
  const [collab, setCollab] = useState<CollabCallInfo | null>(null);
  useEffect(() => {
    // No synchronous setState here (softphone-panel.tsx's activeCall effect
    // precedent) — `collab` already starts at its correct default (null),
    // so there is nothing to reset on the common case (mount, before
    // selfUserId resolves); this effect only ever needs to PRODUCE a value,
    // never un-produce one.
    if (!consultConferenceEnabled || !selfUserId) return;
    const supabase = createClient();
    let cancelled = false;

    async function refresh() {
      const { data, error } = await supabase
        .from('console_calls')
        .select('id, status, kind, consult_agent_id, consult_connected_at, conference_agent_ids')
        .in('status', ['ringing', 'connected'])
        .or(`agent_id.eq.${selfUserId},transferred_to_agent_id.eq.${selfUserId}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setCollab(null);
        return;
      }
      setCollab({
        id: data.id,
        status: data.status,
        kind: data.kind,
        consultAgentId: data.consult_agent_id,
        consultConnectedAt: data.consult_connected_at,
        conferenceAgentIds: asAgentIdArray(data.conference_agent_ids),
      });
    }

    void refresh();
    let stopPolling: (() => void) | null = null;
    const stopRealtime = subscribeConsoleCalls(() => void refresh(), (status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        stopPolling?.();
        stopPolling = null;
        return;
      }
      if (!stopPolling) stopPolling = makePollingFallback(() => void refresh(), 30_000);
    });

    return () => {
      cancelled = true;
      stopRealtime();
      stopPolling?.();
    };
  }, [consultConferenceEnabled, selfUserId]);

  const [picker, setPicker] = useState<'consult' | 'conference' | null>(null);
  const [collabBusy, setCollabBusy] = useState(false);
  const [collabError, setCollabError] = useState<string | null>(null);

  // Fires one of the four stage-2 command routes against the CURRENT collab
  // call. 2xx here means delivered, never "done" — collab (above) is the
  // only truth this component ever renders as consulting/in-conference,
  // exactly like every other honest-UI surface in this console.
  const fireCollab = useCallback(
    async (path: 'consult' | 'consult/cancel' | 'consult/complete' | 'conference', toAgentId?: string) => {
      if (!collab) return;
      setCollabBusy(true);
      setCollabError(null);
      try {
        const token = await bearerToken();
        if (!token) throw new Error('אין session פעיל');
        const res = await fetch(`/api/console-calls/${collab.id}/${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: toAgentId ? JSON.stringify({ to_agent_id: toAgentId }) : undefined,
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setCollabError(body?.error ?? 'הפעולה נכשלה');
          return;
        }
        setPicker(null);
      } catch (err) {
        setCollabError(err instanceof Error ? err.message : 'הפעולה נכשלה');
      } finally {
        setCollabBusy(false);
      }
    },
    [collab],
  );

  // Ready + provisioned + not-self — same eligibility RosterDialButton
  // already enforces for internal calls.
  const pickableAgents = useMemo(
    // `status` here is EFFECTIVE presence (softphone-panel maps it through
    // effectivePresence before it ever reaches this component), so a stale
    // heartbeat has already become 'offline' and drops out of this filter.
    // That closes the gap where the picker offered a target the server's
    // resolveTransferTarget would then refuse with 409 — the two now apply
    // the same freshness window, from the same constant.
    () => roster.filter((a) => a.provisioned && a.status === 'ready' && a.userId !== selfUserId),
    [roster, selfUserId],
  );

  const elapsed = useMemo(() => {
    if (snap.state !== 'connected' || !snap.connectedAt) return null;
    return formatElapsed(Math.max(0, Math.floor((now - snap.connectedAt) / 1000)));
  }, [snap.state, snap.connectedAt, now]);

  if (snap.state === 'idle') {
    return snap.micError ? (
      <p className="text-xs text-destructive">
        לא ניתן היה לגשת למיקרופון — יש לאשר גישה בדפדפן
      </p>
    ) : null;
  }

  return (
    <section className="space-y-2 border-t border-border pt-3" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATE_VARIANT[snap.state] ?? 'neutral'}>{STATE_LABEL[snap.state]}</Badge>
        {elapsed ? <span className="text-xs text-muted-foreground" dir="ltr">{elapsed}</span> : null}
      </div>

      {snap.remoteDisplayName ? (
        <p className="truncate text-sm font-medium">{snap.remoteDisplayName}</p>
      ) : null}

      {snap.micError ? (
        <p className="text-xs text-destructive">לא ניתן היה לגשת למיקרופון — יש לאשר גישה בדפדפן</p>
      ) : null}

      {snap.state === 'ringing_in' ? (
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="xs" onClick={() => void answerCall()}>
            <Phone className="size-3.5" aria-hidden /> מענה
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={rejectCall}>
            <PhoneOff className="size-3.5" aria-hidden /> דחייה
          </Button>
        </div>
      ) : null}

      {snap.state === 'ringing_out' ? (
        <Button type="button" size="xs" variant="outline" onClick={hangupCall}>
          <PhoneOff className="size-3.5" aria-hidden /> ניתוק
        </Button>
      ) : null}

      {snap.state === 'connected' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="xs"
              variant={snap.muted ? 'default' : 'outline'}
              onClick={toggleMute}
              aria-pressed={snap.muted}
            >
              {snap.muted ? <MicOff className="size-3.5" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
              השתקה
            </Button>
            <Button
              type="button"
              size="xs"
              variant={snap.onHold ? 'default' : 'outline'}
              onClick={() => void toggleHold()}
              aria-pressed={snap.onHold}
            >
              {snap.onHold ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
              השהיה
            </Button>
            <Button
              type="button"
              size="xs"
              variant={showKeypad ? 'default' : 'outline'}
              onClick={() => setShowKeypad((v) => !v)}
              aria-pressed={showKeypad}
            >
              <Grid3x3 className="size-3.5" aria-hidden /> חיוג
            </Button>
            <Button type="button" size="xs" variant="destructive" onClick={hangupCall}>
              <PhoneOff className="size-3.5" aria-hidden /> ניתוק
            </Button>
          </div>
          {showKeypad ? (
            <div className="grid grid-cols-3 gap-1">
              {DTMF_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="xs"
                  variant="outline"
                  className={cn('font-mono')}
                  onClick={() => sendDtmf(key)}
                >
                  {key}
                </Button>
              ))}
            </div>
          ) : null}

          {/* Stage 2 — consult-before-transfer + 3-way conference. Gated on
              the app_settings flag, on collab actually being resolved (the
              customer-facing console_calls row behind THIS SDK call — never
              inferred from `snap` alone), and on its kind carrying a real
              customer (never internal/ai_handoff). Every visible state below
              comes from `collab` (console_calls via Realtime) — never
              optimistic, same discipline as the rest of this file. */}
          {consultConferenceEnabled && collab && CONSULTABLE_KINDS.has(collab.kind) ? (
            <div className="space-y-1.5 border-t border-border pt-2">
              {collab.consultAgentId ? (
                /* TWO distinct states, not one. consult_agent_id is written
                   OPTIMISTICALLY at consult_started — while the target is
                   still ringing, for up to TRANSFER_TIMEOUT_MS (20s).
                   consult_connected_at is stamped only when they actually
                   answer. Gating "השלמת העברה" on the optimistic field made
                   it clickable long before there was anything to complete,
                   and the scenario's completeConsult() then silently no-ops
                   (it guards on state.consultActive) — a 202 followed by
                   nothing, which is the save_rsvp 'queued' false promise in
                   another costume. Cancel stays available from the first
                   moment BECAUSE it is gated on the optimistic field: a
                   consult that is still ringing is exactly what an operator
                   most wants to abort. */
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="info">
                    {collab.consultConnectedAt ? 'בהתייעצות' : 'מחייג להתייעצות…'}
                  </Badge>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={collabBusy}
                    onClick={() => void fireCollab('consult/cancel')}
                  >
                    ביטול התייעצות
                  </Button>
                  {collab.consultConnectedAt ? (
                    <Button
                      type="button"
                      size="xs"
                      disabled={collabBusy}
                      onClick={() => void fireCollab('consult/complete')}
                    >
                      השלמת העברה
                    </Button>
                  ) : null}
                </div>
              ) : collab.conferenceAgentIds.length > 0 ? (
                <Badge variant="info">בוועידה</Badge>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant={picker === 'consult' ? 'default' : 'outline'}
                    disabled={collabBusy}
                    aria-pressed={picker === 'consult'}
                    onClick={() => setPicker((p) => (p === 'consult' ? null : 'consult'))}
                  >
                    <Headset className="size-3.5" aria-hidden /> התייעצות
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={picker === 'conference' ? 'default' : 'outline'}
                    disabled={collabBusy}
                    aria-pressed={picker === 'conference'}
                    onClick={() => setPicker((p) => (p === 'conference' ? null : 'conference'))}
                  >
                    <Users className="size-3.5" aria-hidden /> צירוף לשיחה
                  </Button>
                </div>
              )}

              {picker ? (
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
                  {pickableAgents.length === 0 ? (
                    <li className="px-1 text-[11px] text-muted-foreground">אין נציגים זמינים כרגע</li>
                  ) : (
                    pickableAgents.map((agent) => (
                      <li key={agent.userId}>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="w-full justify-start"
                          disabled={collabBusy}
                          onClick={() =>
                            void fireCollab(picker === 'consult' ? 'consult' : 'conference', agent.userId)
                          }
                        >
                          {agent.displayName}
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}

              {collabError ? <p className="text-[11px] text-destructive">{collabError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {snap.state === 'ended' || snap.state === 'failed' ? (
        <Button type="button" size="xs" variant="outline" onClick={dismissCall}>
          <X className="size-3.5" aria-hidden /> סגירה
        </Button>
      ) : null}
    </section>
  );
}
