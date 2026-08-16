import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission, requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  getMyActiveExchangeConnection,
  loadExchangeConfigForConnection,
} from '@/lib/data/exchange-connections';
import { calendarProvider } from '@/lib/exchange-ews/calendar-provider';
import type { AppointmentShowAs } from '@/lib/exchange-ews/types';

// Availability status ("presence") for the business owner, expressed the way
// Exchange itself understands it: each constraint is a blocking appointment
// whose LegacyFreeBusyStatus drives free/busy. Consequences that fall out of
// that choice, rather than needing machinery:
//   * expiry is automatic — "unavailable until tomorrow 09:00" stops applying
//     when the window passes; no timer, no cron, no expiry job;
//   * the status is visible everywhere the mailbox is (Outlook, iPhone, web);
//   * the autonomous scheduler sees it through the same availability lookup
//     it already uses, with no extra rule.
// Rows in exchange_availability_blocks are the correlation that lets us
// remove ONLY our own blocks when the owner marks himself available again —
// a meeting he booked himself is never touched.
//
// Same authorization boundary as the rest of the Exchange feature
// (business-admin only): requireUser + requirePlatformPermission on every
// function, service-role client, closed table.

export type AvailabilityShowAs = Exclude<AppointmentShowAs, 'free'>;

// What the avatar dot and the menu heading show. Derived from the mailbox's
// REAL free/busy (getAvailability), so a meeting the owner created in Outlook
// counts exactly like a status block we wrote — the two directions agree
// because both read the same source of truth.
export type PresenceSnapshot = {
  /** The state in effect right now, or 'free'. */
  showAs: AvailabilityShowAs | 'free';
  /** When the current constraint ends (null when free). */
  untilIso: string | null;
  /** True when the current constraint is one WE created (⇒ removable here). */
  ownedByApp: boolean;
};

export type AvailabilityBlock = {
  id: string;
  showAs: AvailabilityShowAs;
  label: string;
  startsAtIso: string;
  endsAtIso: string;
};

/** Fixed server-side vocabulary — the owner never sends free text to Exchange. */
export const AVAILABILITY_PRESETS = {
  busy: { showAs: 'busy', label: 'תפוס' },
  oof: { showAs: 'oof', label: 'מחוץ למשרד' },
  working_elsewhere: { showAs: 'working_elsewhere', label: 'עובד מרחוק' },
  tentative: { showAs: 'tentative', label: 'טנטטיבי' },
} as const satisfies Record<AvailabilityShowAs, { showAs: AvailabilityShowAs; label: string }>;

// Appointment subject + Outlook category for our status blocks. Deliberately
// generic: this lands in a third-party-hosted mailbox, so it says WHAT the
// state is and nothing about why.
const STATUS_CATEGORY = 'KALFA — סטטוס';
function statusSubject(label: string): string {
  return `${label} — KALFA`;
}

type BlockRow = {
  id: string;
  show_as: AvailabilityShowAs;
  label: string;
  starts_at: string;
  ends_at: string;
  appointment_id: string;
  connection_id: string;
};

function toBlock(row: BlockRow): AvailabilityBlock {
  return {
    id: row.id,
    showAs: row.show_as,
    label: row.label,
    startsAtIso: row.starts_at,
    endsAtIso: row.ends_at,
  };
}

const BLOCK_COLUMNS = 'id, show_as, label, starts_at, ends_at, appointment_id, connection_id';

/**
 * Constraints that have not ended yet: the one in effect right now plus any
 * scheduled ahead. Past windows are simply not returned — they stopped
 * applying on their own.
 */
export async function listMyAvailabilityBlocks(): Promise<AvailabilityBlock[]> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { data, error } = await admin.from('exchange_availability_blocks')
    .select(BLOCK_COLUMNS)
    .eq('user_id', user.id)
    .gt('ends_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw new Error('טעינת סטטוס הזמינות נכשלה');
  return ((data ?? []) as BlockRow[]).map(toBlock);
}

/**
 * Self-healing for the OTHER direction of the sync (measured 28.07): the
 * owner can delete one of our status appointments straight from Outlook, and
 * Exchange gives us no notification. A row whose appointment is no longer in
 * the calendar is therefore stale — it would keep claiming a constraint that
 * does not exist. Reconciled on read: whatever the calendar says, wins.
 *
 * Returns the surviving blocks. Cheap: one calendar read that the caller
 * needs anyway, and a delete only when something actually disappeared.
 */
