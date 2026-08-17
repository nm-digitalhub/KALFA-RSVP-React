import 'server-only';

// Layer 2 — one-way sync of a KALFA event into the business's connected
// Exchange calendar (IONOS EWS). Layer 1 (a unified internal ops calendar
// UI) is separate, later work and is NOT built here.
//
// FAIL-SOFT BY DESIGN: every exported function here catches its own errors
// and never throws into the caller. This sync is a best-effort convenience,
// not a dependency of the event lifecycle — a mailbox outage or a missing
// Exchange connection must never block a customer from publishing or closing
// their event.
//
// SERVICE-ROLE THROUGHOUT, deliberately not the caller's session: the
// mailbox belongs to the BUSINESS, not to the customer who owns the KALFA
// event being synced. loadOwnedConnectionConfig (exchange-connections.ts) is
// the wrong tool here — it is scoped to the CALLING user's OWN connection,
// and the calling user at the trigger point (the event owner publishing/
// closing their event) is never the admin who connected the mailbox. The
// connection loader below mirrors loadBusinessConnection in
// callback-scheduling.ts (same "single verified connection, refuse rather
// than guess" rule) — kept as its own small copy per this feature's own
// scope rather than extracting a shared helper out of already-shipped,
// tested code.

import { logActivity } from '@/lib/data/activity';
import {
  buildCancelledUpdate,
  buildEventAppointmentDraft,
  buildRsvpDeadlineDraft,
} from '@/lib/data/event-exchange-calendar-item';
import { ilWallTimeToIso } from '@/lib/data/event-date';
import { resolveMailboxPassword } from '@/lib/exchange-ews/mailbox-credential';
import { calendarProvider } from '@/lib/exchange-ews/calendar-provider';
import type { ExchangeConnectionConfig } from '@/lib/exchange-ews/types';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import { getAppUrl } from '@/lib/url';

type AdminClient = ReturnType<typeof createAdminClient>;
type EventType = Database['public']['Enums']['event_type'];

// ── The business connection ─────────────────────────────────────────────────

type LoadedConnection = { id: string; config: ExchangeConnectionConfig };

/**
 * The single verified connection this sync writes through.
 *
 * Unattended/service-role code must not guess between mailboxes, so this
 * refuses rather than picks when the answer is ambiguous: exactly one
 * verified connection, or nothing happens. Mirrors loadBusinessConnection in
 * callback-scheduling.ts.
 */
async function loadBusinessExchangeConnection(
  admin: AdminClient,
): Promise<{ ok: true; connection: LoadedConnection } | { ok: false; reason: string }> {
  const { data, error } = await admin
    .from('exchange_connections')
    .select(
      'id, user_id, mailbox_email, auth_method, status, credential_ciphertext, credential_iv, credential_auth_tag, encryption_key_version',
    )
    .eq('status', 'verified')
    .limit(2);

  if (error) return { ok: false, reason: 'connection_lookup_failed' };
  if (!data || data.length === 0) return { ok: false, reason: 'no_verified_connection' };
  if (data.length > 1) return { ok: false, reason: 'ambiguous_connection' };

  const row = data[0];
  let password: string;
  try {
    password = resolveMailboxPassword();
  } catch {
    return { ok: false, reason: 'decrypt_failed' };
  }

  return {
    ok: true,
    connection: {
      id: row.id,
      config: {
        mailboxEmail: row.mailbox_email,
        password,
        authMethod: row.auth_method === 'basic' ? 'basic' : 'ntlm',
      },
    },
  };
}

// ── The event ────────────────────────────────────────────────────────────

type EventForSync = {
  id: string;
  name: string;
  event_type: EventType;
  event_date: string | null;
  rsvp_deadline: string | null;
  celebrants: Database['public']['Tables']['events']['Row']['celebrants'];
  notes: string | null;
};

