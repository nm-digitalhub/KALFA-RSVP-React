import 'server-only';

import { ewsProvider } from './ews-impl';
import { graphProvider } from './graph-impl';
import type { ExchangeCalendarProvider, ExchangeResult } from './provider';

// The single place that decides WHICH calendar backend the app talks to.
//
// Every caller outside src/lib/exchange-ews/ must import `calendarProvider`
// from here — never ./ews-impl or ./graph-impl directly. That is what makes
// the cutover (and the rollback) a config change instead of a deploy.
//
// Selection is by environment variable rather than a DB column so that
// switching back does not depend on the database being reachable — the most
// likely moment to need a rollback is the moment something is already broken.
//
//   EXCHANGE_PROVIDER=graph   Microsoft 365 via Graph (default)
//   EXCHANGE_PROVIDER=ews     legacy IONOS Hosted Exchange via EWS
//   EXCHANGE_PROVIDER=off     every call fails fast, nothing is contacted
export type CalendarProviderName = 'graph' | 'ews' | 'off';

export function selectedCalendarProvider(): CalendarProviderName {
  const raw = (process.env.EXCHANGE_PROVIDER ?? 'graph').trim().toLowerCase();
  return raw === 'ews' || raw === 'off' ? raw : 'graph';
}

// The kill switch returns 'provider_error', deliberately NOT 'not_found':
// deleteAvailabilityBlock (exchange-availability.ts) and
// deleteMyExchangeCalendarEvent (exchange-connections.ts) both treat
// 'not_found' as "already gone" and delete OUR row for it. Reporting a
// disabled provider that way would quietly destroy correlation rows while the
// appointments stayed alive in the mailbox. 'provider_error' is also one of
// the five values the console_agent_calendar_presence CHECK constraint
// accepts, so the presence cron can still record the tick.
const disabled = async <T>(): Promise<ExchangeResult<T>> => ({ ok: false, error: 'provider_error' });

const offProvider: ExchangeCalendarProvider = {
  testConnection: disabled,
  listCalendars: disabled,
  listAppointments: disabled,
  getAvailability: disabled,
  createAppointment: disabled,
  updateAppointment: disabled,
  getAppointment: disabled,
  deleteAppointment: disabled,
  listCategories: disabled,
};

// Resolved per call, not captured at module load: a process that has been up
// for days must pick up a changed value on restart without any code path
// holding a stale reference.
function active(): ExchangeCalendarProvider {
  switch (selectedCalendarProvider()) {
    case 'ews':
      return ewsProvider;
    case 'off':
      return offProvider;
    default:
      return graphProvider;
  }
}

export const calendarProvider: ExchangeCalendarProvider = {
  testConnection: (cfg) => active().testConnection(cfg),
  listCalendars: (cfg) => active().listCalendars(cfg),
  listAppointments: (cfg, range) => active().listAppointments(cfg, range),
  getAvailability: (cfg, range) => active().getAvailability(cfg, range),
  createAppointment: (cfg, draft) => active().createAppointment(cfg, draft),
  updateAppointment: (cfg, id, update) => active().updateAppointment(cfg, id, update),
  getAppointment: (cfg, id) => active().getAppointment(cfg, id),
  deleteAppointment: (cfg, id) => active().deleteAppointment(cfg, id),
  listCategories: (cfg) => active().listCategories(cfg),
};
