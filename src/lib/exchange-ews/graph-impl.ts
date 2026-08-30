import 'server-only';

import { ClientCertificateCredential } from '@azure/identity';
import { TZDate } from '@date-fns/tz';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { format } from 'date-fns';
import { findIana } from 'windows-iana';

import { ISRAEL_TIME_ZONE } from '@/lib/date';


import type { ExchangeCalendarProvider, ExchangeErrorCode, ExchangeResult } from './provider';
import type {
  AppointmentDraft,
  AppointmentRecurrence,
  AppointmentSensitivity,
  AppointmentShowAs,
  AvailabilityWindow,
  CalendarSummary,
  ExchangeAppointment,
  ExchangeAppointmentDetail,
  ExchangeCategory,
  ExchangeConnectionConfig,
  MailboxInfo,
} from './types';

// Microsoft Graph implementation of ./provider — now the ONLY one. It replaced
// the EWS implementation (ews-impl.ts, since deleted), because Microsoft starts
// disabling Exchange Web Services in Exchange Online in 10/2026 and disables it
// fully in 04/2027.
//
// TWO THINGS THAT DIFFERED FROM ews-impl AND STILL MATTER — kept because both
// explain why this file is shaped the way it is, not because that file is still
// around to compare against:
//
// 1. Credentials do NOT come from `cfg`. EWS authenticated per-user with a
//    decrypted mailbox password; Graph authenticates ONCE as the application,
//    with a certificate, and `cfg.mailboxEmail` only names WHICH mailbox to
//    act on. `cfg.password`/`cfg.authMethod` are ignored here — deliberately,
//    so the shared interface keeps working while the credential model changes
//    underneath it. The credential is a module-level singleton: MSAL caches
//    and refreshes tokens per credential instance, so rebuilding one per call
//    (as ews-impl does with its service object) would defeat that cache.
//
// 2. Graph is JSON, so xmlSafe() must NOT be applied to anything here. It
//    exists only because the EWS library writes values into SOAP unescaped;
//    running it on a JSON value double-escapes it (`&` becomes `&amp;` in the
//    stored subject). Only HTML BODIES still need escaping, and that is the
//    caller's job exactly as before.

// Read LAZILY, never at module scope. The worker loads .env.local from its own
// module body (worker/main.ts loadEnv()), and imports are evaluated BEFORE that
// body runs — so a module-level `process.env.X` here captures '' and every call
// afterwards fails with graph_config_missing, mapped to auth_failed. That is
// exactly what happened: the calendar sync failed silently in the worker every
// 10 minutes while working perfectly under `node --env-file=`.
function env(name: string): string {
  return process.env[name] ?? '';
}

let cachedClient: Client | null = null;

function graphClient(): Client {
  if (cachedClient) return cachedClient;
  const tenantId = env('MS_GRAPH_TENANT_ID');
  const clientId = env('MS_GRAPH_CLIENT_ID');
  const certPath = env('MS_GRAPH_CERT_PATH');
  if (!tenantId || !clientId || !certPath) {
    throw new Error('graph_config_missing');
  }
  const credential = new ClientCertificateCredential(tenantId, clientId, certPath);
  cachedClient = Client.initWithMiddleware({
    authProvider: new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    }),
  });
  return cachedClient;
}

// --- error mapping ---------------------------------------------------------

