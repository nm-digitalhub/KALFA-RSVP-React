'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import {
  makePollingFallback,
  REALTIME_SUBSCRIBE_STATES,
  subscribeConsoleCallFeed,
  subscribeHumanLegs,
} from '@/lib/realtime/console-channels';
import { cn } from '@/lib/utils';

// "שיחות AI חיות" — the browser console's view onto live AI (RSVPAgent) calls,
// with claim + monitor/takeover + close_agent. Plan stage 6-UI. Deliberately a
// separate component from softphone-panel.tsx: this section watches a DIFFERENT
// table pair (console_call_feed / human_agent_call_legs) than the panel's own
// console_calls-based manual/inbound flow, and keeps softphone-panel.tsx from
// growing a second unrelated data layer inline.
//
// Honest-UI discipline throughout (save_rsvp precedent, restated in the plan):
// a POST's 202 means "delivered", never "connected"/"closed". Every visible
// "I'm listening" / "I'm live" / "AI closed" state comes ONLY from a realtime
// row (human_agent_call_legs for the human leg; console_call_feed itself is
// not yet updated by close_agent — see the button's own caption).

// call_attempts.TERMINAL_STATUSES (src/lib/data/call-attempts.ts) — that module
// is `import 'server-only'`, so it cannot be imported here. console_call_feed
// mirrors call_attempts.status 1:1 (sync_console_call_feed trigger), so this is
// a deliberate, documented duplication of that same vocabulary, not a guess.
// KEEP IN SYNC with call-attempts.ts's TERMINAL_STATUSES (currently includes
// 'handed_off', landed by the concurrent AI-handoff stage in this same
// change-set) — a stale copy here leaves a handed-off call stuck on this
// board forever, looking claimable when it is long over.
const AI_CALL_TERMINAL_STATUSES = ['completed', 'failed', 'no_answer', 'no_response', 'cancelled', 'handed_off'];

interface RosterLookup {
  userId: string;
  displayName: string;
}

interface AiCallFeedRow {
  callAttemptId: string;
  eventId: string | null;
  status: string | null;
  handledBy: string;
  agentId: string | null;
  takeoverClaimedAt: string | null;
  participationState: string | null;
}

type LegStatus = 'requested' | 'dialing' | 'ringing' | 'connected' | 'cancelled' | 'failed' | 'disconnected';
const LEG_LIVE: readonly LegStatus[] = ['requested', 'dialing', 'ringing', 'connected'];

interface OwnLeg {
  callAttemptId: string;
  mode: 'monitor' | 'takeover';
  status: LegStatus;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'בתור',
  dialing: 'מחייג',
  in_progress: 'בשיחה',
};
const LEG_STATUS_LABEL: Record<LegStatus, string> = {
  requested: 'התבקש',
  dialing: 'מחייג לנציג',
  ringing: 'מצלצל',
  connected: 'מחובר',
  cancelled: 'בוטל',
  failed: 'נכשל',
  disconnected: 'נותק',
};
const LEG_STATUS_VARIANT: Partial<Record<LegStatus, BadgeVariant>> = {
  connected: 'success',
  failed: 'destructive',
  disconnected: 'neutral',
  ringing: 'info',
  dialing: 'info',
  requested: 'info',
};

