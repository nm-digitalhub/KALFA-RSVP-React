'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { CalendarClock, Loader2, RefreshCw, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatIsraelDateTime } from '@/lib/date';
import type {
  AvailabilityBlock,
  PresenceSnapshot,
} from '@/lib/data/exchange-availability';

import {
  clearAvailabilityAction,
  refreshAvailabilityAction,
  removeAvailabilityBlockAction,
  setAvailabilityBlockAction,
  type AvailabilityActionResult,
} from './actions';

// Availability switcher for the admin account menu.
//
// TWO DIRECTIONS, ONE SOURCE OF TRUTH. The displayed state comes from the
// mailbox's own free/busy (Exchange availability service), so a meeting the
// owner books in Outlook on his phone shows here just as surely as a status
// he sets here shows there. Our own table only tracks WHICH constraints this
// app created, so "back to available" removes those and never touches a
// meeting he made himself.
//
// Expiry needs no machinery: a constraint is a time window, so it stops
// applying on its own when it ends.

type ShowAs = AvailabilityBlock['showAs'];

const DOT_CLASS: Record<ShowAs, string> = {
  busy: 'bg-red-500',
  oof: 'bg-purple-500',
  working_elsewhere: 'bg-amber-500',
  tentative: 'bg-slate-400',
};

const AVAILABLE_DOT = 'bg-emerald-500';

const PRESENCE_LABEL: Record<ShowAs, string> = {
  busy: 'תפוס',
  oof: 'מחוץ למשרד',
  working_elsewhere: 'עובד מרחוק',
  tentative: 'טנטטיבי',
};

/** Presets, in menu order. Each computes its own window from "now". */
const PRESETS: {
  key: string;
  showAs: ShowAs;
  label: string;
  window: (now: Date) => { start: Date; end: Date };
}[] = [
  {
    key: 'busy-1h',
    showAs: 'busy',
    label: 'תפוס לשעה',
    window: (now) => ({ start: now, end: new Date(now.getTime() + 60 * 60_000) }),
  },
  {
    key: 'busy-eod',
    showAs: 'busy',
    label: 'תפוס עד סוף היום',
    window: (now) => ({ start: now, end: endOfDay(now) }),
  },
  {
    key: 'oof-morning',
    showAs: 'oof',
    label: 'לא זמין עד מחר בבוקר',
    window: (now) => ({ start: now, end: tomorrowAt(now, 9) }),
  },
  {
    key: 'oof-eod',
    showAs: 'oof',
    label: 'מחוץ למשרד עד סוף היום',
    window: (now) => ({ start: now, end: endOfDay(now) }),
  },
  {
    key: 'remote-today',
    showAs: 'working_elsewhere',
    label: 'עובד מרחוק היום',
    window: (now) => ({ start: now, end: endOfDay(now) }),
  },
];

// Local-clock helpers: these windows are "as the owner experiences the day".
// Stored values are absolute instants, so no timezone ambiguity survives.
function endOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 0, 0);
  return d.getTime() > now.getTime() ? d : new Date(now.getTime() + 60 * 60_000);
}