// Graph does NOT publish a list of `error.code` strings — verified against
// learn.microsoft.com/graph/errors, which documents the error envelope but
// enumerates no codes. Classification is therefore driven by HTTP status,
// which IS stable and documented, exactly as classifyError() in ews-impl is
// driven by SOAP fault shape rather than message text.
function classifyGraphError(err: unknown): ExchangeErrorCode {
  const status =
    typeof err === 'object' && err !== null && 'statusCode' in err
      ? Number((err as { statusCode: unknown }).statusCode)
      : NaN;

  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'not_found';
  // 429 is retried by the SDK's own middleware before it ever reaches us; if
  // it still surfaces, the retry budget is spent and the service is, for our
  // purposes, unreachable.
  if (status === 429 || (status >= 500 && status <= 599)) return 'unreachable';
  // -1 is @microsoft/microsoft-graph-client's OWN default (GraphError/
  // GraphErrorHandler, verified against the installed 3.0.7 source): it is
  // what GraphRequest.send() passes when the fetch itself never produced a
  // response — no HTTP exchange happened at all (DNS failure, connect
  // timeout, socket reset). It is not a real "the API answered -1" status,
  // so it must be checked BEFORE the generic finite-number fallback below.
  if (status === -1) return 'unreachable';
  if (Number.isFinite(status)) return 'provider_error';

  // No HTTP status at all AND no statusCode key either — same network-failure
  // reasoning as the status===-1 branch above, kept as a defensive fallback.
  // NOTE: in practice this regex rarely matches once an error has already
  // been wrapped into a GraphError — GraphErrorHandler.constructError copies
  // the ORIGINAL error's `.name` (e.g. "TypeError") into `.code`, not its
  // `.code` (e.g. "ECONNRESET") — verified against the installed SDK source.
  // The status===-1 check above is what actually catches this case for
  // Graph-SDK errors; this stays only for a raw, unwrapped network error.
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR/i.test(code)) return 'unreachable';
  if (err instanceof Error && err.message === 'graph_config_missing') return 'auth_failed';
  return 'provider_error';
}

/** Refuses to edit an item that belongs to a recurring series. */
class RecurringUpdateRefusedError extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<ExchangeResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof RecurringUpdateRefusedError) return { ok: false, error: 'recurring_locked' };
    const error = classifyGraphError(err);
    // Bounded diagnostics only — never a body, never a token, never PII.
    console.warn('[graph] call failed', { error, status: (err as { statusCode?: unknown })?.statusCode });
    return { ok: false, error };
  }
}

// --- date conversion -------------------------------------------------------

// WHICH ZONE an event is written in is not a constant — it is the mailbox's
// own setting, the same one Outlook renders by. Hardcoding a zone here is a
// real bug, not a style issue: this mailbox is currently configured to
// `SE Asia Standard Time`, so writing all-day items at Jerusalem midnight
// would put them on the wrong calendar day for the person reading them.
//
// Resolution order: MS_GRAPH_TIME_ZONE (explicit override) → the mailbox's
// own mailboxSettings.timeZone → UTC. Cached per mailbox for the process
// lifetime; a zone change is rare and a restart picks it up.
//
// Graph reports Windows zone names ("SE Asia Standard Time"); Node's Intl and
// @date-fns/tz accept only IANA and throw RangeError on anything else. The
// translation comes from `windows-iana`, which is generated from CLDR — a
// hand-written lookup table here would be a second, staler copy of data that
// already ships maintained.
function toIana(name: string | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.includes('/') || trimmed.toUpperCase() === 'UTC') return trimmed;
  // findIana returns every IANA zone sharing that Windows zone, most
  // representative first; any of them yields the same offset, so take the head.
  return findIana(trimmed)?.[0] ?? null;
}

const zoneCache = new Map<string, string>();

async function mailboxTimeZone(cfg: ExchangeConnectionConfig): Promise<string> {
  const override = toIana(process.env.MS_GRAPH_TIME_ZONE);
  if (override) return override;

  const cached = zoneCache.get(cfg.mailboxEmail);
  if (cached) return cached;
  let zone = 'UTC';
  try {
    const settings = await graphClient().api(`${mailboxPath(cfg)}/mailboxSettings`).select('timeZone').get();
    zone = toIana(settings?.timeZone) ?? 'UTC';
  } catch {
    // A settings read must never take the calendar down with it.
    zone = 'UTC';
  }
  zoneCache.set(cfg.mailboxEmail, zone);
  return zone;
}

