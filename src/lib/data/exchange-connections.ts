import 'server-only';

import { randomUUID } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hasPlatformPermission,
  requirePlatformPermission,
  requireUser,
  getOrgContext,
} from '@/lib/auth/dal';
import { getCallbackRequestByCalendarItem } from '@/lib/data/admin/callbacks';
import { logActivity } from '@/lib/data/activity';
import { decryptCredential, encryptCredential } from '@/lib/exchange-ews/crypto';
import { ewsProvider } from '@/lib/exchange-ews/ews-impl';
import type {
  AppointmentAttendee,
  AppointmentRecurrence,
  AppointmentSensitivity,
  ExchangeCategory,
  ExchangeConnectionConfig,
} from '@/lib/exchange-ews/types';

// DAL for exchange_connections — a CLOSED table (RLS enabled, zero policies,
// all grants revoked from anon/authenticated; see
// supabase/migrations/20260727171428_exchange_connections.sql). Every
// function here uses the SERVICE-ROLE client, which bypasses RLS entirely —
// so unlike most of the app's DAL, RLS is NOT a backstop here.
//
// BUSINESS-ADMIN FEATURE, NOT CUSTOMER-FACING (owner ruling 27.07): the
// Exchange mailbox is the BUSINESS's mailbox, so every function here is
// gated by requirePlatformPermission('manage_settings') — the same gate as
// the /admin/settings surface that hosts the UI. requireUser() is still
// called first for identity: user_id records which admin connected the
// mailbox and binds the credential's AAD. Never accept a user id as a
// parameter from a caller; always take it from the verified session.

type ExchangeConnectionStatus = 'pending' | 'verified' | 'failed' | 'revoked';
type ExchangeAuthMethodRow = 'ntlm' | 'basic';

