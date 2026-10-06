import 'server-only';

// Plain data-shape contracts for the calendar integration. These are pure
// shapes: no provider SDK is imported here, so a caller can describe a
// connection without pulling in an implementation.

// 'certificate' is how the ACTIVE backend authenticates: Graph signs in once as
// the application with the app certificate, so there is no per-mailbox method
// and no password — graph-impl.ts ignores `authMethod` and `password` outright.
//
// 'ntlm' and 'basic' are retained ONLY because stored rows still carry them
// (the live exchange_connections row reads 'ntlm'). They are inert: no code
// path branches on them to reach a different backend, because there is no other
// backend left. Do not read a value here as evidence that EWS still works.
export type ExchangeAuthMethod = 'ntlm' | 'basic' | 'certificate';

// Ready-to-use connection config for a single calendar call. Built by the DAL
// (src/lib/data/exchange-connections.ts) from an `exchange_connections` row.
// `password` is always the empty string under Graph (see
// mailbox-credential.ts) — never persisted, logged, or held longer than one
// call.
export type ExchangeConnectionConfig = {
  mailboxEmail: string;
  password: string;
  authMethod: ExchangeAuthMethod;
};

export type MailboxInfo = {
  emailAddress: string;
  // The calendar owner's display name as Graph reports it; null when absent.
  displayName: string | null;
};

export type CalendarSummary = {
  id: string; // Graph calendar id — opaque
  displayName: string;
  totalCount: number;
};

// How the appointment affects the mailbox owner's free/busy — the value the
// availability service reads. Mirrors Graph's `showAs` values
// (free/tentative/busy/oof/workingElsewhere), named in our own vocabulary so
// the vendor's naming never leaks past the provider boundary.
export type AppointmentShowAs = 'free' | 'tentative' | 'busy' | 'oof' | 'working_elsewhere';

/** Outlook's sensitivity ladder (Graph `sensitivity`). */
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
// (0=Sunday, matching JS getDay()).
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
  /**
   * Whether `body` is HTML. Default false = plain text.
   *
   * Anything hand-typed by the owner is plain; only bodies WE compose (the
   * callback item, so its phone number is a real tel: link) opt into HTML —
   * and those must escape every value they interpolate.
   */
  bodyIsHtml?: boolean;
  // True for a day-granular event; start/end must then be display-zone
  // midnights (the calendar component supplies them that way).
  allDay?: boolean;
  // Free/busy effect. Omitted = the server default (Busy for timed items).
  // Informational all-day items MUST pass 'free' or they black out the day.
  showAs?: AppointmentShowAs;
  // Marks the item Private (`sensitivity`) — content hidden from anyone
  // the mailbox is ever shared with/delegated to. Used for items that carry
  // customer names.
  private?: boolean;
  // Outlook category, e.g. "KALFA — סטטוס" — lets everything this app writes
  // be recognised and filtered in Outlook.
  category?: string;
  // Where it happens. Written to the event's location, which is what makes an
  // address tappable-for-navigation on the phone.
  location?: string;
  /** Minutes before start; 0 = no reminder. */
  reminderMinutes?: number;
  sensitivity?: AppointmentSensitivity;
  /** Sending a non-empty list DISPATCHES real invitations by email. */
  attendees?: AppointmentAttendee[];
  recurrence?: AppointmentRecurrence;
};

// One calendar item as read back from Exchange (calendarView). This is
// the provider's own shape — the DAL maps it onto the thin client DTO; the
// raw Graph event object never crosses the provider boundary.
export type ExchangeAppointment = {
  id: string; // Graph immutable event id — opaque, stable, required for update/delete
  subject: string;
  start: Date;
  end: Date;
  allDay: boolean;
  // The item's own free/busy effect (Graph `showAs`).
  showAs: AppointmentShowAs;
  // Graph type !== singleInstance: an occurrence, exception, or seriesMaster
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
  /** See AppointmentDraft.bodyIsHtml — same rule on update. */
  bodyIsHtml?: boolean;
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

/** @deprecated Use AppointmentUpdate. */
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

/**
 * One entry of the mailbox's master category list.
 *
 * The colour is NOT a property of any appointment — an item carries only the
 * category NAME, and Outlook looks the colour up in this mailbox-wide list.
 * That is why picking a "colour" for an event is really picking a category, and
 * why a name absent from this list shows uncoloured in Outlook however it is
 * rendered elsewhere.
 */
export type ExchangeCategory = {
  name: string;
  /** Index into OUTLOOK_CATEGORY_COLORS; null when the entry carries no colour. */
  colorIndex: number | null;
};