// Conversion goes through @date-fns/tz's TZDate — already a dependency and
// already how the calendar UI does exactly this (see
// components/reui/event-calendar/event-calendar-recurrence.tsx).
function toGraphDateTime(d: Date, zone: string): { dateTime: string; timeZone: string } {
  return {
    dateTime: format(new TZDate(d.getTime(), zone), "yyyy-MM-dd'T'HH:mm:ss"),
    timeZone: zone,
  };
}

// An all-day item is a DATE, not an instant, and the date that matters is the
// business one: an RSVP deadline is an Israeli calendar day even when the
// mailbox owner is reading it from another continent. So all-day writes are
// pinned to the business zone, not the mailbox zone.
//
// Graph also REJECTS an all-day item whose start/end are not exactly midnight
// in the zone it is given (HTTP 400) — measured. Snapping to the day removes
// that whole class of failure for `start`.
//
// It does NOT make `end` forgiving, and deliberately so: Graph treats an
// all-day `end` as EXCLUSIVE, so a one-day item ends at the FOLLOWING
// midnight. A caller that passed 23:59 of the same day would snap onto the
// start date and produce a zero-length item. Callers must pass the exclusive
// end — which is what buildRsvpDeadlineDraft does (start + DAY_MS).
function toGraphAllDay(d: Date): { dateTime: string; timeZone: string } {
  return {
    dateTime: `${format(new TZDate(d.getTime(), ISRAEL_TIME_ZONE), 'yyyy-MM-dd')}T00:00:00`,
    timeZone: ISRAEL_TIME_ZONE,
  };
}

// Graph's reply is a wall-clock string plus the zone it belongs to, and that
// zone is NOT always UTC: timed items come back as UTC, but ALL-DAY items are
// echoed in the zone they were written with (measured — an all-day item
// written as Asia/Jerusalem reads back `{dateTime:"…T00:00:00", timeZone:
// "Asia/Jerusalem"}`). Appending "Z" to that would shift it by the offset,
// which near midnight moves the item to the WRONG CALENDAR DAY — exactly the
// failure this function exists to prevent. So the returned zone is honoured.
function fromGraphDateTime(v: { dateTime?: string; timeZone?: string } | undefined): Date {
  if (!v?.dateTime) return new Date(NaN);
  const raw = v.dateTime;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw);

  const zone = v.timeZone;
  if (!zone || /^utc$/i.test(zone)) return new Date(`${raw}Z`);

  // Resolve "this wall clock, in that zone" to a real instant. Reading the
  // string as UTC first gives a value that is wrong by exactly the zone's
  // offset at that moment; measuring that offset and subtracting it lands on
  // the correct instant, DST included (the offset is sampled AT the date in
  // question, not today).
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) return new Date(`${raw}Z`);
  const [, y, mo, d, hh, mi, ss] = m;
  try {
    // Same construction the calendar UI already uses: TZDate built from
    // components interprets them as wall clock IN that zone and resolves the
    // instant, DST included.
    return new Date(new TZDate(+y, +mo - 1, +d, +hh, +mi, +(ss ?? 0), zone).getTime());
  } catch {
    // Unknown zone name — fall back to UTC rather than throwing mid-listing.
    return new Date(`${raw}Z`);
  }
}

// --- enum mapping ----------------------------------------------------------

const SHOW_AS_TO_GRAPH: Record<AppointmentShowAs, string> = {
  free: 'free',
  tentative: 'tentative',
  busy: 'busy',
  oof: 'oof',
  working_elsewhere: 'workingElsewhere',
};

// Graph adds 'unknown', which EWS has no counterpart for. Everything
// unrecognised collapses to 'busy' — the same conservative default ews-impl
// uses, so an unfamiliar value never silently frees up the owner's time.
function showAsFromGraph(v: unknown): AppointmentShowAs {
  switch (String(v)) {
    case 'free':
      return 'free';
    case 'tentative':
      return 'tentative';
    case 'oof':
      return 'oof';
    case 'workingElsewhere':
      return 'working_elsewhere';
    default:
      return 'busy';
  }
}

const SENSITIVITY_TO_GRAPH: Record<AppointmentSensitivity, string> = {
  normal: 'normal',
  personal: 'personal',
  private: 'private',
  confidential: 'confidential',
};

