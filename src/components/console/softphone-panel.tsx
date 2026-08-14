'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Headset,
  Loader2,
  Phone,
  PhoneOff,
  X,
} from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { formatIsraelTime } from '@/lib/date';
import { fetchConsoleSdkAuthHash } from '@/lib/voximplant/sdk-auth-client';
import {
  CONNECTION_NODES,
  MEASURED_CONNECTION_NODE,
  connectAndLogin,
  disconnectPhone,
  getPhoneSnapshot,
  subscribePhone,
  type ConnectionNodeName,
  type ConsolePhoneSnapshot,
} from '@/lib/voximplant/web-client';
import {
  makePollingFallback,
  REALTIME_SUBSCRIBE_STATES,
  subscribeAgentStatus,
  subscribeChatMessages,
  subscribeConsoleCalls,
} from '@/lib/realtime/console-channels';
import { AiHandoffSection } from '@/components/console/ai-handoff-section';
import { CallBar } from '@/components/console/call-bar';
import { ChatSection } from '@/components/console/chat-section';
import { ConsolePushAlertToggle } from '@/components/console/push-alert-toggle';
import { computeUnreadChatCount, type ChatMessageRow } from '@/lib/console/chat';
import {
  effectivePresence,
  type EffectivePresence,
  type PresenceStatus,
} from '@/lib/console/presence';
import { RosterDialButton } from '@/components/console/roster-dial-button';
import { cn } from '@/lib/utils';

// The gate the (admin) layout computes server-side: `enabled` is the
// app_settings.console_softphone_enabled flag, `voxUsername` is non-null only
// for an enrolled+provisioned console agent, `handoffEnabled` is the
// app_settings.handoff_enabled flag gating the "שיחות AI חיות" section
// (stage 6-UI — app_settings is admin-only RLS, so the browser can never read
// it directly). All threaded through unconditionally by AdminShell via
// `{...softphone}`. Both `enabled`+`voxUsername` are required for anything to
// render — see the early return below.
export interface SoftphoneGateInfo {
  enabled: boolean;
  voxUsername: string | null;
  displayName: string;
  handoffEnabled: boolean;
  // Plan §10 extension point (department queues) — read-only, next to
  // presence. Admin-managed only (see /admin/voice/queues); this agent cannot
  // change it from here.
  queueMemberships: { key: string; nameHe: string }[];
  // app_settings.console_consult_conference_enabled (stage 2) — gates
  // CallBar's התייעצות/צירוף לשיחה controls. Same admin-only-RLS / read-at-
  // the-shell / fail-closed discipline as handoffEnabled above.
  consultConferenceEnabled: boolean;
  // Wake-and-answer research (12.8) — app_settings.console_wake_enabled.
  // Gates whether the panel ever ATTEMPTS an auto-connect (shift toggle
  // still renders so an agent can express intent even before the owner
  // flips this on; it just has no effect on connection behaviour yet).
  wakeEnabled: boolean;
  // This agent's OWN console_agent_shift row, already read through its
  // bounded-freshness window server-side (isShiftActiveAndFresh) — the panel
  // never re-derives freshness client-side. Mirrored into local state below
  // so the toggle can update optimistically without a full page reload.
  shiftActive: boolean;
}

// Must match the key the stage-2 dev page (admin/voice/console/_console-client.tsx)
// persists to — this panel deliberately reads what that page writes rather than
// offering its own node picker (the account's ConnectionNode is chosen there,
// empirically, once).
const NODE_STORAGE_KEY = 'kalfa-console-node';

const PRESENCE_VALUES: readonly PresenceStatus[] = ['ready', 'not_ready', 'dnd', 'in_call'];
function asPresenceStatus(value: string | null | undefined): PresenceStatus {
  return (PRESENCE_VALUES as readonly string[]).includes(value ?? '')
    ? (value as PresenceStatus)
    : 'not_ready';
}

// Keyed by EffectivePresence, so 'offline' — the state the DB column cannot
// express, and the one a stale heartbeat collapses everything else into — has
// to be given a label and a dot rather than silently falling back to a
// neighbouring status.
const PRESENCE_LABEL: Record<EffectivePresence, string> = {
  ready: 'זמין',
  not_ready: 'לא זמין',
  dnd: 'נא לא להפריע',
  in_call: 'בשיחה',
  offline: 'מנותק',
};
const PRESENCE_DOT: Record<EffectivePresence, string> = {
  ready: 'bg-emerald-500',
  not_ready: 'bg-slate-400',
  dnd: 'bg-amber-500',
  in_call: 'bg-blue-500',
  // Hollow, not filled: an offline agent is absent, not merely un-ready.
  offline: 'border border-slate-400 bg-transparent',
};
// The three states an agent may set for themselves. `in_call` is
// system-managed (POST /api/agents/status rejects it) — no button for it.
const SETTABLE_PRESENCE: { status: 'ready' | 'not_ready' | 'dnd'; label: string }[] = [
  { status: 'ready', label: 'זמין' },
  { status: 'not_ready', label: 'לא זמין' },
  { status: 'dnd', label: 'נא לא להפריע' },
];