function tomorrowAt(now: Date, hour: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** The dot on the avatar — driven by live Exchange presence. */
export function AvailabilityDot({
  presence,
  className,
}: {
  presence: PresenceSnapshot;
  className?: string;
}) {
  const busy = presence.showAs !== 'free';
  return (
    <span
      aria-hidden
      className={cn(
        'block size-2.5 rounded-full ring-2 ring-sidebar',
        busy ? DOT_CLASS[presence.showAs as ShowAs] : AVAILABLE_DOT,
        className,
      )}
    />
  );
}

export function AvailabilityMenuSection({
  initialBlocks,
  initialPresence,
  hasConnection,
}: {
  initialBlocks: AvailabilityBlock[];
  initialPresence: PresenceSnapshot;
  hasConnection: boolean;
}) {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>(initialBlocks);
  const [presence, setPresence] = useState<PresenceSnapshot>(initialPresence);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (action: () => Promise<AvailabilityActionResult>) => {
      setError(null);
      startTransition(async () => {
        const result = await action();
        if (result.ok) {
          setBlocks(result.blocks);
          setPresence(result.presence);
        } else {
          setError(result.message);
        }
      });
    },
    [],
  );

  // Pull the live state when the section mounts (i.e. the menu opened) and
  // whenever the window regains focus after a detour to Outlook — the second
  // half of "two-directional": changes made elsewhere land here without a
  // page reload.
  useEffect(() => {
    // Deferred by a macrotask: refreshing straight inside the effect body
    // would set state synchronously during the same commit (cascading
    // render). The server-rendered presence already showed correct state, so
    // a tick of latency here costs nothing.
    const timer = setTimeout(() => run(() => refreshAvailabilityAction()), 0);
    const onFocus = () => run(() => refreshAvailabilityAction());
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [run]);

  // "Upcoming" = blocks that have NOT started yet. Comparing against a
  // mount-time instant was wrong (measured 28.07): a block created seconds
  // after the menu opened starts AFTER that captured instant, so the active
  // block was listed as upcoming too — the same constraint shown twice. The
  // server already tells us which window is in effect (presence.untilIso), so
  // anchor on that instead of on a clock read: a block is upcoming only if it
  // starts after the current one ends.
  const upcoming = useMemo(() => {
    const activeEndsMs = presence.untilIso ? new Date(presence.untilIso).getTime() : null;
    return blocks.filter((b) => {
      const startsMs = new Date(b.startsAtIso).getTime();
      return activeEndsMs === null ? false : startsMs >= activeEndsMs;
    });
  }, [blocks, presence.untilIso]);

  if (!hasConnection) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        חברו תיבת Exchange בהגדרות כדי לנהל סטטוס זמינות.
      </div>
    );
  }

  const busy = presence.showAs !== 'free';
  // Do WE own the constraint currently in effect? The server's ownedByApp can
  // lag by one round trip right after a create, so treat "a block of ours
  // covers the presence window" as authoritative too — otherwise the "back to
  // available" button hides itself right when it is needed most.
  const ownedNow =
    presence.ownedByApp ||
    (presence.untilIso !== null &&
      blocks.some((b) => b.endsAtIso === presence.untilIso));

  return (
    <div className="space-y-1 px-1 py-1">
      <div className="flex items-center gap-2 px-1 pb-1">
        <AvailabilityDot presence={presence} className="ring-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {busy
            ? `${PRESENCE_LABEL[presence.showAs as ShowAs]}${
                presence.untilIso ? ` · עד ${formatIsraelDateTime(presence.untilIso)}` : ''
              }`
            : 'זמין'}
        </span>
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <button
            type="button"
            aria-label="רענון סטטוס"
            onClick={() => run(() => refreshAvailabilityAction())}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {busy && ownedNow ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => clearAvailabilityAction())}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent disabled:opacity-50"
        >
          <span className={cn('size-2.5 rounded-full', AVAILABLE_DOT)} aria-hidden />
          חזרה לזמין
        </button>
      ) : busy ? (
        // Busy because of something the owner scheduled elsewhere — this menu
        // deliberately does not delete meetings it did not create.
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          הסטטוס מגיע מפגישה ביומן. לשינוי — ערכו אותה ביומן עצמו.
        </p>
      ) : (
        PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            disabled={pending}
            onClick={() => {
              const { start, end } = preset.window(new Date());
              run(() =>
                setAvailabilityBlockAction({
                  showAs: preset.showAs,
                  startsAtIso: start.toISOString(),
                  endsAtIso: end.toISOString(),
                }),
              );
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent disabled:opacity-50"
          >
            <span className={cn('size-2.5 rounded-full', DOT_CLASS[preset.showAs])} aria-hidden />
            {preset.label}
          </button>
        ))
      )}

      {upcoming.length > 0 ? (
        <div className="mt-1 border-t border-border pt-1">
          <div className="px-2 py-1 text-[11px] text-muted-foreground">אילוצים קרובים</div>
          {upcoming.map((block) => (
            <div key={block.id} className="flex items-center gap-2 px-2 py-1 text-xs">
              <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {block.label} · {formatIsraelDateTime(block.startsAtIso)}
              </span>
              <button
                type="button"
                aria-label={`ביטול ${block.label}`}
                disabled={pending}
                onClick={() => run(() => removeAvailabilityBlockAction({ blockId: block.id }))}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="px-2 py-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
