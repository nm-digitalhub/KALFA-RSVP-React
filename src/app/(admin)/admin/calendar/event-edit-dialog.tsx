'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  BellRing,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Trash2,
} from 'lucide-react';

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
import type { CalendarEventDetailDTO } from '@/lib/data/exchange-connections';
import {
  EventFormFields,
  REMINDER_OPTIONS as SHARED_REMINDERS,
  type EventFormValue,
} from './event-form-fields';
import { formatIsraelDate, formatIsraelDateTime } from '@/lib/date';

import {
  deleteCalendarEventAction,
  fetchCalendarEventAction,
  updateCalendarEventAction,
} from './actions';

// One appointment, in two modes.
//
// VIEW FIRST, EDIT ON REQUEST — the pattern every calendar uses: clicking a
// chip should let you LOOK at the event, not immediately put you in a form
// where a stray tap changes something. View mode also does things a form
// cannot: the location becomes a tappable navigation link (Waze/Maps from the
// phone), and times read as Hebrew prose instead of input widgets.
//
// Detail is fetched on open (location/body/reminder are deliberately absent
// from the grid listing, which stays lean); on save only the fields the owner
// touched are sent, so nothing typed in Outlook is ever wiped.


const REMINDER_OPTIONS = SHARED_REMINDERS;

function reminderLabel(minutes: number | null): string {
  if (!minutes) return 'ללא תזכורת';
  const match = REMINDER_OPTIONS.find((o) => o.value === minutes);
  if (match) return match.label;
  if (minutes % 1440 === 0) return `${minutes / 1440} ימים לפני`;
  if (minutes % 60 === 0) return `${minutes / 60} שעות לפני`;
  return `${minutes} דקות לפני`;
}

