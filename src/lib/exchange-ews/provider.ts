import 'server-only';

import type {
  AppointmentDraft,
  AppointmentUpdate,
  AvailabilityWindow,
  ExchangeAppointmentDetail,
  CalendarSummary,
  ExchangeAppointment,
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
}