function sensitivityFromGraph(v: unknown): AppointmentSensitivity {
  const s = String(v);
  return s === 'personal' || s === 'private' || s === 'confidential' ? s : 'normal';
}

// EWS exposed a four-way AppointmentType; Graph's `type` carries the same four
// states under different names. Anything that is not a standalone item is
// series-linked and therefore read-only for us.
function isSeriesLinked(type: unknown): boolean {
  return String(type) !== 'singleInstance';
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function buildRecurrence(r: AppointmentRecurrence, start: Date, zone: string) {
  const pattern: Record<string, unknown> = { interval: r.interval };
  switch (r.frequency) {
    case 'daily':
      pattern.type = 'daily';
      break;
    case 'weekly':
      pattern.type = 'weekly';
      pattern.daysOfWeek = (r.daysOfWeek ?? [start.getDay()]).map((d) => WEEKDAYS[d] ?? 'sunday');
      break;
    case 'monthly':
      pattern.type = 'absoluteMonthly';
      pattern.dayOfMonth = r.dayOfMonth ?? start.getDate();
      break;
    case 'yearly':
      pattern.type = 'absoluteYearly';
      pattern.dayOfMonth = r.dayOfMonth ?? start.getDate();
      pattern.month = r.month ?? start.getMonth() + 1;
      break;
  }
  // range.startDate must equal the event's own start date — Graph rejects any
  // other value rather than reinterpreting it.
  const startDate = toGraphDateTime(start, zone).dateTime.slice(0, 10);
  const range: Record<string, unknown> =
    r.occurrences != null
      ? { type: 'numbered', startDate, numberOfOccurrences: r.occurrences }
      : r.endDateIso
        ? { type: 'endDate', startDate, endDate: r.endDateIso.slice(0, 10) }
        : { type: 'noEnd', startDate };
  return { pattern, range };
}

// Only the fields the grid needs; asking for everything wastes payload and
// `createdDateTime`/`lastModifiedDateTime` are documented as not $select-able.
const LIST_SELECT = 'id,subject,start,end,isAllDay,showAs,type';
const DETAIL_SELECT = `${LIST_SELECT},location,body,isReminderOn,reminderMinutesBeforeStart,sensitivity,categories,attendees,recurrence,seriesMasterId`;

function mailboxPath(cfg: ExchangeConnectionConfig): string {
  return `/users/${encodeURIComponent(cfg.mailboxEmail)}`;
}

type GraphEvent = Record<string, unknown>;

function toAppointment(e: GraphEvent): ExchangeAppointment {
  return {
    id: String(e.id ?? ''),
    subject: String(e.subject ?? ''),
    start: fromGraphDateTime(e.start as { dateTime?: string }),
    end: fromGraphDateTime(e.end as { dateTime?: string }),
    allDay: e.isAllDay === true,
    showAs: showAsFromGraph(e.showAs),
    seriesLinked: isSeriesLinked(e.type),
  };
}

function draftToEvent(draft: AppointmentDraft, zone: string): Record<string, unknown> {
  const at = draft.allDay ? toGraphAllDay : (d: Date) => toGraphDateTime(d, zone);
  const body: Record<string, unknown> = {
    subject: draft.subject,
    start: at(draft.start),
    end: at(draft.end),
  };
  if (draft.body !== undefined) {
    body.body = { contentType: draft.bodyIsHtml ? 'html' : 'text', content: draft.body };
  }
  if (draft.allDay) body.isAllDay = true;
  if (draft.showAs) body.showAs = SHOW_AS_TO_GRAPH[draft.showAs];
  if (draft.private) body.sensitivity = 'private';
  if (draft.sensitivity) body.sensitivity = SENSITIVITY_TO_GRAPH[draft.sensitivity];
  if (draft.category) body.categories = [draft.category];
  if (draft.location !== undefined) body.location = { displayName: draft.location };
  if (draft.reminderMinutes !== undefined) {
    body.isReminderOn = draft.reminderMinutes > 0;
    if (draft.reminderMinutes > 0) body.reminderMinutesBeforeStart = draft.reminderMinutes;
  }
  if (draft.attendees?.length) {
    body.attendees = draft.attendees.map((a) => ({
      emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) },
      type: a.optional ? 'optional' : 'required',
    }));
  }
  if (draft.recurrence) body.recurrence = buildRecurrence(draft.recurrence, draft.start, zone);
  return body;
}