async function reconcileBlocksWithCalendar(
  blocks: AvailabilityBlock[],
  liveAppointmentIds: Set<string>,
  rows: BlockRow[],
): Promise<AvailabilityBlock[]> {
  const staleIds = rows
    .filter((row) => !liveAppointmentIds.has(row.appointment_id))
    .map((row) => row.id);
  if (staleIds.length === 0) return blocks;
  const admin = createAdminClient();
  await admin.from('exchange_availability_blocks').delete().in('id', staleIds);
  return blocks.filter((b) => !staleIds.includes(b.id));
}

/**
 * Live presence: asks Exchange for the mailbox's own free/busy right now.
 * Reads windows only — never subjects or attendees — so nothing sensitive is
 * pulled just to colour a dot. Fails SOFT to 'free': presence is a hint, and
 * an Exchange hiccup must not break the admin shell.
 */
export async function getMyPresence(): Promise<PresenceSnapshot> {
  const free: PresenceSnapshot = { showAs: 'free', untilIso: null, ownedByApp: false };
  try {
    await requireUser();
    await requirePlatformPermission('manage_settings');
    const connection = await getMyActiveExchangeConnection();
    if (!connection) return free;
    const loaded = await loadExchangeConfigForConnection(connection.id);
    if (!loaded.ok) return free;

    const now = new Date();
    // Read the calendar directly (not the availability service — it answers
    // 500 on this hosting, see ews-impl). One read serves both purposes:
    // deciding presence AND reconciling our rows against reality.
    const result = await calendarProvider.listAppointments(loaded.config, {
      start: new Date(now.getTime() - 24 * 60 * 60_000),
      end: new Date(now.getTime() + 12 * 60 * 60_000),
    });
    if (!result.ok) return free;

    const liveIds = new Set(result.data.map((item) => item.id));
    const nowMs = now.getTime();
    const active = result.data
      .filter(
        (item) =>
          item.showAs !== 'free' &&
          item.start.getTime() <= nowMs &&
          item.end.getTime() > nowMs,
      )
      // OOF outranks busy outranks the rest when several overlap.
      .sort((a, b) => presenceRank(b.showAs) - presenceRank(a.showAs))[0];
    if (!active) return free;

    // Ours or the owner's own meeting? Match by APPOINTMENT ID (exact), not by
    // overlapping times — and drop any of our rows whose appointment was
    // deleted in Outlook while we were not looking.
    const admin = createAdminClient();
    const { data: rowData } = await admin
      .from('exchange_availability_blocks')
      .select(BLOCK_COLUMNS)
      .eq('user_id', (await requireUser()).id)
      .gt('ends_at', new Date().toISOString());
    const rows = (rowData ?? []) as BlockRow[];
    await reconcileBlocksWithCalendar(rows.map(toBlock), liveIds, rows);
    const ownedByApp = rows.some(
      (row) => liveIds.has(row.appointment_id) && row.appointment_id === activeIdOf(result.data, active),
    );

    return {
      showAs: (active.showAs === 'free' ? 'busy' : active.showAs) as AvailabilityShowAs,
      untilIso: active.end.toISOString(),
      ownedByApp,
    };
  } catch {
    return free;
  }
}

/** The appointment id of the window we picked as active. */
function activeIdOf(
  items: { id: string; start: Date; end: Date }[],
  active: { start: Date; end: Date },
): string | null {
  const match = items.find(
    (i) => i.start.getTime() === active.start.getTime() && i.end.getTime() === active.end.getTime(),
  );
  return match?.id ?? null;
}

function presenceRank(showAs: string): number {
  if (showAs === 'oof') return 3;
  if (showAs === 'busy') return 2;
  if (showAs === 'working_elsewhere') return 1;
  return 0;
}

export type AvailabilityWriteResult = { ok: true } | { ok: false; message: string };

/**
 * Create one constraint: writes the blocking appointment to Exchange first,
 * then records the correlation. Order matters — a row without a live
 * appointment would be a lie about the owner's availability, while an
 * appointment without a row (if the insert failed) is merely an item he can
 * delete manually, which is the strictly safer failure direction.
 */