async function loadEventForSync(admin: AdminClient, eventId: string): Promise<EventForSync | null> {
  const { data, error } = await admin
    .from('events')
    .select('id, name, event_type, event_date, rsvp_deadline, celebrants, notes')
    .eq('id', eventId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// A structured, non-PII log line for a path logActivity cannot cover (no
// session — see the module note) or that is not worth an audit row (a no-op
// early-out). Never includes guest/customer content, matching the project's
// no-raw-PII-in-logs rule.
function logSync(event: string, meta: Record<string, unknown>): void {
  console.info(`event-exchange-sync: ${event}`, meta);
}

// ── Sync on publish (draft → active) ────────────────────────────────────────

/**
 * Best-effort: create the Exchange appointment(s) for a just-published event.
 *
 * Idempotent via exchange_calendar_links' unique(event_id): a row already
 * present means this event was already synced, so this no-ops rather than
 * risking a second Exchange appointment. Never throws — see module note.
 */
export async function syncEventToExchange(eventId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: existing, error: existingError } = await admin.from('exchange_calendar_links')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle();
    if (existingError) {
      logSync('link_lookup_failed', { eventId });
      return;
    }
    if (existing) {
      logSync('already_synced', { eventId });
      return;
    }

    const event = await loadEventForSync(admin, eventId);
    if (!event) {
      logSync('event_not_found', { eventId });
      return;
    }
    if (!event.event_date) {
      // Should not happen — publishEvent requires a future event_date before
      // flipping status — but this module never assumes an upstream
      // invariant holds and simply skips instead of throwing.
      logSync('missing_event_date', { eventId });
      return;
    }

    const connection = await loadBusinessExchangeConnection(admin);
    if (!connection.ok) {
      logSync('no_connection', { eventId, reason: connection.reason });
      return;
    }

    const detailUrl = await getAppUrl(`/app/events/${eventId}`);
    const headingInput = {
      eventType: event.event_type,
      celebrants: event.celebrants,
      eventName: event.name,
    };

    const draft = buildEventAppointmentDraft({
      ...headingInput,
      eventDateIso: event.event_date,
      notes: event.notes,
      detailUrl,
    });
    const created = await calendarProvider.createAppointment(connection.connection.config, draft);
    if (!created.ok) {
      logSync('create_failed', { eventId, error: created.error });
      return;
    }

    let rsvpDeadlineAppointmentId: string | null = null;
    if (event.rsvp_deadline) {
      const startIsoMidnight = ilWallTimeToIso(event.rsvp_deadline, '00:00');
      const rsvpDraft = buildRsvpDeadlineDraft({ ...headingInput, startIsoMidnight });
      const rsvpCreated = await calendarProvider.createAppointment(
        connection.connection.config,
        rsvpDraft,
      );
      if (rsvpCreated.ok) {
        rsvpDeadlineAppointmentId = rsvpCreated.data.appointmentId;
      } else {
        // Best-effort within best-effort: the main item is the one that
        // matters. Log and keep going — the correlation row is still worth
        // writing with the main appointment id.
        logSync('rsvp_deadline_create_failed', { eventId, error: rsvpCreated.error });
      }
    }

    const { error: insertError } = await admin.from('exchange_calendar_links').insert({
      event_id: eventId,
      connection_id: connection.connection.id,
      appointment_id: created.data.appointmentId,
      rsvp_deadline_appointment_id: rsvpDeadlineAppointmentId,
      subject_synced: draft.subject,
    });

    if (insertError) {
      // 23505 = unique_violation on exchange_calendar_links_event_unique — a
      // race where two publish attempts for the same event both passed the
      // "not yet synced" check above. Same cleanup doctrine as
      // scheduleCallbackAppointment in callback-scheduling.ts: the
      // appointment(s) exist but we could not record them, so remove them
      // rather than leave an orphan (and a duplicate) the owner would see.
      if ((insertError as { code?: string }).code === '23505') {
        await calendarProvider.deleteAppointment(connection.connection.config, created.data.appointmentId);
        if (rsvpDeadlineAppointmentId) {
          await calendarProvider.deleteAppointment(
            connection.connection.config,
            rsvpDeadlineAppointmentId,
          );
        }
        logSync('link_race_lost', { eventId });
        return;
      }
      logSync('link_write_failed', { eventId });
      return;
    }

    await logActivity({
      eventId,
      action: 'exchange.event_synced',
      meta: {
        connectionId: connection.connection.id,
        hasRsvpDeadlineItem: rsvpDeadlineAppointmentId !== null,
      },
    });
  } catch (err) {
    logSync('unexpected_error', { eventId, message: err instanceof Error ? err.message : 'unknown' });
  }
}

// ── Cancellation marking on close ───────────────────────────────────────────

/**
 * Best-effort: mark the event's already-synced Exchange appointment(s) as
 * cancelled (prefix the subject, swap the category) — never deletes them and
 * never moves start/end. A no-op when the event was never synced (e.g. no
 * Exchange connection existed at publish time). Never throws — see module
 * note.
 */
export async function markEventExchangeCancelled(eventId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: link, error: linkError } = await admin.from('exchange_calendar_links')
      .select('appointment_id, rsvp_deadline_appointment_id')
      .eq('event_id', eventId)
      .maybeSingle();
    if (linkError) {
      logSync('cancel_link_lookup_failed', { eventId });
      return;
    }
    if (!link) {
      logSync('cancel_not_synced', { eventId });
      return;
    }

    const connection = await loadBusinessExchangeConnection(admin);
    if (!connection.ok) {
      logSync('cancel_no_connection', { eventId, reason: connection.reason });
      return;
    }

    const appointmentIds = [link.appointment_id, link.rsvp_deadline_appointment_id].filter(
      (id): id is string => !!id,
    );

    let updated = 0;
    for (const appointmentId of appointmentIds) {
      const detail = await calendarProvider.getAppointment(connection.connection.config, appointmentId);
      if (!detail.ok) {
        // Gone (owner deleted it in Outlook) or unreachable — nothing to mark.
        logSync('cancel_appointment_unreadable', { eventId, error: detail.error });
        continue;
      }
      const update = buildCancelledUpdate({
        subject: detail.data.subject,
        start: detail.data.start,
        end: detail.data.end,
      });
      const result = await calendarProvider.updateAppointment(
        connection.connection.config,
        appointmentId,
        update,
      );
      if (result.ok) updated += 1;
      else logSync('cancel_update_failed', { eventId, error: result.error });
    }

    await logActivity({
      eventId,
      action: 'exchange.event_cancelled_marked',
      meta: { connectionId: connection.connection.id, updated, total: appointmentIds.length },
    });
  } catch (err) {
    logSync('unexpected_error', { eventId, message: err instanceof Error ? err.message : 'unknown' });
  }
}
