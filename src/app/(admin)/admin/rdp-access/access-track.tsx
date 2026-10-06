import { Check, Download, Hourglass, Plug, Send, ShieldCheck, X, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TRACK_STATIONS, type TrackStationId } from '@/lib/rdp-access/copy';
import type { StationState, StationStates } from '@/lib/rdp-access/status';

// The four-station track the whole screen is built around (request → owner's approval → connection file →
// connected). It carries no behavior: the page decides which station is where and passes the states in. Colour is
// never the only signal: every station has an icon, a label, and the current one is announced with aria-current.

const ICON: Record<TrackStationId, LucideIcon> = {
  request: Send,
  approval: ShieldCheck,
  file: Download,
  connected: Plug,
};

const STATE_TEXT: Record<StationState, string> = {
  done: 'הושלם',
  current: 'השלב הנוכחי',
  waiting: 'ממתין',
  upcoming: 'עוד לא',
  stopped: 'נעצר',
};

function circleClass(state: StationState): string {
  switch (state) {
    case 'done':
      return 'bg-primary text-primary-foreground';
    case 'current':
      return 'border-[3px] border-primary bg-background text-primary ring-[6px] ring-primary/15';
    case 'waiting':
      return 'border-[3px] border-warning bg-background text-warning ring-[6px] ring-warning/15';
    case 'stopped':
      return 'bg-destructive text-primary-foreground';
    case 'upcoming':
      return 'border-2 border-border bg-muted text-muted-foreground';
  }
}

function Glyph({ id, state, className }: { id: TrackStationId; state: StationState; className: string }) {
  if (state === 'done') return <Check className={className} strokeWidth={2.5} aria-hidden />;
  if (state === 'stopped') return <X className={className} strokeWidth={2.5} aria-hidden />;
  const Icon = state === 'waiting' ? Hourglass : ICON[id];
  return <Icon className={className} aria-hidden />;
}

/** How far the filled line reaches: from the first station to the last one that is done or current. */
function reachedIndex(states: StationStates): number {
  let reached = 0;
  states.forEach((state, index) => {
    if (state !== 'upcoming' && state !== 'stopped') reached = index;
  });
  return reached;
}

/** The full track with a label and a one-line hint under each station. */
export function AccessTrack({ states, hints }: { states: StationStates; hints: readonly [string, string, string, string] }) {
  const reached = reachedIndex(states);
  return (
    <ol aria-label="שלבי הגישה" className="relative grid grid-cols-4 gap-1 sm:gap-2">
      <div aria-hidden className="absolute inset-x-[12.5%] top-5 h-1 rounded-full bg-border sm:top-[26px]" />
      <div
        aria-hidden
        className="absolute start-[12.5%] top-5 h-1 rounded-full bg-primary sm:top-[26px]"
        style={{ width: `${reached * 25}%` }}
      />
      {TRACK_STATIONS.map((station, index) => {
        const state = states[index]!;
        const muted = state === 'upcoming';
        return (
          <li
            key={station.id}
            aria-current={state === 'current' || state === 'waiting' ? 'step' : undefined}
            className="relative flex flex-col items-center gap-1.5 text-center sm:gap-2.5"
          >
            <span className={cn('inline-flex size-11 items-center justify-center rounded-full sm:size-14', circleClass(state))}>
              <Glyph id={station.id} state={state} className="size-5 sm:size-6" />
            </span>
            <span className="flex flex-col">
              <span className={cn('text-xs font-bold sm:text-[15px]', muted && 'font-semibold text-muted-foreground')}>
                {station.label}
              </span>
              <span className={cn('hidden text-[13px] leading-5 sm:block', muted ? 'text-muted-foreground' : 'text-foreground/70')}>
                {hints[index]}
              </span>
              <span className="sr-only">{STATE_TEXT[state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The short form the finished-request panels use: the same four stations as dots on a line, with the stop marked. */
export function MiniTrack({ states, label }: { states: StationStates; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex max-w-[420px] items-center">
      {TRACK_STATIONS.map((station, index) => {
        const state = states[index]!;
        const previous = states[index - 1];
        return (
          <div key={station.id} className={cn('flex items-center', index > 0 && 'flex-1')}>
            {index > 0 ? (
              <span
                aria-hidden
                className={cn('h-1 flex-1', previous === 'done' && state !== 'upcoming' ? 'bg-primary' : 'bg-border')}
              />
            ) : null}
            <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-full', circleClass(state === 'current' || state === 'waiting' ? 'upcoming' : state))}>
              <Glyph id={station.id} state={state === 'current' || state === 'waiting' ? 'upcoming' : state} className="size-[18px]" />
            </span>
          </div>
        );
      })}
    </div>
  );
}