type ExchangeConnectionRow = {
  id: string;
  user_id: string;
  org_id: string | null;
  mailbox_email: string;
  auth_method: ExchangeAuthMethodRow;
  status: ExchangeConnectionStatus;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type ExchangeConnectionRowWithCredential = ExchangeConnectionRow & {
  credential_ciphertext: string;
  credential_iv: string;
  credential_auth_tag: string;
  encryption_key_version: number;
};

const PUBLIC_COLUMNS =
  'id, user_id, org_id, mailbox_email, auth_method, status, last_verified_at, last_error, created_at, updated_at';
const CREDENTIAL_COLUMNS = `${PUBLIC_COLUMNS}, credential_ciphertext, credential_iv, credential_auth_tag, encryption_key_version`;

export type ExchangeConnectionView = {
  id: string;
  mailboxEmail: string;
  authMethod: ExchangeAuthMethodRow;
  status: ExchangeConnectionStatus;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

function toView(row: ExchangeConnectionRow): ExchangeConnectionView {
  return {
    id: row.id,
    mailboxEmail: row.mailbox_email,
    authMethod: row.auth_method,
    status: row.status,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

// app_settings.exchange_connection_mode (plan §3.1). Non-secret, readable by
// the connecting user (not admin-gated) — the connect screen needs to know
// which mode is active. Fail-open to 'per_user', the Stage-1 default and the
// safe state if the mechanism is ever misconfigured (mirrors
// getCookieConsentPublicConfig's fail-open-to-baseline convention).
export async function getExchangeConnectionMode(): Promise<'per_user' | 'per_org'> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('exchange_connection_mode')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return 'per_user';
    return data.exchange_connection_mode === 'per_org' ? 'per_org' : 'per_user';
  } catch {
    return 'per_user';
  }
}

// The current user's own connections (self-scoped — see module note). Never
// selects the credential columns; this is a display read only.
export async function listMyExchangeConnections(): Promise<ExchangeConnectionView[]> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { data, error } = await admin.from('exchange_connections')
    .select(PUBLIC_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error('טעינת חיבורי Exchange נכשלה');
  return ((data ?? []) as ExchangeConnectionRow[]).map(toView);
}

export type CreateExchangeConnectionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Encrypts the password immediately and inserts one row. The AAD binds the
// ciphertext to (connectionId, userId) — see crypto.ts — so the id must exist
// BEFORE encryption, not be left to the column default; it is generated here
// and inserted explicitly.
export async function createExchangeConnection(input: {
  mailboxEmail: string;
  password: string;
}): Promise<CreateExchangeConnectionResult> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();

  const mode = await getExchangeConnectionMode();
  let orgId: string | null = null;
  if (mode === 'per_org') {
    const orgContext = await getOrgContext();
    if (!orgContext.activeOrgId) {
      return {
        ok: false,
        error: 'מצב החיבור המשותף (ארגוני) פעיל, אך אינכם משויכים לארגון פעיל.',
      };
    }
    orgId = orgContext.activeOrgId;
  }

  // Reconnect flow (MEASURED gap, 27.07 owner screenshot): revoke is a
  // soft-disconnect that keeps the row, so the unique (user_id, mailbox_email)
  // constraint would block ever reconnecting the same mailbox. A REVOKED row
  // is therefore REVIVED in place — fresh credential (re-encrypted with the
  // SAME id, so the AAD binding still matches), status reset to pending, and
  // the audit trail (created_at + activity log) stays continuous. An ACTIVE
  // row still refuses a duplicate connect.
  const { data: existing } = await admin
    .from('exchange_connections')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('mailbox_email', input.mailboxEmail)
    .maybeSingle();

  if (existing) {
    if (existing.status !== 'revoked') {
      return { ok: false, error: 'תיבת הדואר הזו כבר מחוברת לחשבון שלכם.' };
    }
    const revived = encryptCredential(input.password, existing.id, user.id);
    const { error: reviveError } = await admin
      .from('exchange_connections')
      .update({
        org_id: orgId,
        auth_method: 'ntlm',
        credential_ciphertext: revived.ciphertext,
        credential_iv: revived.iv,
        credential_auth_tag: revived.authTag,
        encryption_key_version: revived.keyVersion,
        status: 'pending',
        last_verified_at: null,
        last_error: null,
      })
      .eq('id', existing.id)
      .eq('user_id', user.id);
    if (reviveError) throw new Error('חיבור התיבה מחדש נכשל');
    await logActivity({
      action: 'exchange.connection_reconnected',
      meta: { connectionId: existing.id, mode },
    });
    return { ok: true, id: existing.id };
  }

  const connectionId = randomUUID();
  const encrypted = encryptCredential(input.password, connectionId, user.id);

  const { error } = await admin.from('exchange_connections').insert({
    id: connectionId,
    user_id: user.id,
    org_id: orgId,
    mailbox_email: input.mailboxEmail,
    auth_method: 'ntlm', // the only method implemented in Stage 1 — see ews-impl.ts
    credential_ciphertext: encrypted.ciphertext,
    credential_iv: encrypted.iv,
    credential_auth_tag: encrypted.authTag,
    encryption_key_version: encrypted.keyVersion,
    status: 'pending',
  });

  if (error) {
    // 23505 = unique_violation on exchange_connections_mailbox_per_user.
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, error: 'תיבת הדואר הזו כבר מחוברת לחשבון שלכם.' };
    }
    throw new Error('יצירת חיבור ה-Exchange נכשלה');
  }

  await logActivity({
    action: 'exchange.connection_created',
    meta: { connectionId, mode },
  });

  return { ok: true, id: connectionId };
}

// Loads one connection OWNED by the current user, decrypts its credential,
// and refuses to hand back a config for a revoked connection — defense in
// depth beyond the UI simply not offering the buttons.
//
// Exported (as loadExchangeConfigForConnection) for sibling server-only
// modules that drive the same mailbox — currently the availability-status
// feature (src/lib/data/exchange-availability.ts). Exporting the guarded
// loader, rather than letting callers assemble a config themselves, is what
// keeps ownership + permission + revoked + decrypt checks in ONE place.
async function loadOwnedConnectionConfig(
  connectionId: string,
): Promise<
  | { ok: true; config: ExchangeConnectionConfig; userId: string }
  | { ok: false; message: string }
> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { data, error } = await admin.from('exchange_connections')
    .select(CREDENTIAL_COLUMNS)
    .eq('id', connectionId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { ok: false, message: 'טעינת החיבור נכשלה' };
  if (!data) return { ok: false, message: 'החיבור לא נמצא' };
  const row = data as ExchangeConnectionRowWithCredential;
  if (row.status === 'revoked') {
    return { ok: false, message: 'החיבור בוטל. חברו מחדש כדי להמשיך.' };
  }

  let password: string;
  try {
    password = decryptCredential(
      {
        ciphertext: row.credential_ciphertext,
        iv: row.credential_iv,
        authTag: row.credential_auth_tag,
        keyVersion: row.encryption_key_version,
      },
      row.id,
      row.user_id,
    );
  } catch {
    // Fail closed — never fall back to a default or skip the check (plan §4).
    return { ok: false, message: 'פענוח פרטי החיבור נכשל' };
  }

  return {
    ok: true,
    userId: user.id,
    config: { mailboxEmail: row.mailbox_email, password, authMethod: row.auth_method },
  };
}