/** Universal maps link — opens the device's default navigation app. */
function mapsHref(location: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(location)}`;
}

/** Human time span: same-day events show the date once. */
function timeRangeText(startIso: string, endIso: string, allDay: boolean): string {
  if (allDay) return `${formatIsraelDate(startIso)} · יום שלם`;
  const startText = formatIsraelDateTime(startIso);
  const sameDay = formatIsraelDate(startIso) === formatIsraelDate(endIso);
  const endText = sameDay
    ? formatIsraelDateTime(endIso).split(', ').pop() ?? formatIsraelDateTime(endIso)
    : formatIsraelDateTime(endIso);
  return `${startText} — ${endText}`;
}




/** <input type="datetime-local"> speaks local wall time, not ISO instants. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): Date {
  return new Date(value);
}

export function EventEditDialog({
  connectionId,
  appointmentId,
  onClose,
  onSaved,
}: {
  connectionId: string;
  appointmentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Always opens in view mode; editing is an explicit choice.
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [detail, setDetail] = useState<CalendarEventDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same reason as the create dialog: a rejected field is at the top of a form
  // taller than its box, so the scroller is returned there on a validation stop.
  const scrollRef = useRef<HTMLDivElement>(null);

  // One draft object for the whole Outlook-parity field set (see
  // event-form-fields.tsx — the same component backs the create dialog).
  const [form, setForm] = useState<EventFormValue>({
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
  });

  useEffect(() => {
    if (!appointmentId) return;
    let cancelled = false;
    // State updates are deferred out of the synchronous effect body (React
    // forbids setState during the same commit — cascading renders); the
    // dialog opens on the very next tick with its loading state.
    const timer = setTimeout(() => {
      if (cancelled) return;
      setMode('view');
      setLoading(true);
      setError(null);
      void fetchCalendarEventAction({ connectionId, appointmentId })
        .then((res) => {
          if (cancelled) return;
          if (!res.ok) {
            setError(res.message);
            return;
          }
          setDetail(res.event);
          setForm({
            subject: res.event.title,
            startLocal: toLocalInput(res.event.startIso),
            endLocal: toLocalInput(res.event.endIso),
            allDay: res.event.allDay,
            location: res.event.location,
            body: res.event.body,
            reminderMinutes: res.event.reminderMinutes ?? 0,
            showAs: res.event.showAs,
            isPrivate: res.event.sensitivity === 'private',
            category: res.event.category,
            attendees: res.event.attendees,
            // Recurrence is not edited here — series items are read-only.
            recurrence: null,
          });
        })
        .catch(() => {
          if (!cancelled) setError('טעינת פרטי האירוע נכשלה.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [appointmentId, connectionId]);

  const save = useCallback(async () => {
    if (!appointmentId) return;
    const start = fromLocalInput(form.startLocal);
    const end = fromLocalInput(form.endLocal);
    if (!form.subject.trim()) {
      setError('נא להזין כותרת לאירוע');
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    if (!(end.getTime() > start.getTime())) {
      setError('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await updateCalendarEventAction({
        connectionId,
        appointmentId,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        subject: form.subject.trim(),
        location: form.location,
        body: form.body,
        allDay: form.allDay,
        reminderMinutes: form.reminderMinutes,
        showAs: form.showAs,
        sensitivity: form.isPrivate ? 'private' : 'normal',
        category: form.category,
        attendees: form.attendees,
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        setError(res.message);
      }
    } catch {
      setError('שמירת האירוע נכשלה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  }, [appointmentId, connectionId, form, onSaved, onClose]);

  const remove = useCallback(async () => {
    if (!appointmentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteCalendarEventAction({ connectionId, appointmentId });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        setError(res.message);
      }
    } catch {
      setError('מחיקת האירוע נכשלה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  }, [appointmentId, connectionId, onSaved, onClose]);

  const readOnly = detail?.readOnly === true;

  return (
    <AlertDialog
      open={appointmentId !== null}
      onOpenChange={(open: boolean) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === 'view' ? (detail?.title || 'אירוע ביומן') : 'עריכת אירוע ביומן'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {readOnly
              ? 'אירוע מסדרה חוזרת — ניתן לעריכה רק דרך Outlook.'
              : mode === 'view'
                ? 'פרטי האירוע מיומן ה-Exchange.'
                : 'השינויים נשמרים ישירות ביומן ה-Exchange.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* The Outlook-parity field set runs long on a phone; without a cap
            here the dialog (fixed + vertically centered, no scroll of its
            own) can grow taller than the viewport and push the footer's
            save button off-screen. The two scrollbar knobs are explained in
            calendar-client.tsx — classic vs overlay scrollbars need different
            treatment and neither substitutes for the other. */}
        <div
          ref={scrollRef}
          className="max-h-[60dvh] -me-2 overflow-y-auto pe-2 scrollbar-gutter-stable"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              טוען פרטים…
            </div>
          ) : mode === 'view' && detail ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{timeRangeText(detail.startIso, detail.endIso, detail.allDay)}</span>
              </div>

              {detail.location ? (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {/* The whole point of view mode: a tappable address that hands
                      off to the phone's navigation app. */}
                  <a
                    href={mapsHref(detail.location)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                  >
                    {detail.location}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </div>
              ) : null}

              <div className="flex items-start gap-2">
                <BellRing className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{reminderLabel(detail.reminderMinutes)}</span>
              </div>

              {detail.body ? (
                <div className="flex items-start gap-2">
                  <AlignLeft className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="whitespace-pre-wrap text-muted-foreground">{detail.body}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <EventFormFields
              value={form}
              onChange={setForm}
              disabled={readOnly || busy}
              // Editing a recurrence is out of scope: series items are
              // read-only, so the control would have nothing to act on.
              showRecurrence={false}
            />
          )}
        </div>

        {/* Rendered for BOTH modes, outside the scroller. It used to live
            inside the view-mode branch only, so a failed save in edit mode set
            an error string that nothing displayed — the dialog just sat there. */}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <AlertDialogFooter>
          {mode === 'view' ? (
            <>
              {!readOnly && !loading ? (
                <Button variant="outline" onClick={() => void remove()} disabled={busy}>
                  <Trash2 className="size-4" aria-hidden />
                  מחיקה
                </Button>
              ) : null}
              <AlertDialogCancel disabled={busy}>סגירה</AlertDialogCancel>
              {!readOnly ? (
                <Button onClick={() => setMode('edit')} disabled={busy || loading}>
                  <Pencil className="size-4" aria-hidden />
                  עריכה
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>
                ביטול
              </Button>
              <Button onClick={() => void save()} disabled={busy || loading}>
                {busy ? 'שומר…' : 'שמירה'}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