// Paging. `@odata.nextLink` is the ONE absolute URL Graph hands back, and the
// installed client (3.0.7) does not reject a URL whose host is smuggled in via
// userinfo (`https://graph.microsoft.com@evil.example/…`) — the upstream fix
// for that is merged but unreleased. So the host is checked here before the
// link is ever followed.
async function followPages(client: Client, firstPath: string, headers?: Record<string, string>): Promise<GraphEvent[]> {
  const out: GraphEvent[] = [];
  let req = client.api(firstPath);
  if (headers) req = req.headers(headers);
  let page = await req.get();
  for (;;) {
    out.push(...((page?.value ?? []) as GraphEvent[]));
    const next = page?.['@odata.nextLink'];
    if (typeof next !== 'string' || out.length >= 1000) break;
    const url = new URL(next);
    if (url.hostname !== 'graph.microsoft.com' || url.username || url.password) break;
    // MEASURED 17.08 against the live mailbox: `url.pathname + url.search`
    // strips the host but LEAVES the API version segment ("/v1.0/…") in the
    // path, and client.api() always prepends its OWN configured version —
    // the request became "/v1.0/v1.0/users/…", which Graph rejected on every
    // page past the first with 400 "Resource not found for the segment
    // 'v1.0'." (silently swallowed by run()'s catch, surfacing only as
    // listAppointments failing once a range held more than $top=300 events).
    // The SDK's own path parser (GraphRequest.parsePath) already strips BOTH
    // the host and the version when handed a string starting with "https://",
    // so passing the full, already-validated `next` URL (not a hand-built
    // substring of it) is the only form that works.
    let nextReq = client.api(next);
    if (headers) nextReq = nextReq.headers(headers);
    page = await nextReq.get();
  }
  return out;
}

// --- provider --------------------------------------------------------------

