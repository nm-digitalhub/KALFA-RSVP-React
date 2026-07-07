// Shabbat + Yom-Tov blocked intervals (candle-lighting → havdalah) from
// @hebcal/core, for the outreach send-window. Uses the location's default
// candle-lighting (40 min before sunset in Jerusalem) and the default havdalah
// (8.5° / three stars) — both verified against hebcal 6.6.0. `HebrewCalendar.
// calendar()` is deterministic for an explicit start/end range. Fast days
// (Tzom) are NOT blocked — only Shabbat/Yom-Tov (categories candles/havdalah).
//
// A chag adjacent to Shabbat emits several candle-lightings before a single
// havdalah; we MERGE (a candle opens a block only if none is open, havdalah
// closes it) so the whole run is one blocked interval.

import { HebrewCalendar, Location } from '@hebcal/core';

export interface BlockedCalendar {
  /** true when the instant falls inside a Shabbat/Yom-Tov (candle→havdalah). */
  isBlocked(ms: number): boolean;
  /** the havdalah instant that ends the block containing ms; ms if not blocked. */
  nextClear(ms: number): number;
  /** start of the next block at/after ms (Infinity if none) — caps a spread. */
  nextBlockedStart(ms: number): number;
  /**
   * The earliest instant ≥ ms at which sending is allowed w.r.t. the calendar,
   * honouring the post-havdalah resume delay. If ms is inside a block OR inside
   * the [havdalah, havdalah+resumeDelay) gap → havdalah+resumeDelay; else ms.
   * (So a planned time 10 min after havdalah does NOT bypass motzashPlusMin.)
   */
  nextAllowedAt(ms: number, resumeDelayMs: number): number;
}

interface Interval {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;

export function buildJewishCalendar(
  fromMs: number,
  toMs: number,
  opts?: { location?: string },
): BlockedCalendar {
  const loc =
    Location.lookup(opts?.location ?? 'Jerusalem') ?? Location.lookup('Jerusalem');
  const events = HebrewCalendar.calendar({
    // Pad so a block straddling either edge is fully captured.
    start: new Date(fromMs - 3 * DAY_MS),
    end: new Date(toMs + 3 * DAY_MS),
    location: loc ?? undefined,
    candlelighting: true,
    il: true,
  });

  type Bound = { t: number; open: boolean };
  const bounds: Bound[] = [];
  for (const ev of events) {
    const time = (ev as { eventTime?: Date }).eventTime;
    if (!time) continue;
    const cats = ev.getCategories?.() ?? [];
    if (cats.includes('candles')) bounds.push({ t: time.getTime(), open: true });
    else if (cats.includes('havdalah')) bounds.push({ t: time.getTime(), open: false });
  }
  bounds.sort((a, b) => a.t - b.t);

  const intervals: Interval[] = [];
  let openAt: number | null = null;
  for (const b of bounds) {
    if (b.open) {
      if (openAt === null) openAt = b.t; // intermediate candle-lightings merge
    } else if (openAt !== null) {
      intervals.push({ start: openAt, end: b.t });
      openAt = null;
    }
  }

  return {
    isBlocked(ms) {
      return intervals.some((i) => ms >= i.start && ms < i.end);
    },
    nextClear(ms) {
      const i = intervals.find((iv) => ms >= iv.start && ms < iv.end);
      return i ? i.end : ms;
    },
    nextBlockedStart(ms) {
      let best = Infinity;
      for (const i of intervals) if (i.start >= ms && i.start < best) best = i.start;
      return best;
    },
    nextAllowedAt(ms, resumeDelayMs) {
      // Inside a block (ms < end) OR inside the resume gap (end ≤ ms < end+delay)
      // → not allowed until havdalah + resumeDelay. Intervals are merged and
      // non-overlapping, so at most one matches.
      for (const i of intervals) {
        if (ms >= i.start && ms < i.end + resumeDelayMs) return i.end + resumeDelayMs;
      }
      return ms;
    },
  };
}