export async function createAvailabilityBlock(input: {
  showAs: AvailabilityShowAs;
  startsAtIso: string;
  endsAtIso: string;
}): Promise<AvailabilityWriteResult> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');

  const start = new Date(input.startsAtIso);
  const end = new Date(input.endsAtIso);
  if (!(end.getTime() > start.getTime())) {
    return { ok: false, message: 'זמן הסיום חייב להיות אחרי זמן ההתחלה' };
  }

  const connection = await getMyActiveExchangeConnection();
  if (!connection) {
    return { ok: false, message: 'אין חיבור Exchange מאומת. חברו תיבה בהגדרות.' };
  }
  const loaded = await loadExchangeConfigForConnection(connection.id);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const preset = AVAILABILITY_PRESETS[input.showAs];
  const created = await calendarProvider.createAppointment(loaded.config, {
    subject: statusSubject(preset.label),
    start,
    end,
    showAs: input.showAs,
    category: STATUS_CATEGORY,
    private: true, // a status block is nobody else's business
  });
  if (!created.ok) {
    return { ok: false, message: 'עדכון הסטטוס מול Exchange נכשל. נסו שוב.' };
  }

  const admin = createAdminClient();
  const { error } = await admin.from('exchange_availability_blocks').insert({
    user_id: user.id,
    connection_id: connection.id,
    appointment_id: created.data.appointmentId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    show_as: input.showAs,
    label: preset.label,
  });
  if (error) {
    // The appointment exists but is now unmanaged — say so plainly rather
    // than reporting a success we cannot later undo from the UI.
    return {
      ok: false,
      message: 'הסטטוס נוצר ביומן אך לא נשמר במערכת. בדקו ביומן ומחקו ידנית אם צריך.',
    };
  }

  await logActivity({
    action: 'exchange.availability_block_created',
    meta: { showAs: input.showAs, connectionId: connection.id },
  });
  return { ok: true };
}

/** Remove one of MY constraints (deletes the Exchange appointment too). */
export async function deleteAvailabilityBlock(blockId: string): Promise<AvailabilityWriteResult> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();

  const { data, error } = await admin.from('exchange_availability_blocks')
    .select(BLOCK_COLUMNS)
    .eq('id', blockId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { ok: false, message: 'טעינת הסטטוס נכשלה' };
  if (!data) return { ok: false, message: 'הסטטוס לא נמצא' };
  const row = data as BlockRow;

  const loaded = await loadExchangeConfigForConnection(row.connection_id);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const deleted = await calendarProvider.deleteAppointment(loaded.config, row.appointment_id);
  // 'not_found' means it is already gone (deleted in Outlook) — that is the
  // desired end state, so treat it as success and clean up our row.
  if (!deleted.ok && deleted.error !== 'not_found') {
    return { ok: false, message: 'ביטול הסטטוס מול Exchange נכשל. נסו שוב.' };
  }

  await admin.from('exchange_availability_blocks')
    .delete()
    .eq('id', row.id)
    .eq('user_id', user.id); // scope re-asserted on the delete itself

  await logActivity({
    action: 'exchange.availability_block_deleted',
    meta: { blockId: row.id },
  });
  return { ok: true };
}

/**
 * "I'm available again": clears every constraint of mine that is in effect
 * right now. Future ones are left alone — they were scheduled deliberately.
 */
export async function clearActiveAvailabilityBlocks(): Promise<AvailabilityWriteResult> {
  const user = await requireUser();
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin.from('exchange_availability_blocks')
    .select(BLOCK_COLUMNS)
    .eq('user_id', user.id)
    .lte('starts_at', nowIso)
    .gt('ends_at', nowIso);
  if (error) return { ok: false, message: 'טעינת הסטטוס נכשלה' };

  const rows = (data ?? []) as BlockRow[];
  let failures = 0;
  for (const row of rows) {
    const result = await deleteAvailabilityBlock(row.id);
    if (!result.ok) failures += 1;
  }
  if (failures > 0) {
    return { ok: false, message: 'חלק מהסטטוסים לא בוטלו. נסו שוב.' };
  }
  return { ok: true };
}