export const graphProvider: ExchangeCalendarProvider = {
  async testConnection(cfg) {
    return run(async () => {
      const cal = await graphClient().api(`${mailboxPath(cfg)}/calendar`).select('id,name,owner').get();
      const info: MailboxInfo = {
        emailAddress: String(cal?.owner?.address ?? cfg.mailboxEmail),
        displayName: cal?.owner?.name ? String(cal.owner.name) : null,
      };
      return info;
    });
  },

  async listCalendars(cfg) {
    return run(async () => {
      const client = graphClient();
      const res = await client.api(`${mailboxPath(cfg)}/calendars`).select('id,name').get();
      const calendars = (res?.value ?? []) as GraphEvent[];
      // Graph's calendar resource carries no item count (EWS's folder object
      // did), so each count is its own request. They run together rather than
      // in sequence, and the whole block degrades to 0 rather than failing the
      // listing — a count is informational, the calendar list is not.
      const counts = await Promise.all(
        calendars.map(async (c) => {
          try {
            const n = await client
              .api(`${mailboxPath(cfg)}/calendars/${encodeURIComponent(String(c.id ?? ''))}/events/$count`)
              .headers({ ConsistencyLevel: 'eventual' })
              .get();
            return Number(n) || 0;
          } catch {
            return 0;
          }
        }),
      );
      return calendars.map(
        (c, i): CalendarSummary => ({
          id: String(c.id ?? ''),
          displayName: String(c.name ?? ''),
          totalCount: counts[i] ?? 0,
        }),
      );
    });
  },

  async listAppointments(cfg, range) {
    return run(async () => {
      const path =
        `${mailboxPath(cfg)}/calendar/calendarView` +
        `?startDateTime=${encodeURIComponent(range.start.toISOString())}` +
        `&endDateTime=${encodeURIComponent(range.end.toISOString())}` +
        `&$select=${LIST_SELECT}&$top=300&$orderby=start/dateTime`;
      // Prefer: IdType="ImmutableId" — createAppointment() below sets the
      // SAME header, so the id it hands back (and that callers persist, e.g.
      // reconcileCallbacksWithCalendar in callback-scheduling.ts, which later
      // checks `liveIds.has(storedId)` against exactly this list) is in the
      // IMMUTABLE format. Without this header HERE, Graph lists the DEFAULT
      // (mutable) id for the same event — a different string — so that
      // comparison can never match. MEASURED 17.08 against the live mailbox:
      // the same event read back as id "AAMkA…" from an unheadered list vs
      // the "AAkAL…" stored from createAppointment. This is what made every
      // scheduled callback look "gone" on the next reconcile pass, releasing
      // and re-creating it — the mailbox accumulated 553 duplicate
      // appointments this way before the pagination fix above even mattered.
      // getAppointment/updateAppointment/deleteAppointment are unaffected —
      // measured: a direct /events/{id} lookup resolves an immutable id
      // correctly with or without the header; only a LIST-based comparison
      // needs it.
      return (
        await followPages(graphClient(), path, { Prefer: 'IdType="ImmutableId"' })
      ).map(toAppointment);
    });
  },

  async getAvailability(cfg, range) {
    return run(async () => {
      const zone = await mailboxTimeZone(cfg);
      // REAL free/busy, via the availability service itself. ews-impl could
      // not do this: GetUserAvailability returns HTTP 500 /
      // ErrorInternalServerError(127) on the old hosting, so availability
      // there had to be *derived* by listing calendar items and reading each
      // one's LegacyFreeBusyStatus. That workaround is retired here.
      //
      // What it buys beyond the old approach: private and tentative items
      // count toward busy without exposing their content, out-of-office
      // periods are included, and it is one request instead of a paged list.
      const res = await graphClient()
        .api(`${mailboxPath(cfg)}/calendar/getSchedule`)
        .post({
          schedules: [cfg.mailboxEmail],
          startTime: toGraphDateTime(range.start, zone),
          endTime: toGraphDateTime(range.end, zone),
          availabilityViewInterval: 15,
        });
      const items = (res?.value?.[0]?.scheduleItems ?? []) as GraphEvent[];
      return items
        .map((i): AvailabilityWindow => ({
          start: fromGraphDateTime(i.start as { dateTime?: string }),
          end: fromGraphDateTime(i.end as { dateTime?: string }),
          showAs: showAsFromGraph(i.status),
        }))
        .filter((w) => w.showAs !== 'free');
    });
  },

  async createAppointment(cfg, draft) {
    return run(async () => {
      // Immutable ids from the first write: Graph's default id CHANGES when an
      // item moves folder, and exchange_calendar_links stores it as a
      // correlation key with a UNIQUE(event_id) idempotency guard.
      const zone = await mailboxTimeZone(cfg);
      const created = await graphClient()
        .api(`${mailboxPath(cfg)}/events`)
        .headers({ Prefer: 'IdType="ImmutableId"' })
        .post(draftToEvent(draft, zone));
      return { appointmentId: String(created?.id ?? '') };
    });
  },

  async getAppointment(cfg, appointmentId) {
    return run(async () => {
      const e = await graphClient()
        .api(`${mailboxPath(cfg)}/events/${encodeURIComponent(appointmentId)}`)
        // Ask for plain text instead of stripping HTML ourselves.
        .headers({ Prefer: 'outlook.body-content-type="text"', ...{} })
        .select(DETAIL_SELECT)
        .get();
      const detail: ExchangeAppointmentDetail = {
        ...toAppointment(e),
        location: String((e?.location as { displayName?: string })?.displayName ?? ''),
        body: String((e?.body as { content?: string })?.content ?? ''),
        reminderMinutes: e?.isReminderOn ? Number(e.reminderMinutesBeforeStart ?? 0) : null,
        sensitivity: sensitivityFromGraph(e?.sensitivity),
        category: Array.isArray(e?.categories) && e.categories.length ? String(e.categories[0]) : '',
        attendees: (Array.isArray(e?.attendees) ? e.attendees : []).map((a: GraphEvent) => ({
          email: String((a.emailAddress as { address?: string })?.address ?? ''),
          name: (a.emailAddress as { name?: string })?.name,
          optional: String(a.type) === 'optional',
        })),
        recurrenceText: e?.recurrence ? String((e.recurrence as { pattern?: { type?: string } })?.pattern?.type ?? 'סדרה') : null,
      };
      return detail;
    });
  },

  async updateAppointment(cfg, appointmentId, update) {
    return run(async () => {
      const client = graphClient();
      // Server-side series guard. EWS raised this from the library; Graph has
      // no equivalent refusal, so the check is made here explicitly — without
      // it the UI's readOnly flag would be the only barrier and a hand-crafted
      // request would sail past it.
      // `isAllDay` rides along on the guard's read at no extra cost, and it is
      // required: an item that IS all-day must keep being written as one. The
      // RSVP-deadline marker is created with allDay:true, and cancelling an
      // event PATCHes it — so writing its start as a mailbox-zone wall clock
      // would be a non-midnight all-day item, which Graph rejects with 400.
      const current = await client
        .api(`${mailboxPath(cfg)}/events/${encodeURIComponent(appointmentId)}`)
        .select('id,type,isAllDay')
        .get();
      if (isSeriesLinked(current?.type)) throw new RecurringUpdateRefusedError();

      const staysAllDay = update.allDay ?? current?.isAllDay === true;
      const zone = await mailboxTimeZone(cfg);
      const at = staysAllDay ? toGraphAllDay : (d: Date) => toGraphDateTime(d, zone);
      const body: Record<string, unknown> = {
        start: at(update.start),
        end: at(update.end),
      };
      if (update.subject !== undefined) body.subject = update.subject;
      if (update.body !== undefined) {
        body.body = { contentType: update.bodyIsHtml ? 'html' : 'text', content: update.body };
      }
      if (update.location !== undefined) body.location = { displayName: update.location };
      if (update.allDay !== undefined) body.isAllDay = update.allDay;
      if (update.showAs) body.showAs = SHOW_AS_TO_GRAPH[update.showAs];
      if (update.reminderMinutes !== undefined) {
        body.isReminderOn = update.reminderMinutes > 0;
        if (update.reminderMinutes > 0) body.reminderMinutesBeforeStart = update.reminderMinutes;
      }
      if (update.sensitivity) body.sensitivity = SENSITIVITY_TO_GRAPH[update.sensitivity];
      if (update.category !== undefined) body.categories = update.category ? [update.category] : [];
      if (update.attendees) {
        body.attendees = update.attendees.map((a) => ({
          emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) },
          type: a.optional ? 'optional' : 'required',
        }));
      }
      await client.api(`${mailboxPath(cfg)}/events/${encodeURIComponent(appointmentId)}`).patch(body);
    });
  },

  async deleteAppointment(cfg, appointmentId) {
    return run(async () => {
      // Graph sends cancellations to attendees automatically when the item is
      // a meeting — the behaviour ews-impl had to reason about explicitly.
      await graphClient().api(`${mailboxPath(cfg)}/events/${encodeURIComponent(appointmentId)}`).delete();
    });
  },

  async listCategories(cfg) {
    return run(async () => {
      const res = await graphClient().api(`${mailboxPath(cfg)}/outlook/masterCategories`).get();
      // Graph names the colours preset0…preset24; the app indexes into its own
      // palette, so the numeric suffix is what matters.
      return ((res?.value ?? []) as GraphEvent[]).map((c): ExchangeCategory => {
        const m = /^preset(\d+)$/.exec(String(c.color ?? ''));
        return { name: String(c.displayName ?? ''), colorIndex: m ? Number(m[1]) : null };
      });
    });
  },
};
