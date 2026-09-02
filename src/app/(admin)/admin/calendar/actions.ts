'use server';

import { unstable_rethrow } from 'next/navigation';

import {
  createMyExchangeCalendarEvent,
  deleteMyExchangeCalendarEvent,
  getMyExchangeCalendarEvent,
  listMyExchangeCalendarEvents,
  listMyExchangeCategories,
  updateMyExchangeCalendarEvent,
  type CalendarEventDTO,
  type CalendarEventDetailDTO,
} from '@/lib/data/exchange-connections';
import type { ExchangeCategory } from '@/lib/exchange-ews/types';
import { logActivity } from '@/lib/data/activity';
import { QUEUES } from '@/lib/queue/queues';
import { getWebJobSender } from '@/lib/queue/web-sender';
import {
  calendarConnectionSchema,
  calendarCreateEventSchema,
  calendarDeleteEventSchema,
  calendarEventIdSchema,
  calendarRangeSchema,
  calendarUpdateEventSchema,
} from '@/lib/validation/schemas';

// Data actions for the admin Exchange calendar. Authorization lives in the
// DAL (requireUser + requirePlatformPermission('manage_settings') on every
// call) — these stay thin: validate shape, call domain logic, return a safe
// result. No revalidatePath: the calendar owns its own refresh cycle
// (op-tracker) and nothing here feeds a server-rendered cache.

export type CalendarFetchResult =
  | { ok: true; events: CalendarEventDTO[] }
  | { ok: false; message: string };

export async function fetchCalendarEventsAction(input: {
  connectionId: string;
  startIso: string;
  endIso: string;
}): Promise<CalendarFetchResult> {
  const parsed = calendarRangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'טווח תאריכים לא תקין' };
  try {
    return await listMyExchangeCalendarEvents(parsed.data.connectionId, {
      startIso: parsed.data.startIso,
      endIso: parsed.data.endIso,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'טעינת היומן נכשלה. נסו שוב.' };
  }
}

export type CalendarCategoriesResult =
  | { ok: true; categories: ExchangeCategory[] }
  | { ok: false; message: string };

/**
 * The mailbox's category list, for the pickers in both forms.
 *
 * Fetched once by the calendar client rather than per dialog: the list is a
 * property of the mailbox, it changes only when the owner edits it in Outlook,
 * and an EWS round-trip on every dialog open would be paid for nothing.
 */
export async function fetchCalendarCategoriesAction(input: {
  connectionId: string;
}): Promise<CalendarCategoriesResult> {
  const parsed = calendarConnectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'מזהה חיבור לא תקין' };
  try {
    return await listMyExchangeCategories(parsed.data.connectionId);
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'טעינת הקטגוריות נכשלה.' };
  }
}

export type CalendarWriteResult = { ok: true } | { ok: false; message: string };

export type CalendarAttendeeInput = { email: string; name?: string; optional?: boolean };
export type CalendarRecurrenceInput = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  month?: number;
  occurrences?: number;
  endDateIso?: string;
};

export async function createCalendarEventAction(input: {
  connectionId: string;
  subject: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  location?: string;
  body?: string;
  reminderMinutes?: number;
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'working_elsewhere';
  sensitivity?: 'normal' | 'personal' | 'private' | 'confidential';
  category?: string;
  attendees?: CalendarAttendeeInput[];
  recurrence?: CalendarRecurrenceInput;
}): Promise<CalendarWriteResult> {
  const parsed = calendarCreateEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'קלט לא תקין' };
  }
  if (new Date(parsed.data.endIso) <= new Date(parsed.data.startIso)) {
    return { ok: false, message: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה' };
  }
  try {
    const result = await createMyExchangeCalendarEvent(parsed.data.connectionId, {
      subject: parsed.data.subject,
      startIso: parsed.data.startIso,
      endIso: parsed.data.endIso,
      allDay: parsed.data.allDay,
      ...(parsed.data.location !== undefined ? { location: parsed.data.location } : {}),
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      ...(parsed.data.reminderMinutes !== undefined
        ? { reminderMinutes: parsed.data.reminderMinutes }
        : {}),
      ...(parsed.data.sensitivity ? { sensitivity: parsed.data.sensitivity } : {}),
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
      ...(parsed.data.attendees?.length ? { attendees: parsed.data.attendees } : {}),
      ...(parsed.data.recurrence ? { recurrence: parsed.data.recurrence } : {}),
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'יצירת האירוע נכשלה. נסו שוב.' };
  }
}

export type CalendarDetailResult =
  | { ok: true; event: CalendarEventDetailDTO }
  | { ok: false; message: string };

/** Full detail for the edit dialog (location/body/reminder are not in the grid). */
export async function fetchCalendarEventAction(input: {
  connectionId: string;
  appointmentId: string;
}): Promise<CalendarDetailResult> {
  const parsed = calendarEventIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'מזהה אירוע לא תקין' };
  try {
    return await getMyExchangeCalendarEvent(
      parsed.data.connectionId,
      parsed.data.appointmentId,
    );
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'טעינת פרטי האירוע נכשלה.' };
  }
}


