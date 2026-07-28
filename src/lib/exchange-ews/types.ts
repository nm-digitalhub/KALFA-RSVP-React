import 'server-only';

// Plain data-shape contracts for the Exchange EWS integration. No import of
// `ews-javascript-api` or `@ewsjs/xhr` here — those are confined to
// ./ews-impl.ts, the only file in this directory allowed to touch them
// (plan §2, plans/exchange-ews-stage1.md).

export type ExchangeAuthMethod = 'ntlm' | 'basic';

// Decrypted, ready-to-use connection config for a single EWS call. Built by
// the DAL (src/lib/data/exchange-connections.ts) from a decrypted
// `exchange_connections` row. Carries a plaintext password — never persisted,
// logged, or held longer than one call.
export type ExchangeConnectionConfig = {
  mailboxEmail: string;
  password: string;
  authMethod: ExchangeAuthMethod;
};

export type MailboxInfo = {
  emailAddress: string;
  // Stage 1 does not resolve a human display name (no ResolveName call in
  // scope — plan §2.1 lists testConnection returning MailboxInfo built from
  // the Bind result only). null until a later stage adds that lookup.
  displayName: string | null;
};

export type CalendarSummary = {
  id: string; // FolderId.UniqueId — opaque, stable per folder
  displayName: string;
  totalCount: number;
};

// How the appointment affects the mailbox owner's free/busy — the value the
// availability service reads. Mirrors the installed LegacyFreeBusyStatus enum
// (Free/Tentative/Busy/OOF/WorkingElsewhere), named in our own vocabulary so
// the library enum never leaks past the provider boundary.
export type AppointmentShowAs = 'free' | 'tentative' | 'busy' | 'oof' | 'working_elsewhere';

/** Outlook's Sensitivity ladder (Item.Sensitivity). */
export type AppointmentSensitivity = 'normal' | 'personal' | 'private' | 'confidential';

/** One invitee. Attendees receive REAL meeting invitations by email. */
export type AppointmentAttendee = {
  email: string;
  name?: string;
  /** Optional attendees are invited but not counted as required. */
  optional?: boolean;
};

// Recurrence, in the four shapes Outlook's own dialog offers. `interval` is
// "every N days/weeks/months/years"; weekly patterns also carry the weekdays
// (0=Sunday, matching JS getDay() and the library's DayOfTheWeek enum).
export type AppointmentRecurrence = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  /** weekly only; 0=Sunday … 6=Saturday. */
  daysOfWeek?: number[];
  /** monthly/yearly only; 1-31. */
  dayOfMonth?: number;
  /** yearly only; 1-12. */
  month?: number;
  /** Ends after N occurrences, on a date, or never (both omitted). */
  occurrences?: number;
  endDateIso?: string;
};

export type AppointmentDraft = {
  subject: string;
  start: Date;
  end: Date;
  body?: string;
  // True for a day-granular event; start/end must then be display-zone
  // midnights (the calendar component supplies them that way).
  allDay?: boolean;
  // Free/busy effect. Omitted = the server default (Busy for timed items).
  // Informational all-day items MUST pass 'free' or they black out the day.
  showAs?: AppointmentShowAs;
  // Marks the item Private (Item.Sensitivity) — content hidden from anyone
  // the mailbox is ever shared with/delegated to. Used for items that carry
  // customer names.
  private?: boolean;
  // Outlook category, e.g. "KALFA — סטטוס" — lets everything this app writes
  // be recognised and filtered in Outlook.
  category?: string;
  // Where it happens. Written to Appointment.Location, which is what makes an
  // address tappable-for-navigation on the phone.
  location?: string;
  /** Minutes before start; 0 = no reminder. */
  reminderMinutes?: number;
  sensitivity?: AppointmentSensitivity;
  /** Sending a non-empty list DISPATCHES real invitations by email. */
  attendees?: AppointmentAttendee[];
  recurrence?: AppointmentRecurrence;
};

// One calendar item as read back from Exchange (FindAppointments). This is
// the provider's own shape — the DAL maps it onto the thin client DTO; the
// raw library Appointment object never crosses the provider boundary.
export type ExchangeAppointment = {
  id: string; // ItemId.UniqueId — opaque, stable, required for update/delete
  subject: string;
  start: Date;
  end: Date;
  allDay: boolean;
  // The item's own free/busy effect. Populated from LegacyFreeBusyStatus so
  // presence can be derived from the calendar itself — the availability
  // SERVICE is unavailable on this hosting (measured: HTTP 500 /
  // ErrorInternalServerError 127 from IONOS), while reading the calendar
  // works, so the calendar is the reliable source.
  showAs: AppointmentShowAs;
  // AppointmentType !== Single: an Occurrence, Exception, or RecurringMaster
  // of a series (not necessarily "recurring" in the naive sense — hence the
  // name). Stage-1 calendar UI maps this to readOnly — editing series-linked
  // items has exception semantics that are deliberately out of scope for now
  // (owner-approved default).
  seriesLinked: boolean;
};

// One busy window as the availability service reports it. This is the
// mailbox's REAL free/busy — every source counts (items we wrote, meetings
// the owner created in Outlook, anything synced into the mailbox), which is
// exactly why presence must be read from here and not from our own table.
export type AvailabilityWindow = {
  start: Date;
  end: Date;
  showAs: AppointmentShowAs;
};

// Fields updateAppointment may change. Everything except start/end is
// OPTIONAL and only written when present: a drag/resize sends times alone,
// while the edit dialog may send any subset. Sending `undefined` therefore
// means "leave as it is in Exchange", never "clear it" — clearing is done by
// sending an empty string.
export type AppointmentUpdate = {
  start: Date;
  end: Date;
  subject?: string;
  body?: string;
  location?: string;
  allDay?: boolean;
  showAs?: AppointmentShowAs;
  /** Minutes before start; 0 disables the reminder. */
  reminderMinutes?: number;
  sensitivity?: AppointmentSensitivity;
  category?: string;
  /** Replaces the attendee list; sending it re-issues invitations. */
  attendees?: AppointmentAttendee[];
};

/** @deprecated Use AppointmentUpdate — kept as an alias for older callers. */
export type AppointmentTimesUpdate = AppointmentUpdate;

// The full item as the edit dialog needs it (a superset of what the calendar
// grid shows).
export type ExchangeAppointmentDetail = {
  id: string;
  subject: string;
  start: Date;
  end: Date;
  allDay: boolean;
  showAs: AppointmentShowAs;
  seriesLinked: boolean;
  location: string;
  body: string;
  reminderMinutes: number | null;
  sensitivity: AppointmentSensitivity;
  category: string;
  attendees: AppointmentAttendee[];
  /** A human summary of the recurrence, or null for a one-off. */
  recurrenceText: string | null;
};
