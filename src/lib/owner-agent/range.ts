import { ilWallTimeToIso, todayIL } from '@/lib/data/event-date';

// The ONLY input an owner-agent read tool accepts (plan §5: "no free input,
// only a range enum"). The model picks one of these three literals and nothing
// else — no ids, no names, no free text reach a query.
export const OWNER_AGENT_RANGES = ['today', '7d', '30d'] as const;
export type OwnerAgentRange = (typeof OWNER_AGENT_RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

// Start instant (ISO, UTC) of a range, for `created_at >= start` filters on
// timestamptz columns.
//
//   today — since midnight TODAY in Israel (Asia/Jerusalem), built from the
//           project's event-date helpers: todayIL() gives the Israel calendar
//           day and ilWallTimeToIso() attaches the DST-correct offset. Never a
//           UTC midnight and never a slice(0, 10) of a timestamptz.
//   7d    — rolling 7 × 24h ending now.
//   30d   — rolling 30 × 24h ending now.
//
// The rolling definition for 7d/30d is deliberate: it is the definition the
// /admin/voice page already uses for its "7 ימים" tiles (voice-ops.ts,
// `nowMs - 7 * 24h`), so the agent and that page agree on the same number.
//
// Known edge: ilWallTimeToIso() probes the UTC offset at NOON of the given day,
// so on the two DST-switch days a year the computed Israel midnight is off by
// one hour (the switch happens at 02:00, after midnight). Accepted: a one-hour
// skew on two days a year in an aggregate count.
export function rangeStartIso(range: OwnerAgentRange, nowMs: number): string {
  switch (range) {
    case 'today':
      return new Date(ilWallTimeToIso(todayIL(nowMs), '00:00')).toISOString();
    case '7d':
      return new Date(nowMs - 7 * DAY_MS).toISOString();
    case '30d':
      return new Date(nowMs - 30 * DAY_MS).toISOString();
  }
}
