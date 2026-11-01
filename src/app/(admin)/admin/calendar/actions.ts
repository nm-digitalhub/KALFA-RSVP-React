'use server';

import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';

import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  createMyExchangeCalendarEvent,
  deleteMyExchangeCalendarEvent,
  getMyExchangeCalendarEvent,
  listMyExchangeCalendarEvents,
  listMyExchangeCategories,
  updateMyExchangeCalendarEvent,
} from '@/lib/data/exchange-connections';
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
//
// The calendar shows ONE sentence per failure. A rejected input is answered with a
// fixed sentence (the reads) or with the first problem the schema found (the writes).

function fixedMessage(message: string) {
  return async () => ({ formErrors: [message], fieldErrors: {} });
}

function firstIssue(schema: z.ZodType) {
  return async (_errors: unknown, { clientInput }: { clientInput: unknown }) => ({
    formErrors: [schema.safeParse(clientInput).error?.issues[0]?.message ?? 'קלט לא תקין'],
    fieldErrors: {},
  });
}

export const fetchCalendarEventsAction = actionClient
  .inputSchema(calendarRangeSchema, { handleValidationErrorsShape: fixedMessage('טווח תאריכים לא תקין') })
  .action(async ({ parsedInput: { connectionId, startIso, endIso } }) => {
    let result: Awaited<ReturnType<typeof listMyExchangeCalendarEvents>>;
    try {
      result = await listMyExchangeCalendarEvents(connectionId, { startIso, endIso });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('טעינת היומן נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    return { events: result.events };
  });

/**
 * The mailbox's category list, for the pickers in both forms.
 *
 * Fetched once by the calendar client rather than per dialog: the list is a
 * property of the mailbox, it changes only when the owner edits it in Outlook,
 * and a mailbox round-trip on every dialog open would be paid for nothing.
 */
export const fetchCalendarCategoriesAction = actionClient
  .inputSchema(calendarConnectionSchema, { handleValidationErrorsShape: fixedMessage('מזהה חיבור לא תקין') })
  .action(async ({ parsedInput: { connectionId } }) => {
    let result: Awaited<ReturnType<typeof listMyExchangeCategories>>;
    try {
      result = await listMyExchangeCategories(connectionId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('טעינת הקטגוריות נכשלה.');
    }
    if (!result.ok) returnUserError(result.message);
    return { categories: result.categories };
  });

export const createCalendarEventAction = actionClient
  .inputSchema(calendarCreateEventSchema, { handleValidationErrorsShape: firstIssue(calendarCreateEventSchema) })
  .action(async ({ parsedInput }) => {
    if (new Date(parsedInput.endIso) <= new Date(parsedInput.startIso)) {
      returnUserError('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
    }
    let result: Awaited<ReturnType<typeof createMyExchangeCalendarEvent>>;
    try {
      result = await createMyExchangeCalendarEvent(parsedInput.connectionId, {
        subject: parsedInput.subject,
        startIso: parsedInput.startIso,
        endIso: parsedInput.endIso,
        allDay: parsedInput.allDay,
        ...(parsedInput.location !== undefined ? { location: parsedInput.location } : {}),
        ...(parsedInput.body !== undefined ? { body: parsedInput.body } : {}),
        ...(parsedInput.reminderMinutes !== undefined
          ? { reminderMinutes: parsedInput.reminderMinutes }
          : {}),
        ...(parsedInput.sensitivity ? { sensitivity: parsedInput.sensitivity } : {}),
        ...(parsedInput.category ? { category: parsedInput.category } : {}),
        ...(parsedInput.attendees?.length ? { attendees: parsedInput.attendees } : {}),
        ...(parsedInput.recurrence ? { recurrence: parsedInput.recurrence } : {}),
      });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('יצירת האירוע נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
  });

/** Full detail for the edit dialog (location/body/reminder are not in the grid). */
export const fetchCalendarEventAction = actionClient
  .inputSchema(calendarEventIdSchema, { handleValidationErrorsShape: fixedMessage('מזהה אירוע לא תקין') })
  .action(async ({ parsedInput: { connectionId, appointmentId } }) => {
    let result: Awaited<ReturnType<typeof getMyExchangeCalendarEvent>>;
    try {
      result = await getMyExchangeCalendarEvent(connectionId, appointmentId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('טעינת פרטי האירוע נכשלה.');
    }
    if (!result.ok) returnUserError(result.message);
    return { event: result.event };
  });

// An appointment edited here can BE a scheduled callback, and moving it moves
// when the AI actually dials. Two things follow.
//
// 1. RECORD IT. The same change made from the callback page logs
//    `callback.rescheduled` with the admin who made it; made here it is logged
//    as `calendar.event_updated` / `calendar.event_deleted` with the admin who
//    made it. The one thing this channel can offer that Outlook never
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

export const updateCalendarEventAction = actionClient
  .inputSchema(calendarUpdateEventSchema, { handleValidationErrorsShape: firstIssue(calendarUpdateEventSchema) })
  .action(async ({ parsedInput }) => {
    if (new Date(parsedInput.endIso) <= new Date(parsedInput.startIso)) {
      returnUserError('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
    }
    let result: Awaited<ReturnType<typeof updateMyExchangeCalendarEvent>>;
    try {
      result = await updateMyExchangeCalendarEvent(parsedInput.connectionId, {
        appointmentId: parsedInput.appointmentId,
        startIso: parsedInput.startIso,
        endIso: parsedInput.endIso,
        ...(parsedInput.subject !== undefined ? { subject: parsedInput.subject } : {}),
        ...(parsedInput.location !== undefined ? { location: parsedInput.location } : {}),
        ...(parsedInput.body !== undefined ? { body: parsedInput.body } : {}),
        ...(parsedInput.allDay !== undefined ? { allDay: parsedInput.allDay } : {}),
        ...(parsedInput.reminderMinutes !== undefined
          ? { reminderMinutes: parsedInput.reminderMinutes }
          : {}),
        ...(parsedInput.showAs !== undefined ? { showAs: parsedInput.showAs } : {}),
        ...(parsedInput.sensitivity !== undefined
          ? { sensitivity: parsedInput.sensitivity }
          : {}),
        ...(parsedInput.category !== undefined ? { category: parsedInput.category } : {}),
        ...(parsedInput.attendees !== undefined ? { attendees: parsedInput.attendees } : {}),
      });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון האירוע נכשל. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    await noteCalendarWrite('calendar.event_updated', {
      appointment_id: parsedInput.appointmentId,
      start_iso: parsedInput.startIso,
    });
  });

export const deleteCalendarEventAction = actionClient
  .inputSchema(calendarDeleteEventSchema, { handleValidationErrorsShape: firstIssue(calendarDeleteEventSchema) })
  .action(async ({ parsedInput: { connectionId, appointmentId } }) => {
    let result: Awaited<ReturnType<typeof deleteMyExchangeCalendarEvent>>;
    try {
      result = await deleteMyExchangeCalendarEvent(connectionId, appointmentId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('מחיקת האירוע נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    await noteCalendarWrite('calendar.event_deleted', { appointment_id: appointmentId });
  });