// SDK connection state — a purely technical signal, kept visually and
// semantically separate from the business presence above (project rule: the
// two axes are never merged).
const PHONE_STATE_LABEL: Record<ConsolePhoneSnapshot['state'], string> = {
  idle: 'לא מחובר',
  connecting: 'מתחבר…',
  logging_in: 'מבצע התחברות…',
  logged_in: 'מחובר',
  reconnecting: 'מתחבר מחדש…',
  disconnected: 'מנותק',
  other_tab: 'פעיל בלשונית אחרת',
  error: 'שגיאה',
};
const PHONE_STATE_VARIANT: Partial<Record<ConsolePhoneSnapshot['state'], BadgeVariant>> = {
  logged_in: 'success',
  error: 'destructive',
  other_tab: 'destructive',
  connecting: 'info',
  logging_in: 'info',
  reconnecting: 'warning',
};

// Exported so CallBar's target-agent picker (stage 2 — consult/conference)
// can share the exact same shape rather than redeclaring it.
export interface RosterAgent {
  userId: string;
  displayName: string;
  // EFFECTIVE presence — 'offline' when the heartbeat is stale, whatever the
  // stored column says. Consumers (this roster, CallBar's target picker) must
  // never see the raw status: it is what let the UI offer an agent the server
  // would refuse to ring. See src/lib/console/presence.ts.
  status: EffectivePresence;
  provisioned: boolean;
  // Calendar-derived, ADVISORY only (Outlook/Exchange presence-sync
  // research, 12.8) — a third signal alongside `status` (business truth,
  // agent_status) and the SDK connection dot. Never overrides `status`;
  // shown as a small label beside it. null = not known to be calendar-busy
  // (no verified Exchange connection, no active blocking window, or no sync
  // yet — console_agent_calendar_presence is written by a worker cron, see
  // src/lib/data/console-agent-calendar-presence.ts).
  calendarBusyUntilIso: string | null;
  calendarShowAs: string | null;
}

// Hebrew labels for the calendar-derived show_as (mirrors AVAILABILITY_
// PRESETS' labels in exchange-availability.ts — that module is server-only
// and cannot be imported here, so the four labels are restated rather than
// shared).
const CALENDAR_SHOW_AS_LABEL: Record<string, string> = {
  busy: 'תפוס',
  oof: 'מחוץ למשרד',
  tentative: 'טנטטיבי',
  working_elsewhere: 'עובד מרחוק',
};

// Stage 8 — customer-card auto-open (see the effect below).
interface ActiveConsoleCall {
  id: string;
  status: string;
  eventId: string;
  guestId: string;
  contactId: string | null;
  direction: string;
  callerMasked: string | null;
}
interface GuestCardRow {
  // Nullable per the generated view row type even though this component only
  // ever assigns a row matched by an exact (event_id, guest_id) filter.
  guest_id: string | null;
  event_id: string | null;
  guest_name: string | null;
  rsvp_status: string | null;
  phone: string | null; // null unless the caller holds view_customer_data (the view's own gate)
}
const RSVP_STATUS_LABEL: Record<string, string> = {
  confirmed: 'אישר הגעה',
  declined: 'לא מגיע',
  pending: 'טרם ענה',
  maybe: 'אולי',
};

function readSavedNode(): ConnectionNodeName {
  // The dev page's saved choice wins; otherwise the MEASURED account node
  // (proven by a real login on 2026-08-12) — no more empirical hunting.
  if (typeof window === 'undefined') return MEASURED_CONNECTION_NODE;
  const saved = window.localStorage.getItem(NODE_STORAGE_KEY);
  return saved && (CONNECTION_NODES as readonly string[]).includes(saved)
    ? (saved as ConnectionNodeName)
    : MEASURED_CONNECTION_NODE;
}

export function SoftphonePanel({
  enabled,
  voxUsername,
  displayName,
  handoffEnabled,
  queueMemberships,
  consultConferenceEnabled,
  wakeEnabled,
  shiftActive,
}: SoftphoneGateInfo) {
  if (!enabled || !voxUsername) return null;
  return (
    <SoftphonePanelBody
      voxUsername={voxUsername}
      displayName={displayName}
      handoffEnabled={handoffEnabled}
      queueMemberships={queueMemberships}
      consultConferenceEnabled={consultConferenceEnabled}
      wakeEnabled={wakeEnabled}
      initialShiftActive={shiftActive}
    />
  );
}