async function recordConnectionResult(
  connectionId: string,
  outcome: { status: ExchangeConnectionStatus; lastError: string | null },
): Promise<void> {
  const admin = createAdminClient();
  await admin.from('exchange_connections')
    .update({
      status: outcome.status,
      last_verified_at: outcome.status === 'verified' ? new Date().toISOString() : undefined,
      last_error: outcome.lastError,
    })
    .eq('id', connectionId);
}

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'האימות נכשל — בדקו את כתובת התיבה והסיסמה.',
  unreachable: 'לא ניתן להגיע לשרת ה-Exchange כרגע.',
  not_found: 'התיקייה או הפריט המבוקש לא נמצאו בתיבה.',
  recurring_locked: 'אירוע חוזר — עריכה זמינה בשלב זה רק דרך Outlook/OWA.',
  provider_error: 'שגיאה בלתי צפויה מול שרת ה-Exchange.',
};

export async function testMyExchangeConnection(
  connectionId: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.testConnection(loaded.config);
  if (result.ok) {
    await recordConnectionResult(connectionId, { status: 'verified', lastError: null });
    await logActivity({ action: 'exchange.connection_tested', meta: { connectionId, ok: true } });
    return { ok: true, message: `החיבור אומת בהצלחה (${result.data.emailAddress}).` };
  }

  const message = ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error;
  await recordConnectionResult(connectionId, { status: 'failed', lastError: result.error });
  await logActivity({
    action: 'exchange.connection_tested',
    meta: { connectionId, ok: false, error: result.error },
  });
  return { ok: false, message };
}

