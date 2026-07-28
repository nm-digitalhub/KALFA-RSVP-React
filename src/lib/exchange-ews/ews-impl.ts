import 'server-only';

import { XhrApi } from '@ewsjs/xhr';
import {
  Appointment,
  AppointmentSchema,
  AppointmentType,
  BasePropertySet,
  CalendarFolder,
  CalendarView,
  ConflictResolutionMode,
  DateTime,
  Attendee,
  DayOfTheWeek,
  Recurrence,
  ItemSchema,
  LegacyFreeBusyStatus,
  Month,
  PropertySet,
  Sensitivity,
  StringList,
  DeleteMode,
  ExchangeService,
  ExchangeVersion,
  FolderTraversal,
  FolderView,
  ItemId,
  BodyType,
  MessageBody,
  SendCancellationsMode,
  SendInvitationsMode,
  SendInvitationsOrCancellationsMode,
  ServiceError,
  Uri,
  UserConfiguration,
  UserConfigurationProperties,
  WebCredentials,
  WellKnownFolderName,
} from 'ews-javascript-api';

import { parseCategoryList } from './category-list';
import { xmlSafe } from './xml-safe';
import type { ExchangeCalendarProvider, ExchangeErrorCode, ExchangeResult } from './provider';
import type {
  AppointmentAttendee,
  AppointmentDraft,
  AppointmentRecurrence,
  AppointmentSensitivity,
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

// The ONLY file in this directory allowed to import ews-javascript-api /
// @ewsjs/xhr (plan §2). Every EWS API call below was verified against the
// installed .d.ts under node_modules/ews-javascript-api and
// node_modules/@ewsjs/xhr — not against memory or the plan's pseudocode —
// per the plan's own instruction (plan §2.2 footnote) and this session's
// mandate to verify against the installed d.ts before writing.
//
// Hard allowlist — plan §5.1 (SSRF). No user input, no per-connection
// override, no Autodiscover: this is the only URL the server ever contacts
// for EWS, exactly as MEASURED live against the account's mailbox config
// (plan §0).
const EWS_ENDPOINT = 'https://exchange.ionos.com/EWS/Exchange.asmx';

class UnsupportedAuthMethodError extends Error {}
// Thrown by updateAppointment when the bound item is part of a recurring
// series — the UI marks those readOnly, and this server-side guard makes the
// refusal hold even against a hand-crafted request (defense in depth).
class RecurringUpdateRefusedError extends Error {}

function buildService(cfg: ExchangeConnectionConfig): ExchangeService {
  if (cfg.authMethod !== 'ntlm') {
    // 'basic' is documented in the schema's check constraint for a possible
    // future method but is NOT implemented in Stage 1 (plan §8) — NTLM is the
    // only method verified live against the IONOS endpoint (plan §7.1).
    throw new UnsupportedAuthMethodError('Only NTLM is implemented in Stage 1');
  }

  // Exchange2016 — NOT V2018_01_08 (MEASURED 27.07, second live failure):
  // the library writes the enum NAME verbatim into the SOAP RequestServerVersion
  // header (ServiceRequestBase.js:183), and the dated V20xx_xx_xx names are
  // Exchange ONLINE schema strings; on-prem Exchange Server (IONOS runs 2019)
  // only recognizes the classic values up to "Exchange2016" and rejects
  // anything else with SoapFaultDetails "The request is invalid." — exactly
  // what the pm2 diagnostic captured. Exchange 2019 has no schema value of
  // its own; Exchange2016 is the correct wire version for it.
  // No Autodiscover — the endpoint is set explicitly below, matching the
  // account's server-explicit iOS config (plan §0).
  const service = new ExchangeService(ExchangeVersion.Exchange2016);
  service.Url = new Uri(EWS_ENDPOINT);
  // Defense-in-depth: never trace/log SOAP request or response bodies (plan
  // §5.4) — a traced body would include the mailbox's calendar content and
  // (on the request side) the auth handshake. Explicit rather than relying on
  // the library's default.
  service.TraceEnabled = false;

  // `{ gzip: true }` from the plan's pseudocode (plan §2.2, citing
  // github.com/ewsjs/xhr#9 and gautamsi/ews-javascript-api#334 — NTLM+EWS
  // responses arrive gzip-encoded and an undecompressed body reads as
  // "invalid tagName" garbage to the XML parser) does NOT exist on the
  // installed @ewsjs/xhr 3.1.3: verified against node_modules/@ewsjs/xhr's
  // xhrApi.d.ts, that package was rewritten off the `request` library onto
  // axios in 2.0.0, and `gzip` is not a key of AxiosRequestConfig. axios's
  // real (typed) equivalent is `decompress` — true by default already, set
  // explicitly here so this stays correct even if that default ever changes
  // upstream. Documented deviation from the plan's literal snippet; see the
  // implementation report.
  // BOTH of these are required (MEASURED 27.07, first live failure): the
  // transport-level NTLM on XhrApi performs the actual handshake, but the
  // library ALSO null-checks service.Credentials before issuing any request —
  // without WebCredentials it throws ServiceLocalException("Credentials are
  // required to make a service request.") locally, before any network I/O.
  service.Credentials = new WebCredentials(cfg.mailboxEmail, cfg.password);
  const xhr = new XhrApi({ decompress: true });
  xhr.useNtlmAuthentication(cfg.mailboxEmail, cfg.password); // user = full mailbox address (UPN), verified live (plan §7.1)
  service.XHRApi = xhr;

  return service; // short-lived — built fresh per call, never cached/reused across requests or users
}

// Best-effort classification of a thrown error into the four ExchangeResult
// codes. INFERRED, not measured: derived from the ews-javascript-api
// exception shapes (the ServiceError enum surfaced via a SOAP fault's
// ErrorCode) and axios's error shape, without ever having made a live call
// against IONOS from this session (forbidden — plan §6 stop-gate). Refine
// against real failures once the owner's live test (stage 1.2+) surfaces
// actual cases; until then this is the safe, conservative default
// ('provider_error' whenever the shape is not confidently recognized).
function classifyError(err: unknown): ExchangeErrorCode {
  if (err instanceof UnsupportedAuthMethodError) return 'provider_error';
  if (err instanceof RecurringUpdateRefusedError) return 'recurring_locked';

  // MEASURED (27.07 diagnostic against the live endpoint with a nonexistent
  // user): an HTTP-level 401 surfaces as SoapFaultDetails with
  // { message: '401 Unauthorized', HttpStatusCode: 401, ErrorCode: 0 } — the
  // ErrorCode is 0 (NoError), so this check MUST run before the ErrorCode
  // branch below or a real auth failure misclassifies as provider_error.
  const soapHttpStatus = (err as { HttpStatusCode?: unknown } | null)?.HttpStatusCode;
  if (soapHttpStatus === 401 || soapHttpStatus === 403) return 'auth_failed';

  // A SOAP-level fault with an EWS ServiceError code (ServiceResponseException
  // shape). Duck-typed on `.ErrorCode` rather than `instanceof` so this also
  // matches subclasses/wrappers the library may throw for the same fault.
  const serviceErrorCode = (err as { ErrorCode?: unknown } | null)?.ErrorCode;
  if (typeof serviceErrorCode === 'number') {
    if (serviceErrorCode === ServiceError.ErrorAccessDenied) return 'auth_failed';
    if (
      serviceErrorCode === ServiceError.ErrorFolderNotFound ||
      serviceErrorCode === ServiceError.ErrorItemNotFound ||
      serviceErrorCode === ServiceError.ErrorNonExistentMailbox
    ) {
      return 'not_found';
    }
    return 'provider_error';
  }

  // HTTP-layer failure from the XHR transport, before EWS ever parses a SOAP
  // fault (e.g. the NTLM handshake itself rejected with 401/403).
  const httpStatus = (err as { response?: { status?: unknown } } | null)?.response?.status;
  if (httpStatus === 401 || httpStatus === 403) return 'auth_failed';

  // No HTTP response reached at all — DNS/connect/timeout failure. axios sets
  // `.request` with no `.response` in this case; Node's underlying socket
  // errors carry a `.code` like these.
  const hasRequestNoResponse =
    !!(err as { request?: unknown } | null)?.request &&
    !(err as { response?: unknown } | null)?.response;
  const networkErrorCode = (err as { code?: unknown } | null)?.code;
  if (
    hasRequestNoResponse ||
    networkErrorCode === 'ECONNREFUSED' ||
    networkErrorCode === 'ENOTFOUND' ||
    networkErrorCode === 'ETIMEDOUT' ||
    networkErrorCode === 'ECONNRESET' ||
    networkErrorCode === 'EAI_AGAIN'
  ) {
    return 'unreachable';
  }

  return 'provider_error';
}

// Every provider call funnels through here: build a fresh service, run the
// call, and collapse ANY thrown value to a classified ExchangeResult. Nothing
// is logged — a library exception can carry SOAP body text (calendar
// content) or auth-handshake detail, and plan §5.4/§5.5 forbid logging either
// (see also the module-level `service.TraceEnabled = false` above). A caller
// that wants an operational log logs the CLASSIFIED code only, never `err`.
async function runProviderCall<T>(
  cfg: ExchangeConnectionConfig,
  fn: (service: ExchangeService) => Promise<T>,
  // Operation label for diagnostics only — never sent to Exchange.
  op = 'unknown',
): Promise<ExchangeResult<T>> {
  try {
    const service = buildService(cfg);
    const data = await fn(service);
    return { ok: true, data };
  } catch (err) {
    const code = classifyError(err);
    // Bounded operational diagnostics (owner request 27.07): the classified
    // code, the error's constructor name, and a TRUNCATED message only —
    // never the error object, stack, SOAP body, or credentials (plan §5.4).
    // Without this line every failure collapses to an opaque code and pm2
    // logs show nothing to debug with.
    // Bounded diagnostics: the classified code, the error's constructor, a
    // truncated message, and — when the message is empty, as SOAP faults
    // sometimes are — the fault's own descriptive fields. Never the SOAP
    // body, never credentials.
    const e = err as {
      constructor?: { name?: string };
      message?: unknown;
      faultString?: unknown;
      errorDetails?: unknown;
      exceptionType?: unknown;
      HttpStatusCode?: unknown;
      ErrorCode?: unknown;
    } | null;
    console.error(
      '[exchange-ews]',
      op,
      code,
      e?.constructor?.name ?? 'unknown',
      String(e?.message ?? '').slice(0, 160),
      '| fault:', String(e?.faultString ?? '').slice(0, 120),
      '| type:', String(e?.exceptionType ?? ''),
      '| http:', String(e?.HttpStatusCode ?? ''),
      '| code:', String(e?.ErrorCode ?? ''),
      '| details:', String(JSON.stringify(e?.errorDetails ?? '')).slice(0, 160),
    );
    return { ok: false, error: code };
  }
}

function toCalendarSummary(folder: CalendarFolder): CalendarSummary {
  return {
    id: folder.Id.UniqueId,
    displayName: folder.DisplayName,
    totalCount: folder.TotalCount,
  };
}

// Bind to the primary Calendar folder. A successful Bind proves both NTLM
// auth AND connectivity in one read-only round trip (plan §6, stage 1.2) —
// nothing is created, changed, or sent.
async function testConnection(cfg: ExchangeConnectionConfig): Promise<ExchangeResult<MailboxInfo>> {
  return runProviderCall(cfg, async (service) => {
    await CalendarFolder.Bind(service, WellKnownFolderName.Calendar);
    return { emailAddress: cfg.mailboxEmail, displayName: null };
  }, 'testConnection');
}

// The primary Calendar folder plus any additional calendar folders nested
// under it (a mailbox can have more than one calendar — "My Calendars" etc.).
// FolderTraversal.Deep walks the whole sub-hierarchy, not just direct
// children, so a calendar nested inside a sub-folder is still found.
async function listCalendars(
  cfg: ExchangeConnectionConfig,
): Promise<ExchangeResult<CalendarSummary[]>> {
  return runProviderCall(cfg, async (service) => {
    const primary = await CalendarFolder.Bind(service, WellKnownFolderName.Calendar);
    const summaries: CalendarSummary[] = [toCalendarSummary(primary)];

    const view = new FolderView(50); // a personal mailbox's calendar sub-folders comfortably fit one page
    view.Traversal = FolderTraversal.Deep;
    const found = await primary.FindFolders(view);
    for (const folder of found.Folders) {
      summaries.push({
        id: folder.Id.UniqueId,
        displayName: folder.DisplayName,
        totalCount: folder.TotalCount,
      });
    }
    return summaries;
  }, 'listCalendars');
}

// Upper bound on items per visible range. A month grid shows ~42 days; even a
// dense business calendar fits comfortably — the cap guards against a
// pathological mailbox flooding the response, not normal use.
const MAX_APPOINTMENTS_PER_RANGE = 300;

// Library DateTime (moment-backed) → plain JS Date via epoch milliseconds —
// timezone-safe by construction (an instant is an instant).
function toJsDate(dt: DateTime): Date {
  return new Date(dt.TotalMilliSeconds);
}

// Our vocabulary → the library enum. Kept here so LegacyFreeBusyStatus never
// crosses the provider boundary (plan §2: only ./ews-impl touches the lib).
const SHOW_AS_TO_EWS: Record<AppointmentShowAs, LegacyFreeBusyStatus> = {
  free: LegacyFreeBusyStatus.Free,
  tentative: LegacyFreeBusyStatus.Tentative,
  busy: LegacyFreeBusyStatus.Busy,
  oof: LegacyFreeBusyStatus.OOF,
  working_elsewhere: LegacyFreeBusyStatus.WorkingElsewhere,
};

// The library enum → our vocabulary (the inverse of SHOW_AS_TO_EWS).
const EWS_TO_SHOW_AS: Record<number, AppointmentShowAs> = {
  [LegacyFreeBusyStatus.Free]: 'free',
  [LegacyFreeBusyStatus.Tentative]: 'tentative',
  [LegacyFreeBusyStatus.Busy]: 'busy',
  [LegacyFreeBusyStatus.OOF]: 'oof',
  [LegacyFreeBusyStatus.WorkingElsewhere]: 'working_elsewhere',
};

// The EXPLICIT property set for FindAppointments results — exactly the five
// fields the DTO consumes, requested by name (owner directive 27.07: never
// rely on the "null PropertySet = first-class defaults" behavior of Find
// operations; be explicit per the installed signatures). IdOnly as the base
// keeps the response minimal; each addition is a verified static on the
// installed AppointmentSchema/ItemSchema d.ts.
const LIST_APPOINTMENTS_PROPERTIES = new PropertySet(BasePropertySet.IdOnly, [
  ItemSchema.Subject,
  AppointmentSchema.Start,
  AppointmentSchema.End,
  AppointmentSchema.IsAllDayEvent,
  AppointmentSchema.IsRecurring,
  AppointmentSchema.AppointmentType,
  AppointmentSchema.LegacyFreeBusyStatus,
]);

// Anything that is not a plain Single appointment (Occurrence / Exception /
// RecurringMaster — the installed AppointmentType enum) is series-linked and
// therefore read-only in this stage. AppointmentType is the authoritative
// classifier (owner directive 27.07): IsRecurring alone does not reliably
// cover Exception items, so it remains only as a belt-and-braces fallback.
function isSeriesLinked(item: Appointment): boolean {
  return item.AppointmentType !== AppointmentType.Single || item.IsRecurring === true;
}

// All expanded items intersecting [start, end). CalendarView makes Exchange
// expand recurring series into concrete occurrences server-side — so the UI
// must NOT run its own recurrence engine on these (double-expansion).
async function listAppointments(
  cfg: ExchangeConnectionConfig,
  range: { start: Date; end: Date },
): Promise<ExchangeResult<ExchangeAppointment[]>> {
  return runProviderCall(cfg, async (service) => {
    const calendar = await CalendarFolder.Bind(service, WellKnownFolderName.Calendar);
    const view = new CalendarView(
      new DateTime(range.start),
      new DateTime(range.end),
    );
    view.MaxItemsReturned = MAX_APPOINTMENTS_PER_RANGE;
    view.PropertySet = LIST_APPOINTMENTS_PROPERTIES;
    const found = await calendar.FindAppointments(view);
    return found.Items.map((item) => ({
      id: item.Id.UniqueId,
      subject: item.Subject ?? '',
      start: toJsDate(item.Start),
      end: toJsDate(item.End),
      allDay: item.IsAllDayEvent === true,
      showAs: EWS_TO_SHOW_AS[item.LegacyFreeBusyStatus] ?? 'busy',
      seriesLinked: isSeriesLinked(item),
    }));
  }, 'listAppointments');
}

const SENSITIVITY_TO_EWS: Record<AppointmentSensitivity, Sensitivity> = {
  normal: Sensitivity.Normal,
  personal: Sensitivity.Personal,
  private: Sensitivity.Private,
  confidential: Sensitivity.Confidential,
};

const EWS_TO_SENSITIVITY: Record<number, AppointmentSensitivity> = {
  [Sensitivity.Normal]: 'normal',
  [Sensitivity.Personal]: 'personal',
  [Sensitivity.Private]: 'private',
  [Sensitivity.Confidential]: 'confidential',
};

// JS weekday numbers (0=Sunday, as getDay() returns) → the library's enum.
const WEEKDAY_TO_EWS: DayOfTheWeek[] = [
  DayOfTheWeek.Sunday,
  DayOfTheWeek.Monday,
  DayOfTheWeek.Tuesday,
  DayOfTheWeek.Wednesday,
  DayOfTheWeek.Thursday,
  DayOfTheWeek.Friday,
  DayOfTheWeek.Saturday,
];

/**
 * Applies our recurrence shape onto the library's pattern objects.
 *
 * The namespace members (Recurrence.DailyPattern etc.) are declared with the
 * NO-ARGUMENT constructor only — verified in the installed d.ts — so every
 * field is assigned through its setter rather than passed in. Same result,
 * and it survives the library's own constructor-overload quirks.
 */
function buildRecurrence(rule: AppointmentRecurrence, start: Date) {
  const startDt = new DateTime(start);
  const interval = Math.max(1, rule.interval);

  if (rule.frequency === 'weekly') {
    const weekly = new Recurrence.WeeklyPattern();
    weekly.StartDate = startDt;
    weekly.Interval = interval;
    const days = (rule.daysOfWeek?.length ? rule.daysOfWeek : [start.getDay()]).map(
      (d) => WEEKDAY_TO_EWS[d] ?? DayOfTheWeek.Sunday,
    );
    for (const day of days) weekly.DaysOfTheWeek.Add(day);
    return applyRecurrenceEnd(weekly, rule);
  }

  if (rule.frequency === 'monthly') {
    const monthly = new Recurrence.MonthlyPattern();
    monthly.StartDate = startDt;
    monthly.Interval = interval;
    monthly.DayOfMonth = rule.dayOfMonth ?? start.getDate();
    return applyRecurrenceEnd(monthly, rule);
  }

  if (rule.frequency === 'yearly') {
    const yearly = new Recurrence.YearlyPattern();
    yearly.StartDate = startDt;
    // Month is 1-based in our contract and in the library's enum (January=1).
    yearly.Month = (rule.month ?? start.getMonth() + 1) as Month;
    yearly.DayOfMonth = rule.dayOfMonth ?? start.getDate();
    return applyRecurrenceEnd(yearly, rule);
  }

  const daily = new Recurrence.DailyPattern();
  daily.StartDate = startDt;
  daily.Interval = interval;
  return applyRecurrenceEnd(daily, rule);
}

/** End condition: after N occurrences, on a date, or never (neither set). */
function applyRecurrenceEnd<T extends { NumberOfOccurrences: number; EndDate: DateTime }>(
  pattern: T,
  rule: AppointmentRecurrence,
): T {
  if (rule.occurrences && rule.occurrences > 0) {
    pattern.NumberOfOccurrences = rule.occurrences;
  } else if (rule.endDateIso) {
    pattern.EndDate = new DateTime(new Date(rule.endDateIso));
  }
  return pattern;
}

/** Human summary of an existing recurrence, for the view dialog. */
function recurrenceToText(recurrence: unknown): string | null {
  if (!recurrence) return null;
  const name = (recurrence as { constructor?: { name?: string } })?.constructor?.name ?? '';
  if (name.includes('Daily')) return 'חוזר מדי יום';
  if (name.includes('Weekly')) return 'חוזר מדי שבוע';
  if (name.includes('Monthly')) return 'חוזר מדי חודש';
  if (name.includes('Yearly')) return 'חוזר מדי שנה';
  return 'אירוע חוזר';
}

/** Writes an attendee list onto an appointment (clearing whatever was there). */
function applyAttendees(appointment: Appointment, attendees: AppointmentAttendee[]): void {
  appointment.RequiredAttendees.Clear();
  appointment.OptionalAttendees.Clear();
  for (const person of attendees) {
    const target = person.optional
      ? appointment.OptionalAttendees
      : appointment.RequiredAttendees;
    if (person.name) target.Add(xmlSafe(person.name), xmlSafe(person.email));
    else target.Add(xmlSafe(person.email));
  }
}

/**
 * The first Outlook category, or '' — the dialog edits a single one.
 *
 * StringList keeps its contents in a PRIVATE `items` field and exposes them
 * through GetEnumerator() (verified in the installed d.ts). Reading `.Items`
 * therefore always yielded undefined, and every appointment came back with no
 * category at all — measured 28.07 on a live item that definitely had one.
 * GetEnumerator first, with the other shapes kept as fallbacks.
 */
function readFirstCategory(item: Appointment): string {
  const list = item.Categories as unknown as
    | { GetEnumerator?: () => string[]; Items?: string[] }
    | string[]
    | undefined;
  if (!list) return '';
  if (Array.isArray(list)) return list[0] ?? '';
  if (typeof list.GetEnumerator === 'function') return list.GetEnumerator()[0] ?? '';
  return list.Items?.[0] ?? '';
}

/** Reads the attendee lists back out. */
function readAttendees(appointment: Appointment): AppointmentAttendee[] {
  const collect = (list: { GetEnumerator?: () => Attendee[] } | Attendee[], optional: boolean) => {
    // Same accessor rule as readFirstCategory: the documented way into an EWS
    // complex collection is GetEnumerator(), not a public `Items` field.
    const items = Array.isArray(list)
      ? list
      : typeof list.GetEnumerator === 'function'
        ? list.GetEnumerator()
        : ((list as unknown as { Items?: Attendee[] }).Items ?? []);
    return items
      .filter((a) => Boolean(a?.Address))
      .map((a) => ({ email: a.Address, name: a.Name || undefined, optional }));
  };
  return [
    ...collect(appointment.RequiredAttendees as never, false),
    ...collect(appointment.OptionalAttendees as never, true),
  ];
}

// MessageBody is an OBJECT, not a string (verified in the installed d.ts: it
// exposes .Text and .BodyType). Coercing it with String() yields the literal
// "[object Object]" — measured in the UI on 28.07. Read .Text, and when the
// body is HTML (Outlook's default) reduce it to readable plain text: the edit
// dialog is a plain <textarea>, so raw markup there is noise the owner would
// have to delete by hand.
function bodyToPlainText(body: unknown): string {
  if (!body) return '';
  const raw =
    typeof body === 'string'
      ? body
      : ((body as { Text?: string }).Text ??
        (typeof (body as { ToString?: () => string }).ToString === 'function'
          ? (body as { ToString: () => string }).ToString()
          : ''));
  if (!raw) return '';
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(raw);
  if (!looksLikeHtml) return raw.trim();
  return raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    // <hr> separates sections in the bodies we compose; without this the
    // blocks either side of it ran together into one paragraph.
    .replace(/<\s*hr\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    // Numeric entities BEFORE the named ones, and &amp; last of all: Exchange
    // encodes a leading "+" as &#43;, and without this the raw entity reached
    // our own UI too. Decoding &amp; first would turn "&amp;#43;" into a live
    // "&#43;" that the numeric pass then wrongly resolves.
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) && n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Everything the edit dialog shows. Explicit, like every other read here —
// never relying on server defaults (owner directive 27.07).
const APPOINTMENT_DETAIL_PROPERTIES = new PropertySet(BasePropertySet.IdOnly, [
  ItemSchema.Subject,
  ItemSchema.Body,
  ItemSchema.Categories,
  ItemSchema.ReminderMinutesBeforeStart,
  ItemSchema.IsReminderSet,
  AppointmentSchema.Start,
  AppointmentSchema.End,
  AppointmentSchema.IsAllDayEvent,
  AppointmentSchema.IsRecurring,
  AppointmentSchema.AppointmentType,
  AppointmentSchema.LegacyFreeBusyStatus,
  AppointmentSchema.Location,
  ItemSchema.Sensitivity,
  AppointmentSchema.RequiredAttendees,
  AppointmentSchema.OptionalAttendees,
  AppointmentSchema.Recurrence,
]);

// One item in full, for the edit dialog.
async function getAppointment(
  cfg: ExchangeConnectionConfig,
  appointmentId: string,
): Promise<ExchangeResult<ExchangeAppointmentDetail>> {
  return runProviderCall(
    cfg,
    async (service) => {
      const item = await Appointment.Bind(
        service,
        new ItemId(appointmentId),
        APPOINTMENT_DETAIL_PROPERTIES,
      );
      return {
        id: item.Id.UniqueId,
        subject: item.Subject ?? '',
        start: toJsDate(item.Start),
        end: toJsDate(item.End),
        allDay: item.IsAllDayEvent === true,
        showAs: EWS_TO_SHOW_AS[item.LegacyFreeBusyStatus] ?? 'busy',
        seriesLinked: isSeriesLinked(item),
        location: item.Location ?? '',
        body: bodyToPlainText(item.Body),
        reminderMinutes: item.IsReminderSet ? item.ReminderMinutesBeforeStart : null,
        sensitivity: EWS_TO_SENSITIVITY[item.Sensitivity] ?? 'normal',
        // Categories is a StringList; the dialog edits one primary category.
        category: readFirstCategory(item),
        attendees: readAttendees(item),
        recurrenceText: recurrenceToText(item.Recurrence),
      };
    },
    'getAppointment',
  );
}

// The mailbox's real free/busy for a window.
//
// NOT via GetUserAvailability: MEASURED 28.07 against the live IONOS server —
// that operation answers HTTP 500 / ErrorInternalServerError (127) for this
// hosted mailbox, while ordinary calendar reads succeed. So availability is
// derived from the calendar itself: every item carries its own
// LegacyFreeBusyStatus, which is exactly what the availability service would
// have aggregated. Same answer, over an API this account is allowed to use.
//
// Consequence to keep in mind: this sees THIS mailbox's own items only (no
// delegate/shared-calendar aggregation) — which is precisely the scope the
// presence indicator and the scheduler care about.
async function getAvailability(
  cfg: ExchangeConnectionConfig,
  range: { start: Date; end: Date },
): Promise<ExchangeResult<AvailabilityWindow[]>> {
  const listed = await listAppointments(cfg, range);
  if (!listed.ok) return listed;
  return {
    ok: true,
    data: listed.data
      // 'free'-marked items (informational all-day rows) are not constraints.
      .filter((item) => item.showAs !== 'free')
      .map((item) => ({ start: item.start, end: item.end, showAs: item.showAs })),
  };
}

// Creates a single, non-recurring appointment directly in the Calendar
// folder. SendInvitationsMode.SendToNone: Stage 1 has no attendees and must
// never actually send mail (plan §1 explicit "לא: שליחת מייל").
async function createAppointment(
  cfg: ExchangeConnectionConfig,
  draft: AppointmentDraft,
): Promise<ExchangeResult<{ appointmentId: string }>> {
  return runProviderCall(cfg, async (service) => {
    const appointment = new Appointment(service);
    appointment.Subject = xmlSafe(draft.subject);
    // BodyType MUST be explicit. `new MessageBody(text)` takes the single-arg
    // overload, which defaults to BodyType.HTML (verified in the installed
    // enum: HTML = 0, Text = 1) — measured on a live item, a plain-text body
    // written that way came back as `<html>…&#43;9725…</html>`: every newline
    // collapsed and the leading "+" of a phone number entity-encoded, which
    // silently breaks tap-to-dial. Callers say which they mean.
    if (draft.body) {
      appointment.Body = new MessageBody(
        draft.bodyIsHtml ? BodyType.HTML : BodyType.Text,
        xmlSafe(draft.body),
      );
    }
    appointment.Start = new DateTime(draft.start);
    appointment.End = new DateTime(draft.end);
    if (draft.allDay) appointment.IsAllDayEvent = true; // setter verified in the installed d.ts
    // Free/busy effect — the property GetUserAvailability actually reads, so
    // this is what makes an item genuinely block (or deliberately NOT block)
    // the owner's time. Setters verified against the installed d.ts.
    if (draft.showAs) appointment.LegacyFreeBusyStatus = SHOW_AS_TO_EWS[draft.showAs];
    if (draft.private) appointment.Sensitivity = Sensitivity.Private;
    if (draft.category) appointment.Categories = new StringList([xmlSafe(draft.category)]);
    if (draft.location !== undefined) appointment.Location = xmlSafe(draft.location);
    if (draft.reminderMinutes !== undefined) {
      appointment.IsReminderSet = draft.reminderMinutes > 0;
      if (draft.reminderMinutes > 0) {
        appointment.ReminderMinutesBeforeStart = draft.reminderMinutes;
      }
    }
    if (draft.sensitivity) appointment.Sensitivity = SENSITIVITY_TO_EWS[draft.sensitivity];
    if (draft.recurrence) appointment.Recurrence = buildRecurrence(draft.recurrence, draft.start);
    if (draft.attendees?.length) applyAttendees(appointment, draft.attendees);
    // Invitations are dispatched ONLY when the owner actually added people —
    // an appointment with no attendees must never generate mail.
    await appointment.Save(
      WellKnownFolderName.Calendar,
      draft.attendees?.length
        ? SendInvitationsMode.SendOnlyToAll
        : SendInvitationsMode.SendToNone,
    );
    return { appointmentId: appointment.Id.UniqueId };
  }, 'createAppointment');
}

// Times/subject of one existing appointment: Bind-fresh (obtains the current
// ChangeKey, so a concurrent OWA edit is merged by the server rather than
// stomped) → mutate → Update(AutoResolve, SendToNone). Recurring items are
// refused upstream (DAL/UI readOnly) — editing a series occurrence has
// exception semantics deliberately out of scope for now.
async function updateAppointment(
  cfg: ExchangeConnectionConfig,
  appointmentId: string,
  update: AppointmentUpdate,
): Promise<ExchangeResult<void>> {
  return runProviderCall(cfg, async (service) => {
    // Explicit bind property set (same doctrine as the list): the guard needs
    // AppointmentType/IsRecurring actually loaded, never assumed-by-default.
    const appointment = await Appointment.Bind(
      service,
      new ItemId(appointmentId),
      APPOINTMENT_DETAIL_PROPERTIES,
    );
    if (isSeriesLinked(appointment)) {
      throw new RecurringUpdateRefusedError('series-linked items are read-only in this stage');
    }
    appointment.Start = new DateTime(update.start);
    appointment.End = new DateTime(update.end);
    // Each field is written ONLY when the caller supplied it: `undefined`
    // means "leave whatever Exchange has", so a drag that sends times alone
    // can never wipe a location or a body the owner typed in Outlook.
    if (update.subject !== undefined) appointment.Subject = xmlSafe(update.subject);
    if (update.location !== undefined) appointment.Location = xmlSafe(update.location);
    if (update.body !== undefined) {
      // Same explicit-type rule as createAppointment above.
      appointment.Body = new MessageBody(
        update.bodyIsHtml ? BodyType.HTML : BodyType.Text,
        xmlSafe(update.body),
      );
    }
    if (update.allDay !== undefined) appointment.IsAllDayEvent = update.allDay;
    if (update.showAs !== undefined) {
      appointment.LegacyFreeBusyStatus = SHOW_AS_TO_EWS[update.showAs];
    }
    if (update.reminderMinutes !== undefined) {
      // 0 = no reminder; any positive value both enables and sets it.
      appointment.IsReminderSet = update.reminderMinutes > 0;
      if (update.reminderMinutes > 0) {
        appointment.ReminderMinutesBeforeStart = update.reminderMinutes;
      }
    }
    if (update.sensitivity !== undefined) {
      appointment.Sensitivity = SENSITIVITY_TO_EWS[update.sensitivity];
    }
    if (update.category !== undefined) {
      appointment.Categories = new StringList(
        update.category ? [xmlSafe(update.category)] : [],
      );
    }
    if (update.attendees !== undefined) applyAttendees(appointment, update.attendees);
    await appointment.Update(
      ConflictResolutionMode.AutoResolve,
      update.attendees?.length
        ? SendInvitationsOrCancellationsMode.SendOnlyToAll
        : SendInvitationsOrCancellationsMode.SendToNone,
    );
  }, 'updateAppointment');
}

// Hard delete (not moved to Deleted Items) — a Stage-1 test appointment is
// throwaway by definition; leaving it in Deleted Items would still be visible
// clutter in OWA. SendCancellationsMode.SendToNone mirrors SendToNone above:
// no attendees, no mail.
async function deleteAppointment(
  cfg: ExchangeConnectionConfig,
  appointmentId: string,
): Promise<ExchangeResult<void>> {
  return runProviderCall(cfg, async (service) => {
    const appointment = await Appointment.Bind(service, new ItemId(appointmentId));
    await appointment.Delete(DeleteMode.HardDelete, SendCancellationsMode.SendToNone);
  }, 'deleteAppointment');
}

// The mailbox's master category list.
//
// Not an item property and not a folder: Outlook keeps it as a UserConfiguration
// named "CategoryList" on the Calendar folder, whose XmlData is a base64 blob of
// a <categories> document. Verified against this IONOS mailbox on 28.07.2026 —
// unlike GetUserAvailability, which that hosting answers with HTTP 500, this
// call works. Parsing lives in ./category-list so it can be tested without a
// mailbox.
async function listCategories(
  cfg: ExchangeConnectionConfig,
): Promise<ExchangeResult<ExchangeCategory[]>> {
  return runProviderCall(cfg, async (service) => {
    const config = await UserConfiguration.Bind(
      service,
      'CategoryList',
      WellKnownFolderName.Calendar,
      UserConfigurationProperties.XmlData,
    );
    return parseCategoryList(
      Buffer.from(String(config.XmlData ?? ''), 'base64').toString('utf8'),
    );
  }, 'listCategories');
}

export const ewsProvider: ExchangeCalendarProvider = {
  testConnection,
  listCalendars,
  listAppointments,
  getAppointment,
  getAvailability,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  listCategories,
};
