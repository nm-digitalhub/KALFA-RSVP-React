'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { addDays } from 'date-fns';
import { he } from 'date-fns/locale';
import { RefreshCw, X } from 'lucide-react';

import { Alert, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { EventCalendar } from '@/components/reui/event-calendar/event-calendar';
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content';
import { EventCalendarNav } from '@/components/reui/event-calendar/event-calendar-nav';
import type {
  CalendarEvent,
  EventCalendarProposedUpdate,
  EventCalendarRangeInfo,
  EventCalendarSlotDraft,
  EventCalendarSlotInfo,
  EventCalendarUpdateResult,
} from '@/components/reui/event-calendar/event-calendar-types';
import type { CalendarEventDTO } from '@/lib/data/exchange-connections';
import { formatIsraelDateTime } from '@/lib/date';

import type { ExchangeCategory } from '@/lib/exchange-ews/types';

import {
  createCalendarEventAction,
  fetchCalendarCategoriesAction,
  fetchCalendarEventsAction,
  updateCalendarEventAction,
} from './actions';
import { CALENDAR_I18N_HE } from './calendar-he';
import { EventEditDialog } from './event-edit-dialog';
import { EventFormFields, type EventFormValue } from './event-form-fields';
import { CalendarOpTracker } from './op-tracker';

// The admin Exchange calendar client. Exchange is the single source of truth:
// nothing is persisted locally, every visible range is fetched live, and the
// owner-approved write mechanism (27.07) applies —
//   * onEventUpdate stays SYNCHRONOUS: immediate reject only for readOnly /
//     series-linked items or a same-event pending write; everything else is
//     accepted optimistically and the Server Action fires WITHOUT await.
//   * on failure: an error message is appended (never replacing another
//     failure) and an authoritative range refresh realigns the UI with
//     Exchange — no manual snapshot rollback.
//   * concurrency is delegated to CalendarOpTracker (op ids, stale-refresh
//     discard, refresh-after-idle, per-event pending lock) — unit-tested in
//     op-tracker.test.ts.

// Friday+Saturday — not the component's US default of [0, 6].
const ISRAEL_WEEKEND = [5, 6];

// Auto-refresh cadence while the tab is visible. 60s is well inside "feels
// live" for a business calendar and is a trivial load on the mailbox (one
// range read); focus/visibility changes refresh immediately regardless.
const AUTO_REFRESH_MS = 60_000;

// A fresh draft; the grid click fills in the times before the dialog opens.
const EMPTY_CREATE_FORM: EventFormValue = {
  subject: '',
  startLocal: '',
  endLocal: '',
  allDay: false,
  location: '',
  body: '',
  reminderMinutes: 15,
  showAs: 'busy',
  isPrivate: false,
  category: '',
  attendees: [],
  recurrence: null,
};

/** <input type="datetime-local"> speaks local wall time, not ISO instants. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}


type UiError = { key: string; message: string };

function dtoToEvent(dto: CalendarEventDTO): CalendarEvent {
  return {
    id: dto.id,
    title: dto.title,
    start: new Date(dto.startIso),
    end: new Date(dto.endIso),
    allDay: dto.allDay,
    readOnly: dto.readOnly,
  };
}

export function AdminExchangeCalendar({
  connectionId,
  mailboxEmail,
}: {
  connectionId: string;
  mailboxEmail: string;
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // Loading is COUNTED, not a hand-toggled boolean (owner review 27.07): every
  // runRefresh increments before the fetch and decrements in finally, so no
  // stale-discard/early-return/throw path can ever strand the UI in a stuck
  // loading state. `loading` is simply "any refresh in flight".
  const [activeRefreshes, setActiveRefreshes] = useState(0);
  const loading = activeRefreshes > 0;
  const [uiErrors, setUiErrors] = useState<UiError[]>([]);
  const [createDraft, setCreateDraft] = useState<{
    start: Date;
    end: Date;
    allDay: boolean;
  } | null>(null);
  // The appointment currently open in the edit dialog (null = closed).
  const [editingId, setEditingId] = useState<string | null>(null);
  /** undefined = still loading; [] = none available, picker degrades to text. */
  const [categories, setCategories] = useState<ExchangeCategory[] | undefined>(undefined);
  // The full Outlook-parity draft (same component as the edit dialog).
  const [createForm, setCreateForm] = useState<EventFormValue>(EMPTY_CREATE_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // useState initializer = React's sanctioned one-time construction (the
  // react-hooks/refs rule rejects lazy-ref init during render). The tracker
  // is deliberately mutable and lives OUTSIDE React state semantics — only
  // event handlers/effects ever call it; nothing renders from it directly.
  const [tracker] = useState(() => new CalendarOpTracker());

  const rangeRef = useRef<{ startIso: string; endIso: string } | null>(null);
  const errorKeyRef = useRef(0);
  // The create dialog's scroll box — a rejected field lives at the top, so the
  // scroller is returned there instead of leaving the owner to hunt for it.
  const createScrollRef = useRef<HTMLDivElement>(null);

  const appendError = useCallback((message: string) => {
    const key = `err-${++errorKeyRef.current}`;
    setUiErrors((prev) => [...prev, { key, message }]);
  }, []);

  // Self-reference without a TDZ violation (react-hooks forbids reading a
  // useCallback binding inside its own body): the stale-discard path re-runs
  // the LATEST refresh through this ref, assigned in the effect below.
  const runRefreshRef = useRef<() => void>(() => {});

  const runRefresh = useCallback(async () => {
    const range = rangeRef.current;
    if (!range) return;
    const token = tracker.beginRefresh();
    setActiveRefreshes((n) => n + 1);
    try {
      const res = await fetchCalendarEventsAction({
        connectionId,
        startIso: range.startIso,
        endIso: range.endIso,
      });
      if (!tracker.shouldApplyRefresh(token)) {
        // Stale (a newer write or refresh began meanwhile) — discard. If the
        // tracker is idle again, chase the fresh state now; otherwise the
        // deferred-refresh guarantee (op-tracker rule 3, unit-tested) fires
        // it when the last pending write settles.
        if (tracker.requestRefresh()) runRefreshRef.current();
        return;
      }
      if (res.ok) {
        setEvents(res.events.map(dtoToEvent));
      } else {
        appendError(res.message);
      }
    } catch {
      if (tracker.shouldApplyRefresh(token)) {
        appendError('טעינת היומן נכשלה. נסו לרענן.');
      }
    } finally {
      setActiveRefreshes((n) => n - 1);
    }
  }, [appendError, connectionId, tracker]);

  useEffect(() => {
    runRefreshRef.current = () => void runRefresh();
  }, [runRefresh]);

  const requestAuthoritativeRefresh = useCallback(() => {
    if (tracker.requestRefresh()) void runRefresh();
  }, [runRefresh, tracker]);

  // The mailbox's category list, fetched ONCE for the screen. It belongs to the
  // mailbox, not to any appointment, and changes only when the owner edits it
  // in Outlook — so paying an EWS round-trip per dialog open would buy nothing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchCalendarCategoriesAction({ connectionId });
      if (cancelled) return;
      // A failure here must never block editing: an empty list makes the picker
      // fall back to free text, which still writes a valid category.
      setCategories(res.ok ? res.categories : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const settleWrite = useCallback(
    (eventId: string, opId: number, failureMessage?: string) => {
      if (failureMessage) appendError(failureMessage);
      const fireNow = tracker.settleWrite(eventId, opId, failureMessage);
      if (fireNow) void runRefresh();
    },
    [appendError, runRefresh, tracker],
  );

  const handleRangeChange = useCallback(
    (info: EventCalendarRangeInfo) => {
      rangeRef.current = {
        startIso: info.range.start.toISOString(),
        endIso: info.range.end.toISOString(),
      };
      requestAuthoritativeRefresh();
    },
    [requestAuthoritativeRefresh],
  );

  // Keep the view current WITHOUT the owner having to press anything
  // (owner requirement 28.07). Three triggers, cheapest first:
  //   * window focus / tab becomes visible — the common "I just edited this
  //     in Outlook on my phone and came back" case, refreshed instantly;
  //   * a periodic poll while the tab is visible — catches changes made
  //     elsewhere while the tab simply sits open;
  //   * (plus every navigation and every write, as before).
  // The poll is deliberately paused when the tab is hidden: a background tab
  // has no reader, and Exchange is a third-party network hop.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') requestAuthoritativeRefresh();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    const poll = setInterval(onWake, AUTO_REFRESH_MS);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      clearInterval(poll);
    };
  }, [requestAuthoritativeRefresh]);

  // The synchronous decision funnel (owner-approved): reject only on rules
  // known instantly client-side; otherwise accept optimistically and launch
  // the persist WITHOUT awaiting — EventCalendarUpdateResult has no Promise
  // arm (verified against the installed types).
  const handleEventUpdate = useCallback(
    (update: EventCalendarProposedUpdate): EventCalendarUpdateResult => {
      const event = update.event;
      if (event.readOnly) return false; // series-linked — belt & braces (chip is drag-locked anyway)
      if (!tracker.canStartWrite(event.id)) {
        appendError('שינוי קודם לאירוע זה עדיין נשמר — המתינו רגע ונסו שוב.');
        return false;
      }
      const opId = tracker.startWrite(event.id);
      void updateCalendarEventAction({
        connectionId,
        appointmentId: event.id,
        startIso: update.start.toISOString(),
        endIso: update.end.toISOString(),
      })
        .then((res) => settleWrite(event.id, opId, res.ok ? undefined : res.message))
        .catch(() => settleWrite(event.id, opId, 'עדכון האירוע נכשל. נסו שוב.'));
      return true;
    },
    [appendError, connectionId, settleWrite, tracker],
  );

  const handleEventClick = useCallback((occurrence: { event: CalendarEvent }) => {
    setEditingId(occurrence.event.id);
  }, []);

  const handleDragBlocked = useCallback(() => {
    appendError('אירוע מסדרה חוזרת — עריכה זמינה בשלב זה רק דרך Outlook/OWA.');
  }, [appendError]);

  const openCreate = useCallback((start: Date, end: Date, allDay: boolean) => {
    setCreateForm({
      ...EMPTY_CREATE_FORM,
      startLocal: toLocalInputValue(start),
      endLocal: toLocalInputValue(end),
      allDay,
    });
    setCreateError(null);
    setCreateDraft({ start, end, allDay });
  }, []);

  const handleSlotClick = useCallback(
    (slot: EventCalendarSlotInfo) => {
      // addDays (not +24h in ms): an Israel calendar day is 23/25 hours on
      // DST transition days; the component hands day-granular dates as
      // display-zone midnights (TZDate), and addDays preserves that wall
      // clock across the transition. Timed slots stay a plain +30min instant.
      const end =
        slot.end ??
        (slot.allDay ? addDays(slot.date, 1) : new Date(slot.date.getTime() + 30 * 60_000));
      openCreate(slot.date, end, slot.allDay);
    },
    [openCreate],
  );

  const handleSelectSlot = useCallback(
    (slot: EventCalendarSlotDraft) => {
      openCreate(slot.start, slot.end, slot.allDay);
    },
    [openCreate],
  );

  // Creation is NOT optimistic — the real ItemId only exists after Exchange
  // answers, so the dialog waits and the authoritative refresh brings the new
  // event in with its true id.
  const submitCreate = useCallback(async () => {
    if (!createDraft) return;
    const subject = createForm.subject.trim();
    // Both rejected fields sit at the top of a form taller than the box, so the
    // scroller is sent back to them — otherwise pressing "create" just puts a
    // message under a field the owner can't see.
    if (!subject) {
      setCreateError('נא להזין כותרת לאירוע');
      createScrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    const start = new Date(createForm.startLocal);
    const end = new Date(createForm.endLocal);
    if (!(end.getTime() > start.getTime())) {
      setCreateError('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
      createScrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    setCreateBusy(true);
    try {
      const res = await createCalendarEventAction({
        connectionId,
        subject,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        allDay: createForm.allDay,
        location: createForm.location,
        body: createForm.body,
        reminderMinutes: createForm.reminderMinutes,
        showAs: createForm.showAs,
        sensitivity: createForm.isPrivate ? 'private' : 'normal',
        category: createForm.category,
        attendees: createForm.attendees,
        ...(createForm.recurrence
          ? {
              recurrence: {
                frequency: createForm.recurrence.frequency,
                interval: createForm.recurrence.interval,
                ...(createForm.recurrence.daysOfWeek
                  ? { daysOfWeek: createForm.recurrence.daysOfWeek }
                  : {}),
                ...(createForm.recurrence.endDateIso
                  ? { endDateIso: createForm.recurrence.endDateIso }
                  : {}),
              },
            }
          : {}),
      });
      if (res.ok) {
        setCreateDraft(null);
        requestAuthoritativeRefresh();
      } else {
        setCreateError(res.message);
      }
    } catch {
      setCreateError('יצירת האירוע נכשלה. נסו שוב.');
    } finally {
      setCreateBusy(false);
    }
  }, [connectionId, createDraft, createForm, requestAuthoritativeRefresh]);

  const dismissError = useCallback((key: string) => {
    setUiErrors((prev) => prev.filter((e) => e.key !== key));
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          תיבה מחוברת: <span className="font-medium text-foreground">{mailboxEmail}</span>
          {' · '}אירועים מסדרה חוזרת מוצגים לקריאה בלבד.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={requestAuthoritativeRefresh}
          disabled={loading}
        >
          <RefreshCw className="size-4" aria-hidden />
          רענון מהתיבה
        </Button>
      </div>

      {/* Rule 5: failures render as a LIST — a new failure never hides an
          earlier one; each is dismissed individually. */}
      {uiErrors.length > 0 && (
        <div className="space-y-2">
          {uiErrors.map((err) => (
            <Alert key={err.key} variant="destructive">
              <AlertTitle className="flex items-center justify-between gap-2">
                <span>{err.message}</span>
                <button
                  type="button"
                  aria-label="סגירת ההודעה"
                  className="shrink-0 rounded p-0.5 hover:bg-muted"
                  onClick={() => dismissError(err.key)}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </AlertTitle>
            </Alert>
          ))}
        </div>
      )}

      <EventCalendar
        events={events}
        onEventsChange={setEvents}
        defaultView="month"
        views={['month', 'week', 'day', 'agenda']}
        timeZone="Asia/Jerusalem"
        locale={he}
        weekStartsOn={0}
        weekendDays={ISRAEL_WEEKEND}
        offDays={{ weekendDays: ISRAEL_WEEKEND }}
        i18n={CALENDAR_I18N_HE}
        loading={loading}
        scrollToHour={8}
        onRangeChange={handleRangeChange}
        onEventUpdate={handleEventUpdate}
        onEventClick={handleEventClick}
        onDragBlocked={handleDragBlocked}
        onSlotClick={handleSlotClick}
        onSelectSlot={handleSelectSlot}
        // Hover/focus peek — title + time without opening anything. Complements
        // the click-to-view dialog for the "what is that block?" glance.
        eventTooltip={{ side: 'top', delay: 350 }}
        className="h-[70dvh] min-h-[520px] rounded-lg border border-border bg-card"
      >
        <EventCalendarNav />
        <EventCalendarContent />
      </EventCalendar>

      {/* Full edit for an existing appointment (title, times, location,
          reminder, description) — opened by clicking its chip. */}
      <EventEditDialog
        connectionId={connectionId}
        appointmentId={editingId}
        categories={categories}
        onClose={() => setEditingId(null)}
        onSaved={requestAuthoritativeRefresh}
      />

      {/* Create dialog — opened by a slot click / drag-create selection. */}
      <AlertDialog
        open={createDraft !== null}
        onOpenChange={(open: boolean) => {
          if (!open && !createBusy) setCreateDraft(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>אירוע חדש ביומן Exchange</AlertDialogTitle>
            <AlertDialogDescription>
              {createDraft
                ? createDraft.allDay
                  ? `יום שלם · ${formatIsraelDateTime(createDraft.start.toISOString()).split(',')[0] ?? ''}`
                  : `${formatIsraelDateTime(createDraft.start.toISOString())} — ${formatIsraelDateTime(createDraft.end.toISOString())}`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Capped + scrollable: the full field set is taller than a phone
              viewport, and the fixed, centered dialog has no scroll of its own —
              without this the footer's create button can end up off-screen.
              Keeping the bar off the fields needs BOTH knobs, because neither
              covers the other platform (MDN: scrollbar-gutter has no effect
              with overlay scrollbars):
                * scrollbar-gutter-stable — classic scrollbars (Windows/Linux,
                  macOS set to always-show): reserves a real gutter, so the bar
                  never overlaps content and the form doesn't shift when it grows;
                * -me-2 pe-2 — overlay scrollbars (iOS/iPadOS, macOS default):
                  the box reaches 8px further into the dialog's own p-4, while
                  the content is padded back, leaving the floating thumb a lane
                  of its own. Same -me-2 the vendored month-view "+more" list uses. */}
          <div
            ref={createScrollRef}
            className="max-h-[60dvh] -me-2 overflow-y-auto pe-2 scrollbar-gutter-stable"
          >
            <EventFormFields
              value={createForm}
              onChange={setCreateForm}
              disabled={createBusy}
              categories={categories}
            />
          </div>

          {/* OUTSIDE the scroller on purpose: a validation error about a field
              at the top of the form used to render at the bottom of a scrolled
              box, so pressing "create" looked like nothing happened. */}
          {createError ? (
            <p className="text-sm text-destructive">{createError}</p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={createBusy}>ביטול</AlertDialogCancel>
            <Button onClick={() => void submitCreate()} disabled={createBusy}>
              {createBusy ? 'יוצר…' : 'יצירת האירוע'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