export async function listMyExchangeCalendars(
  connectionId: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.listCalendars(loaded.config);
  if (!result.ok) {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  if (result.data.length === 0) {
    return { ok: true, message: 'לא נמצאו יומנים בתיבה.' };
  }
  const summary = result.data
    .map((c) => `${c.displayName} (${c.totalCount} פריטים)`)
    .join(', ');
  return { ok: true, message: `נמצאו ${result.data.length} יומנים: ${summary}` };
}

export async function createMyExchangeTestAppointment(
  connectionId: string,
): Promise<{ ok: true; appointmentId: string } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const start = new Date(Date.now() + 5 * 60_000); // +5 min — clear of "now" so it is not mistaken for an in-progress event
  const end = new Date(start.getTime() + 15 * 60_000);
  const result = await ewsProvider.createAppointment(loaded.config, {
    subject: 'בדיקת חיבור KALFA — ניתן למחוק',
    start,
    end,
    body: 'פגישה זו נוצרה אוטומטית לבדיקת חיבור ה-Exchange של KALFA. ניתן למחוק אותה.',
  });
  if (!result.ok) {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  await logActivity({
    action: 'exchange.test_appointment_created',
    meta: { connectionId },
  });
  return { ok: true, appointmentId: result.data.appointmentId };
}

export async function deleteMyExchangeTestAppointment(
  connectionId: string,
  appointmentId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.deleteAppointment(loaded.config, appointmentId);
  if (!result.ok) {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  await logActivity({
    action: 'exchange.test_appointment_deleted',
    meta: { connectionId },
  });
  return { ok: true };
}

// Soft-disconnect: marks the connection revoked rather than deleting the row,
// preserving the audit trail (created_at/updated_at/last_error history) —
// mirrors the project's general auditability requirement. The encrypted
// credential stays in place but every read path above refuses to use a
// revoked connection.
export async function revokeExchangeConnection(connectionId: string): Promise<void> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { error } = await admin.from('exchange_connections')
    .update({ status: 'revoked' })
    .eq('id', connectionId)
    .eq('user_id', user.id);
  if (error) throw new Error('ניתוק החיבור נכשל');
  await logActivity({ action: 'exchange.connection_revoked', meta: { connectionId } });
}

// ---------------------------------------------------------------------------
// /admin/calendar — the visual calendar's data layer. Same authorization
// boundary as everything above (requirePlatformPermission inside
// loadOwnedConnectionConfig / the helpers below); the client receives ONLY
// the thin serializable DTO — never the connection config, never raw
// provider errors, and appointment content is never logged (business PII).
// ---------------------------------------------------------------------------

/** Serializable calendar-event DTO for the admin calendar client. */
export type CalendarEventDTO = {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  /** Series-linked items (occurrence/exception/master) are read-only in this stage (owner decision). */
  readOnly: boolean;
};

/** The first VERIFIED connection of the current admin, or null. */
export async function getMyActiveExchangeConnection(): Promise<ExchangeConnectionView | null> {
  const connections = await listMyExchangeConnections();
  return connections.find((c) => c.status === 'verified') ?? null;
}

export async function listMyExchangeCalendarEvents(
  connectionId: string,
  range: { startIso: string; endIso: string },
): Promise<{ ok: true; events: CalendarEventDTO[] } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.listAppointments(loaded.config, {
    start: new Date(range.startIso),
    end: new Date(range.endIso),
  });
  if (!result.ok) {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  return {
    ok: true,
    events: result.data.map((a) => ({
      id: a.id,
      title: a.subject,
      startIso: a.start.toISOString(),
      endIso: a.end.toISOString(),
      allDay: a.allDay,
      readOnly: a.seriesLinked,
    })),
  };
}

export async function createMyExchangeCalendarEvent(
  connectionId: string,
  draft: {
    subject: string;
    startIso: string;
    endIso: string;
    allDay: boolean;
    location?: string;
    body?: string;
    reminderMinutes?: number;
    sensitivity?: AppointmentSensitivity;
    category?: string;
    attendees?: AppointmentAttendee[];
    recurrence?: AppointmentRecurrence;
  },
): Promise<{ ok: true; appointmentId: string } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.createAppointment(loaded.config, {
    subject: draft.subject,
    start: new Date(draft.startIso),
    end: new Date(draft.endIso),
    allDay: draft.allDay,
    ...(draft.location ? { location: draft.location } : {}),
    ...(draft.body ? { body: draft.body } : {}),
    ...(draft.reminderMinutes !== undefined
      ? { reminderMinutes: draft.reminderMinutes }
      : {}),
    ...(draft.sensitivity ? { sensitivity: draft.sensitivity } : {}),
    ...(draft.category ? { category: draft.category } : {}),
    ...(draft.attendees?.length ? { attendees: draft.attendees } : {}),
    ...(draft.recurrence ? { recurrence: draft.recurrence } : {}),
  });
  if (!result.ok) {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  await logActivity({
    action: 'exchange.calendar_event_created',
    meta: { connectionId }, // deliberately no subject/times — business PII
  });
  return { ok: true, appointmentId: result.data.appointmentId };
}

export type CalendarEventEditInput = {
  appointmentId: string;
  startIso: string;
  endIso: string;
  subject?: string;
  location?: string;
  body?: string;
  allDay?: boolean;
  reminderMinutes?: number;
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'working_elsewhere';
  sensitivity?: AppointmentSensitivity;
  category?: string;
  attendees?: AppointmentAttendee[];
};

export async function updateMyExchangeCalendarEvent(
  connectionId: string,
  update: CalendarEventEditInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.updateAppointment(loaded.config, update.appointmentId, {
    start: new Date(update.startIso),
    end: new Date(update.endIso),
    // Spread only the keys the caller actually sent — see AppointmentUpdate:
    // undefined means "leave as is", so a drag never clears typed content.
    ...(update.subject !== undefined ? { subject: update.subject } : {}),
    ...(update.location !== undefined ? { location: update.location } : {}),
    ...(update.body !== undefined ? { body: update.body } : {}),
    ...(update.allDay !== undefined ? { allDay: update.allDay } : {}),
    ...(update.reminderMinutes !== undefined
      ? { reminderMinutes: update.reminderMinutes }
      : {}),
    ...(update.showAs !== undefined ? { showAs: update.showAs } : {}),
    ...(update.sensitivity !== undefined ? { sensitivity: update.sensitivity } : {}),
    ...(update.category !== undefined ? { category: update.category } : {}),
    ...(update.attendees !== undefined ? { attendees: update.attendees } : {}),
  });
  if (!result.ok) {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  await logActivity({
    action: 'exchange.calendar_event_updated',
    meta: { connectionId }, // deliberately no id/subject/times — business PII
  });
  return { ok: true };
}

// Guarded config loader for sibling server-only modules (see the note above
// loadOwnedConnectionConfig). Re-exported under an explicit name so callers
// read as "load the Exchange config for this connection", and so the guards
// are never duplicated.
export { loadOwnedConnectionConfig as loadExchangeConfigForConnection };

/**
 * The mailbox's own category list, for the calendar's category picker.
 *
 * Read rather than hardcoded because the list belongs to the OWNER: they add,
 * rename and recolour categories in Outlook, and a list we invented here would
 * write names the mailbox does not know — which is exactly how an appointment
 * ends up carrying a category that Outlook then shows with no colour at all.
 */
export async function listMyExchangeCategories(
  connectionId: string,
): Promise<{ ok: true; categories: ExchangeCategory[] } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.listCategories(loaded.config);
  if (!result.ok) {
    // A mailbox whose category list has never been saved has no configuration
    // object to bind to. That is an empty list, not a failure worth showing.
    if (result.error === 'not_found') return { ok: true, categories: [] };
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  return { ok: true, categories: result.data };
}

/** Delete one appointment from the admin calendar screen. */
export async function deleteMyExchangeCalendarEvent(
  connectionId: string,
  appointmentId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.deleteAppointment(loaded.config, appointmentId);
  // Already gone (deleted in Outlook meanwhile) is the desired end state.
  if (!result.ok && result.error !== 'not_found') {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  await logActivity({
    action: 'exchange.calendar_event_deleted',
    meta: { connectionId }, // no subject/times — business PII
  });
  return { ok: true };
}

/**
 * The callback request an appointment was scheduled for, when it is one.
 *
 * Why this rides along with the appointment: the description in the mailbox is
 * a rendering FOR OUTLOOK — labelled lines, an HTML tel: link, a named
 * hyperlink. Reading it back means parsing prose to recover fields we already
 * hold in columns, and it only ever works for items written by the current
 * format. Sending the structure instead means the dialog renders real controls
 * for EVERY item the scheduler wrote, including the ones whose body predates
 * the format or arrived empty.
 *
 * Deliberately not the whole row: status and the scheduling bookkeeping belong
 * to /admin/callbacks. This is what the owner needs in the seconds before
 * dialling.
 */
export type LinkedCallbackDTO = {
  id: string;
  fullName: string;
  phone: string;
  topic: string | null;
  note: string | null;
  createdAtIso: string;
  attemptCount: number;
};

/** Full detail of one appointment, for the edit dialog. */
export type CalendarEventDetailDTO = {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  readOnly: boolean;
  location: string;
  body: string;
  reminderMinutes: number | null;
  showAs: 'free' | 'tentative' | 'busy' | 'oof' | 'working_elsewhere';
  sensitivity: AppointmentSensitivity;
  category: string;
  attendees: AppointmentAttendee[];
  recurrenceText: string | null;
  callback: LinkedCallbackDTO | null;
};

export async function getMyExchangeCalendarEvent(
  connectionId: string,
  appointmentId: string,
): Promise<{ ok: true; event: CalendarEventDetailDTO } | { ok: false; message: string }> {
  const loaded = await loadOwnedConnectionConfig(connectionId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const result = await ewsProvider.getAppointment(loaded.config, appointmentId);
  if (!result.ok) {
    return { ok: false, message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.provider_error };
  }
  // Checked rather than required: owning the mailbox and being allowed to read
  // customer data are two different permissions. Someone with the calendar but
  // not the customer-data capability sees the appointment exactly as Exchange
  // has it — no linked panel — instead of an error page.
  const callbackRow = (await hasPlatformPermission('view_customer_data'))
    ? await getCallbackRequestByCalendarItem(appointmentId)
    : null;

  const a = result.data;
  return {
    ok: true,
    event: {
      id: a.id,
      title: a.subject,
      startIso: a.start.toISOString(),
      endIso: a.end.toISOString(),
      allDay: a.allDay,
      readOnly: a.seriesLinked,
      location: a.location,
      body: a.body,
      reminderMinutes: a.reminderMinutes,
      showAs: a.showAs,
      sensitivity: a.sensitivity,
      category: a.category,
      attendees: a.attendees,
      recurrenceText: a.recurrenceText,
      callback: callbackRow
        ? {
            id: callbackRow.id,
            fullName: callbackRow.full_name,
            phone: callbackRow.phone,
            topic: callbackRow.topic,
            note: callbackRow.note,
            createdAtIso: callbackRow.created_at,
            attemptCount: callbackRow.attempt_count,
          }
        : null,
    },
  };
}