// An appointment edited here can BE a scheduled callback, and moving it moves
// when the AI actually dials. Two things follow, and neither used to happen.
//
// 1. RECORD IT. The same change made from the callback page logs
//    `callback.rescheduled` with the admin who made it; made here it left no
//    trace at all. The one thing this channel can offer that Outlook never
//    can is WHO — Graph exposes no last-modifier on a calendar event, and the
//    mailbox is reached with one application identity anyway, so a move made
//    in Outlook is unattributable by construction. Recorded from here it is
//    not.
//
// 2. WAKE THE SWEEP. reconcileCallbacksWithCalendar stays the SINGLE writer of
//    callback_requests.scheduled_at — a second writer here would mean two
//    sources of truth for one fact, and a half-written edit (Exchange ok, DB
//    not) would diverge permanently instead of converging on the next tick.
//    What the sweep lacked was timeliness: on its own it runs every 10 minutes,
//    so a meeting moved to sooner than that could still be dialled against the
//    old instant. Nudging it costs one enqueue and keeps the single-writer
//    design. The queue is created `policy: 'singleton'` (worker/main.ts), so a
//    nudge while it is already running cannot start a second pass.
//
// Both are best-effort AFTER the Exchange write has succeeded: the appointment
// really did move, and neither an audit row nor a nudge is worth failing that
// back to the admin. A missed nudge is picked up by the ordinary tick.
async function noteCalendarWrite(
  action: 'calendar.event_updated' | 'calendar.event_deleted',
  meta: Record<string, string>,
): Promise<void> {
  try {
    await logActivity({ action, meta });
  } catch {
    /* audit only — never fails the edit the admin already completed */
  }
  try {
    const boss = await getWebJobSender();
    await boss.send(QUEUES.callbackScheduleSweep, {});
  } catch {
    /* the 10-minute tick still reconciles this */
  }
}

export async function updateCalendarEventAction(input: {
  connectionId: string;
  appointmentId: string;
  startIso: string;
  endIso: string;
  subject?: string;
  location?: string;
  body?: string;
  allDay?: boolean;
  reminderMinutes?: number;
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'working_elsewhere';
  sensitivity?: 'normal' | 'personal' | 'private' | 'confidential';
  category?: string;
  attendees?: CalendarAttendeeInput[];
}): Promise<CalendarWriteResult> {
  const parsed = calendarUpdateEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'קלט לא תקין' };
  }
  if (new Date(parsed.data.endIso) <= new Date(parsed.data.startIso)) {
    return { ok: false, message: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה' };
  }
  try {
    const result = await updateMyExchangeCalendarEvent(parsed.data.connectionId, {
      appointmentId: parsed.data.appointmentId,
      startIso: parsed.data.startIso,
      endIso: parsed.data.endIso,
      ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
      ...(parsed.data.location !== undefined ? { location: parsed.data.location } : {}),
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      ...(parsed.data.allDay !== undefined ? { allDay: parsed.data.allDay } : {}),
      ...(parsed.data.reminderMinutes !== undefined
        ? { reminderMinutes: parsed.data.reminderMinutes }
        : {}),
      ...(parsed.data.showAs !== undefined ? { showAs: parsed.data.showAs } : {}),
      ...(parsed.data.sensitivity !== undefined
        ? { sensitivity: parsed.data.sensitivity }
        : {}),
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.attendees !== undefined ? { attendees: parsed.data.attendees } : {}),
    });
    if (result.ok) {
      await noteCalendarWrite('calendar.event_updated', {
        appointment_id: parsed.data.appointmentId,
        start_iso: parsed.data.startIso,
      });
    }
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'עדכון האירוע נכשל. נסו שוב.' };
  }
}

export async function deleteCalendarEventAction(input: {
  connectionId: string;
  appointmentId: string;
}): Promise<CalendarWriteResult> {
  const parsed = calendarDeleteEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'קלט לא תקין' };
  }
  try {
    const result = await deleteMyExchangeCalendarEvent(
      parsed.data.connectionId,
      parsed.data.appointmentId,
    );
    if (result.ok) {
      await noteCalendarWrite('calendar.event_deleted', {
        appointment_id: parsed.data.appointmentId,
      });
    }
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'מחיקת האירוע נכשלה. נסו שוב.' };
  }
}
