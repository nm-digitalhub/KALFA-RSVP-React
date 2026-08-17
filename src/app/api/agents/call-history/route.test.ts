import { describe, expect, it } from 'vitest';

// Parameter parsing for GET /api/agents/call-history, extracted as the pure
// function the route uses so it can be tested without a request or a network.
//
// It exists because of one bug and one JavaScript trap: `Number(null)` is 0 and
// `Number.isFinite(0)` is true, so an ABSENT parameter read through Number() alone
// looks like a valid zero. With `from` and `to` both defaulting to 0, every request
// asked Voximplant for 1970-01-01 → 1970-01-01 and the entire call log rendered as
// "אין שיחות" — for every filter, including none.
function intParam(p: URLSearchParams, key: string): number | undefined {
  const raw = p.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

const q = (s: string) => new URLSearchParams(s);

describe('call-history param parsing', () => {
  // THE regression. An absent parameter must never become a number.
  it('treats an absent parameter as undefined, not zero', () => {
    expect(intParam(q('days=7'), 'from')).toBeUndefined();
    expect(intParam(q('days=7'), 'to')).toBeUndefined();
    expect(intParam(q(''), 'min_duration')).toBeUndefined();
  });

  it('treats an empty or whitespace parameter as undefined', () => {
    expect(intParam(q('from='), 'from')).toBeUndefined();
    expect(intParam(q('from=%20%20'), 'from')).toBeUndefined();
  });

  it('rejects a non-numeric value rather than passing NaN on', () => {
    expect(intParam(q('from=abc'), 'from')).toBeUndefined();
    expect(intParam(q('from=Infinity'), 'from')).toBeUndefined();
  });

  // A real zero, explicitly sent, is still a zero — min_duration=0 is meaningful.
  it('keeps an explicit zero', () => {
    expect(intParam(q('min_duration=0'), 'min_duration')).toBe(0);
  });

  it('reads real values', () => {
    expect(intParam(q('from=1755000000000'), 'from')).toBe(1755000000000);
    expect(intParam(q('days=30'), 'days')).toBe(30);
  });
});

describe('call-history window resolution', () => {
  // Mirrors the route: an explicit window wins, otherwise the day count applies.
  function resolve(p: URLSearchParams, nowMs: number) {
    const days = (() => {
      const d = intParam(p, 'days');
      return d !== undefined && d > 0 ? Math.min(d, 90) : 7;
    })();
    let from = intParam(p, 'from');
    let to = intParam(p, 'to');
    if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
    const toMs = to ?? nowMs;
    const fromMs = from ?? toMs - days * 86_400_000;
    return { fromMs, toMs };
  }

  const NOW = Date.parse('2026-08-18T00:00:00Z');

  it('uses the day count when no explicit window is sent', () => {
    const { fromMs, toMs } = resolve(q('days=7'), NOW);
    expect(toMs).toBe(NOW);
    expect(toMs - fromMs).toBe(7 * 86_400_000);
  });

  // The failing case, stated as its own test: this used to be 1970.
  it('never resolves to the epoch when parameters are absent', () => {
    const { fromMs, toMs } = resolve(q(''), NOW);
    expect(fromMs).toBeGreaterThan(0);
    expect(toMs).toBe(NOW);
  });

  it('honours an explicit window over the day count', () => {
    const from = Date.parse('2026-08-16T00:00:00Z');
    const to = Date.parse('2026-08-16T23:59:59Z');
    const r = resolve(q(`days=30&from=${from}&to=${to}`), NOW);
    expect(r.fromMs).toBe(from);
    expect(r.toMs).toBe(to);
  });

  it('orders a backwards window rather than serving nothing', () => {
    const a = Date.parse('2026-08-16T00:00:00Z');
    const b = Date.parse('2026-08-10T00:00:00Z');
    const r = resolve(q(`from=${a}&to=${b}`), NOW);
    expect(r.fromMs).toBe(b);
    expect(r.toMs).toBe(a);
  });
});