async function bearerToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function AiHandoffSection({
  selfUserId,
  roster,
}: {
  selfUserId: string | null;
  roster: RosterLookup[];
}) {
  const [rows, setRows] = useState<AiCallFeedRow[]>([]);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const [legs, setLegs] = useState<Record<string, OwnLeg>>({});
  const [claimBusy, setClaimBusy] = useState<Record<string, boolean>>({});
  const [claimError, setClaimError] = useState<Record<string, string>>({});
  const [attachBusy, setAttachBusy] = useState<Record<string, boolean>>({});
  const [attachError, setAttachError] = useState<Record<string, string>>({});
  const [closeBusy, setCloseBusy] = useState<Record<string, boolean>>({});
  const [closeSent, setCloseSent] = useState<Record<string, boolean>>({});

  const loadRows = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('console_call_feed')
      .select(
        'call_attempt_id, event_id, status, handled_by, agent_id, takeover_claimed_at, participation_state',
      )
      .not('status', 'in', `(${AI_CALL_TERMINAL_STATUSES.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error || !data) return;
    setRows(
      data.map((r) => ({
        callAttemptId: r.call_attempt_id,
        eventId: r.event_id,
        status: r.status,
        handledBy: r.handled_by,
        agentId: r.agent_id,
        takeoverClaimedAt: r.takeover_claimed_at,
        participationState: r.participation_state,
      })),
    );
    setRowsLoaded(true);
  }, []);

  const loadLegs = useCallback(async () => {
    if (!selfUserId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from('human_agent_call_legs')
      .select('call_attempt_id, mode, status, requested_at')
      .in('status', [...LEG_LIVE])
      .order('requested_at', { ascending: false });
    if (error || !data) return;
    // Keep only the latest live leg per call (RLS already scopes this to MY
    // own legs — human_agent_call_legs_select_own).
    const next: Record<string, OwnLeg> = {};
    for (const r of data) {
      if (next[r.call_attempt_id]) continue; // already have the newest (desc order)
      next[r.call_attempt_id] = {
        callAttemptId: r.call_attempt_id,
        mode: r.mode as 'monitor' | 'takeover',
        status: r.status as LegStatus,
      };
    }
    setLegs(next);
  }, [selfUserId]);

  useEffect(() => {
    void loadRows();
    let stopPolling: (() => void) | null = null;
    const stopRealtime = subscribeConsoleCallFeed(() => void loadRows(), (status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        stopPolling?.();
        stopPolling = null;
        return;
      }
      if (!stopPolling) stopPolling = makePollingFallback(() => void loadRows(), 60_000);
    });
    return () => {
      stopRealtime();
      stopPolling?.();
    };
  }, [loadRows]);

  useEffect(() => {
    void loadLegs();
    let stopPolling: (() => void) | null = null;
    const stopRealtime = subscribeHumanLegs(() => void loadLegs(), (status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        stopPolling?.();
        stopPolling = null;
        return;
      }
      if (!stopPolling) stopPolling = makePollingFallback(() => void loadLegs(), 60_000);
    });
    return () => {
      stopRealtime();
      stopPolling?.();
    };
  }, [loadLegs]);

  const claim = useCallback(
    async (callAttemptId: string) => {
      if (!selfUserId) return;
      setClaimBusy((p) => ({ ...p, [callAttemptId]: true }));
      setClaimError((p) => ({ ...p, [callAttemptId]: '' }));
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('console_call_feed')
          // handled_by/participation_state values are THIS feature's own
          // convention — console_call_feed has no CHECK constraint on either
          // column and no other reader consumes them yet (docs:
          // app-monitor-parameters.md §ב.2 confirms the deployed native app
          // does not read them either).
          .update({
            agent_id: selfUserId,
            handled_by: 'human',
            takeover_claimed_at: new Date().toISOString(),
            takeover_request_id: crypto.randomUUID(),
            participation_state: 'claimed',
          })
          .eq('call_attempt_id', callAttemptId)
          .is('agent_id', null) // own-claim rule — RLS enforces this too, this just fails clearly
          .select('call_attempt_id')
          .maybeSingle();
        if (error || !data) {
          setClaimError((p) => ({ ...p, [callAttemptId]: 'השיחה כבר נתפסה על ידי נציג אחר' }));
          void loadRows();
          return;
        }
        void loadRows();
      } finally {
        setClaimBusy((p) => ({ ...p, [callAttemptId]: false }));
      }
    },
    [selfUserId, loadRows],
  );

  const attach = useCallback(async (callAttemptId: string, mode: 'monitor' | 'takeover') => {
    setAttachBusy((p) => ({ ...p, [callAttemptId]: true }));
    setAttachError((p) => ({ ...p, [callAttemptId]: '' }));
    try {
      const token = await bearerToken();
      if (!token) throw new Error('אין session פעיל');
      const res = await fetch(`/api/calls/${callAttemptId}/monitor`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setAttachError((p) => ({ ...p, [callAttemptId]: body?.error ?? 'הבקשה נכשלה' }));
        return;
      }
      // 202 delivered ONLY — never set a "connected" state here. legs (above)
      // is the sole truth for whether the leg actually connected.
    } catch (err) {
      setAttachError((p) => ({
        ...p,
        [callAttemptId]: err instanceof Error ? err.message : 'הבקשה נכשלה',
      }));
    } finally {
      setAttachBusy((p) => ({ ...p, [callAttemptId]: false }));
    }
  }, []);

  const closeAgent = useCallback(async (callAttemptId: string) => {
    setCloseBusy((p) => ({ ...p, [callAttemptId]: true }));
    try {
      const token = await bearerToken();
      if (!token) throw new Error('אין session פעיל');
      const res = await fetch(`/api/calls/${callAttemptId}/agent-command`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'close_agent' }),
        cache: 'no-store',
      });
      if (res.ok) setCloseSent((p) => ({ ...p, [callAttemptId]: true }));
    } finally {
      setCloseBusy((p) => ({ ...p, [callAttemptId]: false }));
    }
  }, []);

  return (
    <section className="space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">שיחות AI חיות</h3>
      {!rowsLoaded ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">אין שיחות AI פעילות כרגע.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {rows.map((row) => {
            const mine = row.agentId === selfUserId;
            const claimedByOther = !!row.agentId && !mine;
            const claimedByName = row.agentId
              ? (roster.find((r) => r.userId === row.agentId)?.displayName ?? 'נציג אחר')
              : null;
            const leg = legs[row.callAttemptId];
            const iAmOnTheLine = leg?.mode === 'takeover' && leg.status === 'connected';

            return (
              <li key={row.callAttemptId} className="space-y-1.5 rounded-md border border-border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {row.status ? (STATUS_LABEL[row.status] ?? row.status) : '—'}
                  </span>
                  {claimedByOther ? (
                    <Badge variant="neutral">נתפס ע״י {claimedByName}</Badge>
                  ) : mine ? (
                    <Badge variant="success">שלי</Badge>
                  ) : (
                    <Badge variant="info">פנוי לתפיסה</Badge>
                  )}
                </div>

                {!row.agentId ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={claimBusy[row.callAttemptId] || !selfUserId}
                    onClick={() => void claim(row.callAttemptId)}
                  >
                    תפיסה
                  </Button>
                ) : mine ? (
                  <div className="space-y-1.5">
                    {leg ? (
                      <span className="flex items-center gap-1.5">
                        <Badge variant={LEG_STATUS_VARIANT[leg.status] ?? 'neutral'}>
                          {leg.mode === 'monitor' ? 'האזנה' : 'השתלטות'}: {LEG_STATUS_LABEL[leg.status]}
                        </Badge>
                      </span>
                    ) : null}
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={attachBusy[row.callAttemptId] || !!leg}
                        onClick={() => void attach(row.callAttemptId, 'monitor')}
                      >
                        האזנה
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={attachBusy[row.callAttemptId] || !!leg}
                        onClick={() => void attach(row.callAttemptId, 'takeover')}
                      >
                        השתלטות
                      </Button>
                      {iAmOnTheLine ? (
                        <Button
                          type="button"
                          size="xs"
                          disabled={closeBusy[row.callAttemptId] || closeSent[row.callAttemptId]}
                          onClick={() => void closeAgent(row.callAttemptId)}
                        >
                          {closeSent[row.callAttemptId] ? 'הפקודה נשלחה' : 'אני על הקו'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {claimError[row.callAttemptId] ? (
                  <p className={cn('text-destructive')}>{claimError[row.callAttemptId]}</p>
                ) : null}
                {attachError[row.callAttemptId] ? (
                  <p className="text-destructive">{attachError[row.callAttemptId]}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
