import { cn } from '@/lib/utils';
import type { StationState, StationStates } from '@/lib/rdp-access/status';

// The four stations of the track as four dots, for a table cell. The meaning is also spoken (aria-label) and the
// status column beside it says it in words, so the colours are never the only signal.

const DOT: Record<StationState, string> = {
  done: 'bg-primary',
  current: 'border-2 border-primary bg-background',
  waiting: 'bg-warning',
  upcoming: 'bg-border',
  stopped: 'bg-destructive',
};

export function ProgressDots({ states, label }: { states: StationStates; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-1">
      {states.map((state, index) => (
        <span key={index} aria-hidden className={cn('size-3 rounded-full', DOT[state])} />
      ))}
    </span>
  );
}
