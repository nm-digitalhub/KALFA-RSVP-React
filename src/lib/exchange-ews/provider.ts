import 'server-only';

import type {
  AppointmentDraft,
  AppointmentShowAs,
  AppointmentUpdate,
  AvailabilityWindow,
  ExchangeAppointmentDetail,
  CalendarSummary,
  ExchangeAppointment,
  ExchangeCategory,
  ExchangeConnectionConfig,
  MailboxInfo,
} from './types';

// The isolated provider boundary (plan §2.1, plans/exchange-ews-stage1.md).
// Code outside src/lib/exchange-ews/ must import ONLY from this module and
// ./types — never from ./ews-impl or the ews-javascript-api / @ewsjs/xhr
// packages directly. That is what lets the whole integration be replaced or
// dropped without touching a single caller: the library has been unmaintained
// since 5/2024 (plan §8).
//
// A library error (SOAP fault text, stack trace, NTLM handshake detail) NEVER
// crosses this boundary as-is — every failure collapses to one of the codes
// below in ./ews-impl, and nothing raw is logged (plan §5.4).
export type ExchangeErrorCode =
  | 'auth_failed'
  | 'unreachable'
  | 'not_found'
  | 'recurring_locked' // update refused: item belongs to a recurring series (server-side guard)
  | 'provider_error';

export type ExchangeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ExchangeErrorCode };

// Business ranking when several blocking windows overlap "now" — OOF
// outranks Busy outranks WorkingElsewhere outranks Tentative. Mirrors
// exchange-availability.ts's presenceRank() exactly (that module's inline
// copy is left as-is rather than refactored onto this one in this pass —
// it is a live, already-verified admin feature with no regression test
// today, so the duplication is accepted deliberately rather than risked;
// see the calendar-presence-sync report). A future cleanup can point both
// callers at this single copy.
function presenceRank(showAs: AppointmentShowAs): number {
  if (showAs === 'oof') return 3;
  if (showAs === 'busy') return 2;
  if (showAs === 'working_elsewhere') return 1;
  return 0; // tentative, or anything unrecognized
}

/** Availability categories that actually block time — everything but 'free'. */
export type CalendarBusyShowAs = Exclude<AppointmentShowAs, 'free'>;

export type ActiveCalendarWindow = {
  showAs: CalendarBusyShowAs;
  /** When the picked window ends, as epoch milliseconds. */
  endMs: number;
};

/**
 * Pure (no I/O): picks the busiest blocking window in effect at `nowMs` from
 * a set of calendar items, or null when nothing blocks "now".
 *
 * Exists so "what counts as busy right now" is computed identically by every
 * caller that reads a mailbox's calendar for presence — currently
 * exchange-availability.ts's interactive getMyPresence() (inline copy, see
 * the comment on presenceRank above) and
 * console-agent-calendar-presence.ts's unattended worker sync (uses this
 * function directly). Takes the minimal shape getAvailability() already
 * returns rather than the full ExchangeAppointment, so no caller needs to
 * import a wider type than it uses.
 */
export function pickActiveCalendarWindow(
  items: readonly { start: Date; end: Date; showAs: AppointmentShowAs }[],
  nowMs: number,
): ActiveCalendarWindow | null {
  const active = items
    .filter(
      (item) =>
        item.showAs !== 'free' &&
        item.start.getTime() <= nowMs &&
        item.end.getTime() > nowMs,
    )
    .sort((a, b) => presenceRank(b.showAs) - presenceRank(a.showAs))[0];
  if (!active) return null;
  return { showAs: active.showAs as CalendarBusyShowAs, endMs: active.end.getTime() };
}

export interface ExchangeCalendarProvider {
  testConnection(cfg: ExchangeConnectionConfig): Promise<ExchangeResult<MailboxInfo>>;
  listCalendars(cfg: ExchangeConnectionConfig): Promise<ExchangeResult<CalendarSummary[]>>;
  // All expanded calendar items (recurrences pre-expanded by Exchange via
  // CalendarView) intersecting [start, end). Feeds the /admin/calendar UI.
  listAppointments(
    cfg: ExchangeConnectionConfig,
    range: { start: Date; end: Date },
  ): Promise<ExchangeResult<ExchangeAppointment[]>>;
  // The mailbox's own free/busy over a window — the authoritative answer to
  // "is the owner available", regardless of which client created the items.
  getAvailability(
    cfg: ExchangeConnectionConfig,
    range: { start: Date; end: Date },
  ): Promise<ExchangeResult<AvailabilityWindow[]>>;
  createAppointment(
    cfg: ExchangeConnectionConfig,
    draft: AppointmentDraft,
  ): Promise<ExchangeResult<{ appointmentId: string }>>;
  // Times (and optionally subject) of one existing appointment. Bind-fresh
  // then Update(AutoResolve) — see ews-impl. Recurring items are refused at
  // the DAL/UI layer (readOnly), not here.
  updateAppointment(
    cfg: ExchangeConnectionConfig,
    appointmentId: string,
    update: AppointmentUpdate,
  ): Promise<ExchangeResult<void>>;
  // Everything the edit dialog needs for one item (location/body/reminder are
  // not carried by the grid listing — they are fetched on demand).
  getAppointment(
    cfg: ExchangeConnectionConfig,
    appointmentId: string,
  ): Promise<ExchangeResult<ExchangeAppointmentDetail>>;
  deleteAppointment(
    cfg: ExchangeConnectionConfig,
    appointmentId: string,
  ): Promise<ExchangeResult<void>>;
  // The mailbox's master category list — the ONLY place a category's colour
  // exists. Items carry names; this is the lookup Outlook itself performs.
  listCategories(cfg: ExchangeConnectionConfig): Promise<ExchangeResult<ExchangeCategory[]>>;
}
