// Pure helpers for the countdowns on /admin/rdp-access. No clock here: callers pass the instants, so a test can
// pin them and the browser can correct for a device clock that disagrees with the server's.

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:MM:SS` (or `MM:SS` when `hours` is false), never negative, rounded UP so "0 seconds left" means expired. */
export function formatCountdown(remainingMs: number, opts: { hours: boolean }): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return opts.hours ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h * 60 + m)}:${pad(s)}`;
}

/** Share of the window still left, as a whole percent in 0..100. */
export function percentLeft(remainingMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((remainingMs / totalMs) * 100)));
}

/** A spoken form for screen readers: "58 דקות ו-12 שניות". */
export function spokenRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} שניות`;
  if (seconds === 0) return `${minutes} דקות`;
  return `${minutes} דקות ו-${seconds} שניות`;
}