function SoftphonePanelBody({
  voxUsername,
  displayName,
  handoffEnabled,
  queueMemberships,
  consultConferenceEnabled,
  wakeEnabled,
  initialShiftActive,
}: {
  voxUsername: string;
  displayName: string;
  handoffEnabled: boolean;
  queueMemberships: { key: string; nameHe: string }[];
  consultConferenceEnabled: boolean;
  wakeEnabled: boolean;
  initialShiftActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [phoneSnap, setPhoneSnap] = useState<ConsolePhoneSnapshot>(() => getPhoneSnapshot());
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [node, setNode] = useState<ConnectionNodeName | null>(null);

  // "On shift" intent (wake-and-answer research, 12.8) — mirrors the
  // server-read initialShiftActive, updated optimistically only after a
  // confirmed 2xx from /api/agents/shift (setPresence's own precedent, see
  // below). Deliberately NOT re-derived from a client-side freshness check —
  // the server already applied isShiftActiveAndFresh at the layout read.
  const [shiftActive, setShiftActive] = useState(initialShiftActive);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  // The `call` query param a wake-push deep link carries (route-inbound's
  // notifyRoutableAgentsOfInboundCall / notifyOffDutyShiftAgentsOfInboundCall
  // both set url=`/admin?call=<id>`). Its mere presence — not its value — is
  // the auto-connect trigger below: arriving via an actual call notification
  // is explicit-enough one-shot intent independent of the standing shift
  // toggle, and PWA notification-tap reliability on iOS is known-imperfect
  // when the app was fully killed (wake-and-answer research finding), so
  // this is the best-effort deep link, not the sole path — shiftActive above
  // covers the agent who simply reopens the app on their own.
  const hasWakeCallParam = useSearchParams().has('call');

  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [selfStatus, setSelfStatus] = useState<PresenceStatus | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  useEffect(() => subscribePhone(setPhoneSnap), []);
  useEffect(() => {
    // Deferred by a macrotask (availability-status.tsx precedent): setting
    // state straight inside the effect body would set state synchronously
    // during the same commit (cascading render).
    const timer = setTimeout(() => setNode(readSavedNode()), 0);
    return () => clearTimeout(timer);
  }, []);

  // Self presence + roster: initial load, live refresh on any agent_status
  // change, polling fallback only while the Realtime channel isn't joined.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function loadSelfStatus() {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid || cancelled) return;
      setSelfUserId(uid);
      const { data } = await supabase
        .from('agent_status')
        .select('status')
        .eq('agent_id', uid)
        .maybeSingle();
      if (!cancelled) setSelfStatus(asPresenceStatus(data?.status));
    }

    async function loadRoster() {
      const { data, error } = await supabase
        .from('console_agents_roster')
        .select(
          'user_id, display_name, status, status_updated_at, provisioned, calendar_busy_until, calendar_show_as',
        )
        .order('display_name', { ascending: true });
      if (cancelled || error || !data) return;
      // "Is this window still in the future?" is decided HERE (inside the
      // effect, where an impure Date.now() read is allowed), not in the JSX
      // render below — React's purity rule forbids calling Date.now() during
      // render. A window whose end has already passed is treated exactly
      // like "not calendar-busy" (null) even if the next sync (≤10min)
      // has not caught up yet, so a stale label is never shown as current.
      const nowMs = Date.now();
      setRoster(
        data
          .filter((row): row is typeof row & { user_id: string } => row.user_id !== null)
          .map((row) => ({
            userId: row.user_id,
            displayName: row.display_name ?? 'ללא שם',
            // EFFECTIVE, not raw. agent_status.status is a standing
            // declaration that nothing clears when a tab closes or a laptop
            // sleeps; liveness is the heartbeat. Showing the raw column let
            // the roster claim "זמין" for someone the ROUTER had already
            // aged out — measured 13.8 at a 661-minute-stale 'ready' while
            // every inbound call was answered with "אין נציג זמין". Same
            // window as findRoutableAgents, from the same constant.
            status: effectivePresence(asPresenceStatus(row.status), row.status_updated_at, nowMs),
            provisioned: row.provisioned === true,
            calendarBusyUntilIso:
              row.calendar_busy_until && Date.parse(row.calendar_busy_until) > nowMs
                ? row.calendar_busy_until
                : null,
            calendarShowAs: row.calendar_show_as,
          })),
      );
      setRosterLoaded(true);
    }

    const refetch = () => {
      void loadSelfStatus();
      void loadRoster();
    };
    refetch();

    let stopPolling: (() => void) | null = null;
    const stopRealtime = subscribeAgentStatus(refetch, (status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        stopPolling?.();
        stopPolling = null;
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED — presence must still update, just
      // less promptly, so fall back to polling until/unless it recovers.
      if (!stopPolling) stopPolling = makePollingFallback(refetch, 60_000);
    });

    return () => {
      cancelled = true;
      stopRealtime();
      stopPolling?.();
    };
  }, []);

  // Surfaced ONLY after repeated consecutive beat failures (never on a
  // single miss — a lone dropped request is normal network noise). This is
  // the one piece of heartbeat state that IS shown to the operator: silent
  // failure is fine for a beat or two, but a presence the server has stopped
  // believing for minutes must not stay invisible forever (honest-UI rule —
  // see this effect's own header below for the incident that motivated it).
  const [heartbeatDegraded, setHeartbeatDegraded] = useState(false);
  const heartbeatFailureStreak = useRef(0);

  // Heartbeat (plan stage-4 carried item): while the SDK is logged in,
  // re-POST the CURRENT presence status every 60s so agent_status.updated_at
  // keeps advancing. This is the freshness signal findRoutableAgentVoxUsernames()
  // needs before an inbound-caller ring can require <90s freshness — without
  // it that gate is permanently vacuous (nothing else writes agent_status on
  // any cadence). The visible presence dot/buttons are still driven ONLY by
  // setPresence()'s own explicit action, never by this — but a run of failed
  // beats now DOES surface heartbeatDegraded (see above), fixed after an
  // incident where a silently-failing beat (never checked res.ok — a 401
  // from an expired-but-cached session token, or any other non-2xx, was
  // indistinguishable from success) left agent_status.updated_at stale while
  // the panel showed nothing wrong at all.
  //
  // Deliberately NOT gated on document.visibilityState for the INTERVAL
  // itself (unlike makePollingFallback's read-refresh use of that check
  // elsewhere in this file) — a heartbeat's whole job is to prove liveness
  // precisely while nobody is looking at the tab. Gating it on visibility
  // would make an agent who is genuinely available, just on another tab,
  // silently stop being routable within 90s, and the honest failure mode
  // ("אין נציג זמין") would fire with a ready agent sitting right there.
  // Background-tab timer throttling can still delay a beat by tens of
  // seconds under some browsers — the visibilitychange listener below fires
  // an immediate catch-up beat the moment the tab is looked at again,
  // supplementing (never replacing) the interval, so a throttled run of
  // missed beats self-heals as soon as anyone would notice the console at
  // all.
  useEffect(() => {
    if (phoneSnap.state !== 'logged_in') return;
    // 'in_call' is system-managed and rejected by the route (400) — never
    // re-POST it. A null selfStatus means the initial read hasn't landed yet.
    if (!selfStatus || selfStatus === 'in_call') return;
    const supabase = createClient();
    const beat = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch('/api/agents/status', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: selfStatus }),
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`heartbeat POST ${res.status}`);
        heartbeatFailureStreak.current = 0;
        setHeartbeatDegraded(false);
      } catch {
        // Best-effort — the next tick (interval or a visibility catch-up)
        // retries. Three consecutive misses (~3 missed intervals, comfortably
        // past AGENT_STATUS_FRESHNESS_MS's 90s window) is treated as a real
        // problem worth surfacing, not transient network noise.
        heartbeatFailureStreak.current += 1;
        if (heartbeatFailureStreak.current >= 3) setHeartbeatDegraded(true);
      }
    };
    // Fire one beat immediately on the transition into logged_in — WITHOUT
    // this, a freshly-connected agent (manual click OR wake-and-answer
    // auto-connect) sits outside AGENT_STATUS_FRESHNESS_MS's <90s window for
    // up to 60s before the first interval tick, during which
    // findRoutableAgents() (and this feature's own route-inbound-retry) will
    // not see them as routable — a real latent gap this fix closes for both
    // paths, not only the new one (wake-and-answer research, 12.8).
    void beat();
    const id = setInterval(() => void beat(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phoneSnap.state, selfStatus]);

  // Active customer call (stage 8 — customer-card auto-open). Watches MY OWN
  // live console_calls rows (agent_id OR transferred_to_agent_id = me, since
  // a transferred-in call is just as much "my" active call). console_calls
  // carries no PII (caller_masked only) — the guest's name/RSVP/phone comes
  // from console_event_guests, whose `phone` column is itself gated on
  // view_customer_data (project rule: never fetch privileged data client-side
  // beyond what the view already authorizes).
  const [activeCall, setActiveCall] = useState<ActiveConsoleCall | null>(null);
  const [activeGuest, setActiveGuest] = useState<GuestCardRow | null>(null);
  // Tracks which call id the auto-open already fired for, so it triggers on
  // the RISING EDGE into a new active call only — not on every refresh. This
  // subscription refetches on ANY console_calls change table-wide (every
  // agent's every call), so without this an agent who closes the panel
  // mid-call would have it forced back open on the next unrelated tick.
  const autoOpenedForCallId = useRef<string | null>(null);

  useEffect(() => {
    if (!selfUserId) return;
    const supabase = createClient();
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase
        .from('console_calls')
        .select('id, status, event_id, guest_id, contact_id, direction, caller_masked')
        .in('status', ['ringing', 'connected'])
        .or(`agent_id.eq.${selfUserId},transferred_to_agent_id.eq.${selfUserId}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;

      if (!data || !data.event_id || !data.guest_id) {
        setActiveCall(null);
        setActiveGuest(null);
        autoOpenedForCallId.current = null;
        return;
      }
      setActiveCall({
        id: data.id,
        status: data.status,
        eventId: data.event_id,
        guestId: data.guest_id,
        contactId: data.contact_id,
        direction: data.direction,
        callerMasked: data.caller_masked,
      });
      // Auto-open ONLY on the transition into this (new) active call — a live
      // customer call is exactly the moment the panel must surface itself,
      // not wait for the agent to notice and click the icon. An agent who
      // deliberately closes the panel again mid-call is not fought with on
      // the next refresh of the SAME call.
      if (autoOpenedForCallId.current !== data.id) {
        autoOpenedForCallId.current = data.id;
        setOpen(true);
      }

      const { data: guestRow } = await supabase
        .from('console_event_guests')
        .select('guest_id, event_id, guest_name, rsvp_status, phone')
        .eq('event_id', data.event_id)
        .eq('guest_id', data.guest_id)
        .maybeSingle();
      if (!cancelled) setActiveGuest(guestRow ?? null);
    }

    refresh();
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
  }, [selfUserId]);

  // Internal chat (plan "שלב 2") — state lifted to the panel body rather than
  // owned by ChatSection itself, on purpose: the closed-state FAB button
  // below needs to show an unread badge, and ChatSection only mounts while
  // `open` is true (see the early `if (!open)` return below — none of the
  // open-only child sections stay alive while collapsed). Lifting the load +
  // Realtime subscription here means it keeps running, and counting unread
  // messages, even while the panel is collapsed.
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  // Read watermark — client-local only (no schema for per-agent read state
  // was requested; this resets on reload/across devices, which is an
  // accepted limitation for a V1 unread indicator, not an oversight).
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const lastReadInitialized = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function loadMessages() {
      const { data, error } = await supabase
        .from('console_chat_messages')
        .select('id, author_id, body, created_at')
        .order('created_at', { ascending: true })
        .limit(200);
      if (cancelled || error || !data) return;
      setChatMessages(
        data.map((m) => ({
          id: m.id,
          authorId: m.author_id,
          body: m.body,
          createdAt: m.created_at,
        })),
      );
      setChatLoaded(true);
      // Only ever runs ONCE (guarded by the ref) — existing history at first
      // load is never "unread"; only messages that arrive after this point
      // count.
      if (!lastReadInitialized.current) {
        lastReadInitialized.current = true;
        const latest = data[data.length - 1];
        setLastReadAt(latest ? latest.created_at : new Date().toISOString());
      }
    }

    void loadMessages();
    let stopPolling: (() => void) | null = null;
    const stopRealtime = subscribeChatMessages(() => void loadMessages(), (status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        stopPolling?.();
        stopPolling = null;
        return;
      }
      if (!stopPolling) stopPolling = makePollingFallback(() => void loadMessages(), 30_000);
    });

    return () => {
      cancelled = true;
      stopRealtime();
      stopPolling?.();
    };
  }, []);

  // Mark-as-read: while the panel is OPEN, every message currently loaded is
  // treated as seen — the watermark advances to the newest one. While
  // collapsed this effect simply doesn't re-run against new messages (no
  // dependency changes it), so the watermark freezes and unreadChatCount
  // below starts climbing. Deferred by a macrotask (readSavedNode precedent,
  // above): setting state straight inside the effect body would set state
  // synchronously during the same commit (cascading render).
  useEffect(() => {
    if (!open || chatMessages.length === 0) return;
    const latest = chatMessages[chatMessages.length - 1].createdAt;
    const timer = setTimeout(() => {
      setLastReadAt((prev) => (prev && prev >= latest ? prev : latest));
    }, 0);
    return () => clearTimeout(timer);
  }, [open, chatMessages]);

  const unreadChatCount = useMemo(
    () => computeUnreadChatCount(chatMessages, selfUserId, lastReadAt),
    [chatMessages, lastReadAt, selfUserId],
  );

  const onConnect = useCallback(async () => {
    if (!node) return;
    setPhoneBusy(true);
    try {
      await connectAndLogin({ voxUsername, node, fetchHash: fetchConsoleSdkAuthHash });
    } catch {
      // The snapshot already carries the honest error state (web-client.ts).
    } finally {
      setPhoneBusy(false);
    }
  }, [node, voxUsername]);

  const onDisconnect = useCallback(async () => {
    setPhoneBusy(true);
    try {
      await disconnectPhone();
    } finally {
      setPhoneBusy(false);
    }
  }, []);

  const setPresence = useCallback(async (status: 'ready' | 'not_ready' | 'dnd') => {
    setStatusBusy(true);
    setStatusError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('אין session פעיל — יש להתחבר מחדש למערכת');
      const res = await fetch('/api/agents/status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('עדכון הסטטוס נכשל');
      // Optimistic ONLY after a confirmed 2xx — no state the server hasn't
      // actually accepted yet (save_rsvp 'queued' precedent: never fake it).
      setSelfStatus(status);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'עדכון הסטטוס נכשל');
    } finally {
      setStatusBusy(false);
    }
  }, []);

  // "On shift" toggle (wake-and-answer research, 12.8) — same optimistic-
  // only-after-2xx discipline as setPresence above, own busy/error state so
  // a failed toggle write never gets confused with a failed presence write.
  const setShift = useCallback(async (active: boolean) => {
    setShiftBusy(true);
    setShiftError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('אין session פעיל — יש להתחבר מחדש למערכת');
      const res = await fetch('/api/agents/shift', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('עדכון המשמרת נכשל');
      setShiftActive(active);
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : 'עדכון המשמרת נכשל');
    } finally {
      setShiftBusy(false);
    }
  }, []);

  // Deep-link auto-open (wake-and-answer research, 12.8) — the panel opens
  // whenever the page was reached via a call-alert push (see
  // notifyRoutableAgentsOfInboundCall/notifyOffDutyShiftAgentsOfInboundCall's
  // url=`/admin?call=<id>`), independent of every flag below: surfacing the
  // panel is harmless UI, unlike auto-connecting the SDK.
  useEffect(() => {
    if (!hasWakeCallParam) return;
    // Deferred by a macrotask (readSavedNode precedent, above) — setting
    // state straight inside the effect body would set state synchronously
    // during the same commit (cascading render).
    const timer = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(timer);
  }, [hasWakeCallParam]);

  // Auto-connect on launch (wake-and-answer research, 12.8; the actual
  // capability this whole panel exists for): a woken agent who still has to
  // find and click "התחברות" gains nothing over one who never got woken at
  // all. Gated on wakeEnabled (server operational switch, default OFF until
  // the owner verifies real-device latency) AND EITHER an explicit standing
  // shift intent (shiftActive, bounded-fresh) OR having just arrived via a
  // genuine call-notification deep link (hasWakeCallParam) — never on a bare
  // page view with neither signal, matching "don't reconnect on every random
  // page view". Attempted at most ONCE per mount (autoConnectAttempted) so a
  // failed attempt (state settles on 'error', not 'idle') never loops, and a
  // later disconnect during the SAME session is never silently re-connected
  // behind the agent's back.
  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (!wakeEnabled) return;
    if (!shiftActive && !hasWakeCallParam) return;
    if (!node || phoneSnap.state !== 'idle' || phoneBusy) return;
    if (autoConnectAttempted.current) return;
    autoConnectAttempted.current = true;
    void (async () => {
      await onConnect();
      // onConnect's own snapshot is the honest source of truth — only
      // promote business presence to 'ready' once the SDK genuinely reports
      // logged_in, never optimistically alongside the connect attempt.
      if (getPhoneSnapshot().state === 'logged_in') {
        await setPresence('ready');
      }
    })();
  }, [wakeEnabled, shiftActive, hasWakeCallParam, node, phoneSnap.state, phoneBusy, onConnect, setPresence]);

  if (!open) {
    return (
      <div className="fixed bottom-4 start-4 z-40">
        <Button
          type="button"
          size="icon-lg"
          variant="default"
          // The dot is the SDK connection state ONLY (never business presence
          // — the two axes are never merged, see the badges below once open).
          // Named explicitly here so it never reads as "I'm available".
          aria-label={
            `פתיחת קונסולת הנציג — חיבור טלפוניה: ${PHONE_STATE_LABEL[phoneSnap.state]}` +
            (unreadChatCount > 0 ? ` — ${unreadChatCount} הודעות צ׳אט שלא נקראו` : '')
          }
          onClick={() => setOpen(true)}
          className="relative shadow-lg"
        >
          <Headset />
          <span
            aria-hidden
            className={cn(
              'absolute -top-0.5 -end-0.5 size-2.5 rounded-full ring-2 ring-background',
              phoneSnap.state === 'logged_in'
                ? 'bg-emerald-500'
                : phoneSnap.state === 'error' || phoneSnap.state === 'other_tab'
                  ? 'bg-red-500'
                  : phoneSnap.state === 'idle' || phoneSnap.state === 'disconnected'
                    ? 'bg-slate-400'
                    : 'bg-amber-500',
            )}
          />
          {/* Unread chat badge — the opposite corner from the phone-state
              dot above, so the two axes (telephony connection vs. unread
              team chat) never visually merge into one signal. */}
          {unreadChatCount > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -start-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground ring-2 ring-background"
            >
              {unreadChatCount > 9 ? '9+' : unreadChatCount}
            </span>
          ) : null}
        </Button>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="fixed bottom-4 start-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Headset className="size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">קונסולת נציג</p>
          {displayName ? (
            <p className="truncate text-xs text-muted-foreground">{displayName}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="סגירת קונסולת הנציג"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-4 px-4 py-3">
        {/* Phone connection — technical/SDK axis. */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">חיבור טלפוניה</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={PHONE_STATE_VARIANT[phoneSnap.state] ?? 'neutral'}>
              {PHONE_STATE_LABEL[phoneSnap.state]}
            </Badge>
            {phoneSnap.state === 'logged_in' ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={onDisconnect}
                disabled={phoneBusy}
              >
                <PhoneOff /> ניתוק
              </Button>
            ) : node ? (
              <Button
                type="button"
                size="xs"
                onClick={onConnect}
                disabled={
                  phoneBusy ||
                  phoneSnap.state === 'connecting' ||
                  phoneSnap.state === 'logging_in' ||
                  phoneSnap.state === 'other_tab'
                }
              >
                <Phone /> התחברות
              </Button>
            ) : null}
          </div>
          {!node ? (
            <p className="text-xs text-muted-foreground">
              לא הוגדר Connection Node לדפדפן זה.{' '}
              <Link href="/admin/voice/console" className="underline underline-offset-2">
                הגדירו בקונסולת הנציג
              </Link>
            </p>
          ) : phoneSnap.detail ? (
            <p className="text-xs text-destructive">{phoneSnap.detail}</p>
          ) : null}
          {/* Incoming/outgoing/connected call — driven entirely by the SDK
              CALL snapshot (call-bar.tsx), never optimistic. Lives under the
              same "טלפוניה" section since it's the same technical/SDK axis.
              selfUserId+roster (stage 2) let CallBar offer/target-pick
              consult/conference without a second roster fetch — both are
              already loaded above for the "נציגים" section. */}
          <CallBar
            selfUserId={selfUserId}
            roster={roster}
            consultConferenceEnabled={consultConferenceEnabled}
          />
          {/* Browser push alert for an incoming call — useful precisely when
              this tab is backgrounded or closed, i.e. the moments the SDK
              connection above can't help. Independent of "חיבור טלפוניה":
              an agent can be push-subscribed without being SDK-logged-in
              right now, and vice versa. */}
          <ConsolePushAlertToggle />
          {/* "On shift" toggle (wake-and-answer research, 12.8) — only
              rendered while the server operational switch is on (no point
              offering a control with no effect yet). Distinct from both the
              push toggle above (that only controls whether a notification
              CAN arrive) and the presence buttons below (that is live
              business availability): this is the standing intent that
              drives the auto-connect effect on a future launch, bounded by
              CONSOLE_SHIFT_FRESHNESS_MS server-side so a forgotten toggle
              goes inert within hours. */}
          {wakeEnabled ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={shiftActive ? 'success' : 'neutral'}>
                {shiftActive ? 'במשמרת — חיבור אוטומטי בפתיחה' : 'לא במשמרת'}
              </Badge>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={shiftBusy}
                onClick={() => void setShift(!shiftActive)}
              >
                {shiftActive ? 'סיום משמרת' : 'תחילת משמרת'}
              </Button>
              {shiftError ? <p className="w-full text-xs text-destructive">{shiftError}</p> : null}
            </div>
          ) : null}
        </section>

        {/* Self presence — business axis (agent_status, the authoritative source). */}
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">הסטטוס שלי</h3>
          <div className="flex flex-wrap items-center gap-2">
            {selfStatus === null ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <span className="flex items-center gap-1.5 text-xs">
                <span className={cn('size-2 rounded-full', PRESENCE_DOT[selfStatus])} aria-hidden />
                {PRESENCE_LABEL[selfStatus]}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SETTABLE_PRESENCE.map((opt) => (
              <Button
                key={opt.status}
                type="button"
                size="xs"
                variant={selfStatus === opt.status ? 'default' : 'outline'}
                disabled={statusBusy}
                onClick={() => setPresence(opt.status)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          {statusError ? <p className="text-xs text-destructive">{statusError}</p> : null}
          {/* Honest-UI surface for a struggling heartbeat (see the effect's
              own header comment) — the presence dot above still shows the
              LAST status the operator explicitly set, which may no longer be
              what the server considers fresh once this appears. */}
          {heartbeatDegraded ? (
            <p className="text-xs text-destructive">
              עדכון הזמינות לשרת נכשל שוב ושוב — ייתכן שהמערכת רואה אתכם כלא
              זמינים. בדקו את החיבור לאינטרנט.
            </p>
          ) : null}
          {/* Department queues (plan §10 extension point) — read-only display;
              managed only by an admin at /admin/voice/queues. */}
          {queueMemberships.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground">מחלקות:</span>
              {queueMemberships.map((q) => (
                <span
                  key={q.key}
                  className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px]"
                >
                  {q.nameHe}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {/* Roster — every console agent's business presence + provisioning. */}
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">נציגים</h3>
          {!rosterLoaded ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
          ) : roster.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין נציגים רשומים.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {roster.map((agent) => (
                <li key={agent.userId} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className={cn('size-2 shrink-0 rounded-full', PRESENCE_DOT[agent.status])}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {agent.displayName}
                    {agent.userId === selfUserId ? ' (אני)' : ''}
                  </span>
                  {!agent.provisioned ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      ללא זהות טלפוניה
                    </span>
                  ) : null}
                  <span className="shrink-0 text-muted-foreground">
                    {PRESENCE_LABEL[agent.status]}
                  </span>
                  {/* Calendar-derived, ADVISORY only — never overrides the
                      business-status badge above. loadRoster() above already
                      nulls this out once the window has passed (React's
                      purity rule forbids a fresh Date.now() read here, in
                      render), so a stale label is never shown as current. */}
                  {agent.calendarBusyUntilIso ? (
                    <span
                      className="shrink-0 text-[10px] text-muted-foreground"
                      title="לוח שנה Outlook — אינדיקציה בלבד, אינה חוסמת שיחות"
                    >
                      {CALENDAR_SHOW_AS_LABEL[agent.calendarShowAs ?? ''] ?? 'תפוס'} עד{' '}
                      {formatIsraelTime(agent.calendarBusyUntilIso)}
                    </span>
                  ) : null}
                  <RosterDialButton
                    userId={agent.userId}
                    displayName={agent.displayName}
                    provisioned={agent.provisioned}
                    ready={agent.status === 'ready'}
                    isSelf={agent.userId === selfUserId}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Customer card — auto-opens the panel on a live customer call of MY
            OWN (stage 8). Never rendered from the console_calls row alone:
            console_calls carries no PII, so this waits for the
            console_event_guests fetch before showing anything. */}
        {activeCall ? (
          <section className="space-y-2 border-t border-border pt-3">
            <h3 className="text-xs font-medium text-muted-foreground">שיחה פעילה</h3>
            {activeGuest ? (
              <div className="space-y-1 rounded-md border border-border bg-muted/40 p-2 text-xs">
                <p className="font-medium">{activeGuest.guest_name ?? 'אורח ללא שם'}</p>
                {activeGuest.rsvp_status ? (
                  <p className="text-muted-foreground">
                    {RSVP_STATUS_LABEL[activeGuest.rsvp_status] ?? activeGuest.rsvp_status}
                  </p>
                ) : null}
                {activeGuest.phone ? (
                  <p dir="ltr" className="text-end text-muted-foreground">
                    {activeGuest.phone}
                  </p>
                ) : null}
                <Link
                  href={`/admin/voice/events/${activeCall.eventId}`}
                  className="inline-block text-primary underline underline-offset-2"
                >
                  צפייה בשיחות האירוע
                </Link>
              </div>
            ) : (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
            )}
          </section>
        ) : null}

        {handoffEnabled ? <AiHandoffSection selfUserId={selfUserId} roster={roster} /> : null}

        <ChatSection
          selfUserId={selfUserId}
          roster={roster}
          messages={chatMessages}
          loaded={chatLoaded}
        />
      </div>
    </div>
  );
}
