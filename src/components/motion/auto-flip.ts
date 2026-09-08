// Pure scheduling rule for FlipCard's automatic flip (unit-tested in
// auto-flip.test.ts; the DOM wiring lives in flip-card.tsx).
//
// Owner's iPhone recording over 4G (2026-09-08): the front face still showed
// the tinted image placeholder ~1s after load and the 1.4s auto-flip fired
// BEFORE the invitation had painted — the guest never saw the invitation
// before the card turned. So when the front face carries an image, the flip
// waits for that image and then dwells on it; a card without an image keeps
// the plain timer; an image that fails falls back to the plain timer counted
// from mount; an image that is still pending schedules nothing (the load /
// error event schedules it — a stalled image never hides the invitation).

export type FrontImageState = 'none' | 'pending' | 'loaded' | 'failed';

export interface AutoFlipTiming {
  /** Plain delay from mount when there is no image (or it failed). */
  autoFlipMs: number;
  /** Minimum time the loaded image stays on screen before the flip. */
  dwellMs: number;
}

/** Reads the state of the front face's image without touching layout. */
export function frontImageState(img: Pick<HTMLImageElement, 'complete' | 'naturalWidth'> | null): FrontImageState {
  if (!img) return 'none';
  if (!img.complete) return 'pending';
  return img.naturalWidth > 0 ? 'loaded' : 'failed';
}

/**
 * Milliseconds to wait from NOW before flipping, or null = do not schedule
 * (wait for the image's load/error event). `sinceMs` is how long ago the
 * relevant moment happened: mount for 'none'/'failed', the image becoming
 * visible for 'loaded'.
 */
export function autoFlipDelay(
  state: FrontImageState,
  sinceMs: number,
  { autoFlipMs, dwellMs }: AutoFlipTiming,
): number | null {
  switch (state) {
    case 'pending':
      return null;
    case 'loaded':
      return Math.max(0, dwellMs - sinceMs);
    case 'none':
    case 'failed':
      return Math.max(0, autoFlipMs - sinceMs);
  }
}
