'use client';

import type { ChangeEvent, ReactNode } from 'react';
import { useState } from 'react';
import { ChevronDown, Plus, Repeat, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';

// The Outlook-parity field set, shared by the create dialog and the edit
// dialog so the two can never drift. Mirrors the mobile Outlook "new event"
// sheet: title, people, all-day + times, recurrence, location, description,
// reminder, show-as, private — grouped into the same Time / Location &
// description / Reminder & privacy sections Outlook uses.
//
// Everything here is REAL: each control maps to an Exchange property the
// provider actually writes (Appointment.Location, RequiredAttendees,
// Recurrence, LegacyFreeBusyStatus, Sensitivity, Categories,
// ReminderMinutesBeforeStart). Nothing is decorative.

export const FIELD_INPUT_CLASS =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60';

// Safari (notably iOS) sizes <input type="date"|"datetime-local"> by its own
// native chrome, not CSS width: the grid item's default `min-width: auto`
// lets that intrinsic size win over the track, pushing the field past the
// dialog edge. `min-w-0` lets it actually shrink; `appearance-none` drops the
// oversized native chrome; the value text also defaults to centered in
// WebKit, so it's re-aligned to the (RTL) reading start via the internal
// pseudo-element.
const FIELD_DATE_INPUT_CLASS = cn(
  FIELD_INPUT_CLASS,
  'min-w-0 appearance-none [&::-webkit-date-and-time-value]:text-start',
);

export type AttendeeDraft = { email: string; name?: string; optional?: boolean };

export type RecurrenceDraft = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  daysOfWeek?: number[];
  occurrences?: number;
  endDateIso?: string;
};

export type EventFormValue = {
  subject: string;
  startLocal: string;
  endLocal: string;
  allDay: boolean;
  location: string;
  body: string;
  reminderMinutes: number;
  showAs: 'free' | 'tentative' | 'busy' | 'oof' | 'working_elsewhere';
  isPrivate: boolean;
  category: string;
  attendees: AttendeeDraft[];
  recurrence: RecurrenceDraft | null;
};

export const REMINDER_OPTIONS = [
  { value: 0, label: 'ללא תזכורת' },
  { value: 5, label: '5 דקות לפני' },
  { value: 15, label: '15 דקות לפני' },
  { value: 30, label: '30 דקות לפני' },
  { value: 60, label: 'שעה לפני' },
  { value: 120, label: 'שעתיים לפני' },
  { value: 1440, label: 'יום לפני' },
  { value: 10080, label: 'שבוע לפני' },
];

export const SHOW_AS_OPTIONS = [
  { value: 'busy', label: 'לא פנוי' },
  { value: 'free', label: 'פנוי' },
  { value: 'tentative', label: 'משוער' },
  { value: 'oof', label: 'מחוץ למשרד' },
  { value: 'working_elsewhere', label: 'עובד מרחוק' },
] as const;

// Outlook's own category palette names, so what we write is recognised there.
export const CATEGORY_OPTIONS = [
  { value: '', label: 'ללא קטגוריה', dot: 'bg-muted-foreground/40' },
  { value: 'Red category', label: 'אדום', dot: 'bg-red-500' },
  { value: 'Orange category', label: 'כתום', dot: 'bg-orange-500' },
  { value: 'Yellow category', label: 'צהוב', dot: 'bg-yellow-400' },
  { value: 'Green category', label: 'ירוק', dot: 'bg-emerald-500' },
  { value: 'Blue category', label: 'כחול', dot: 'bg-blue-500' },
  { value: 'Purple category', label: 'סגול', dot: 'bg-purple-500' },
];

const WEEKDAYS = [
  { value: 0, label: 'א' },
  { value: 1, label: 'ב' },
  { value: 2, label: 'ג' },
  { value: 3, label: 'ד' },
  { value: 4, label: 'ה' },
  { value: 5, label: 'ו' },
  { value: 6, label: 'ש' },
];

/** Adds whole days to a `YYYY-MM-DD` string using local-calendar arithmetic.
 *  `setDate` survives Israel's DST transitions; adding 86_400_000 ms does not. */
function shiftDateOnly(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00`);
  if (Number.isNaN(d.getTime())) return dateOnly;
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'כל יום' },
  { value: 'weekly', label: 'כל שבוע' },
  { value: 'monthly', label: 'כל חודש' },
  { value: 'yearly', label: 'כל שנה' },
] as const;

/** Groups related fields under a labeled divider, mirroring Outlook's Time /
 *  Location / Reminder sections instead of one flat field list. */
function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{title}</span>
        <Separator className="flex-1" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Native <select> styled to match FIELD_INPUT_CLASS with a drawn-on chevron.
 *  The browser's own arrow is inconsistent across engines and doesn't always
 *  mirror for RTL, so it's hidden (appearance-none) and redrawn at the
 *  reading end — the same placement the shared Select primitive uses. */
function FieldSelect({
  id,
  value,
  onChange,
  disabled,
  ariaLabel,
  className,
  children,
}: {
  id?: string;
  value: string | number;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={onChange}
        className={cn(FIELD_INPUT_CLASS, 'appearance-none pe-8', className)}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

export function EventFormFields({
  value,
  onChange,
  disabled = false,
  showRecurrence = true,
}: {
  value: EventFormValue;
  onChange: (next: EventFormValue) => void;
  disabled?: boolean;
  /** Recurrence is creation-only: series items are read-only once they exist. */
  showRecurrence?: boolean;
}) {
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [attendeeError, setAttendeeError] = useState<string | null>(null);

  const set = <K extends keyof EventFormValue>(key: K, next: EventFormValue[K]) =>
    onChange({ ...value, [key]: next });

  function addAttendee() {
    const email = attendeeEmail.trim();
    if (!email) return;
    // Same shape the server validates; catching it here avoids a round trip.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAttendeeError('כתובת אימייל לא תקינה');
      return;
    }
    if (value.attendees.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
      setAttendeeError('המשתתף כבר ברשימה');
      return;
    }
    setAttendeeError(null);
    setAttendeeEmail('');
    set('attendees', [...value.attendees, { email }]);
  }

  const recurrence = value.recurrence;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="ef-subject" className="text-sm font-medium">כותרת</label>
        <input
          id="ef-subject"
          type="text"
          value={value.subject}
          disabled={disabled}
          onChange={(e) => set('subject', e.target.value)}
          maxLength={255}
          className={FIELD_INPUT_CLASS}
        />
      </div>

      {/* People — a non-empty list makes Exchange send real invitations. */}
      <div className="space-y-1">
        <label htmlFor="ef-attendee" className="text-sm font-medium">
          אנשים{' '}
          <span className="text-xs text-muted-foreground">(יישלחו הזמנות במייל)</span>
        </label>
        <div className="flex gap-2">
          <input
            id="ef-attendee"
            type="email"
            value={attendeeEmail}
            disabled={disabled}
            placeholder="name@example.com"
            onChange={(e) => setAttendeeEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAttendee();
              }
            }}
            className={FIELD_INPUT_CLASS}
          />
          <button
            type="button"
            onClick={addAttendee}
            disabled={disabled}
            aria-label="הוספת משתתף"
            className="shrink-0 rounded-md border border-border px-3 hover:bg-accent disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        {attendeeError ? <p className="text-xs text-destructive">{attendeeError}</p> : null}
        {value.attendees.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {value.attendees.map((person) => (
              <li
                key={person.email}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {person.email}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`הסרת ${person.email}`}
                  onClick={() =>
                    set('attendees', value.attendees.filter((a) => a.email !== person.email))
                  }
                  className="rounded-full p-0.5 hover:bg-background disabled:opacity-50"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <FieldSection title="זמן">
        {/* Toggling all-day REWRITES the span, it doesn't just flag it: an
            all-day appointment is stored as [midnight, midnight-after-the-last
            -day), so a timed 14:00–15:00 has to become 00:00 → next-day 00:00.
            Without this the end would render a day BEFORE the start. */}
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={value.allDay}
            disabled={disabled}
            onCheckedChange={(checked) => {
              if (checked === value.allDay) return;
              const startDay = value.startLocal.slice(0, 10);
              const endDay = value.endLocal.slice(0, 10);
              if (checked) {
                const lastDay = endDay > startDay ? endDay : startDay;
                onChange({
                  ...value,
                  allDay: true,
                  startLocal: `${startDay}T00:00`,
                  endLocal: `${shiftDateOnly(lastDay, 1)}T00:00`,
                });
              } else {
                // Back to a timed event — the day is kept, the times fall back
                // to a plain one-hour slot (Outlook does the same).
                onChange({
                  ...value,
                  allDay: false,
                  startLocal: `${startDay}T09:00`,
                  endLocal: `${startDay}T10:00`,
                });
              }
            }}
          />
          יום שלם
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <label htmlFor="ef-start" className="text-sm font-medium">התחלה</label>
            <input
              id="ef-start"
              type={value.allDay ? 'date' : 'datetime-local'}
              value={value.allDay ? value.startLocal.slice(0, 10) : value.startLocal}
              disabled={disabled}
              onChange={(e) =>
                set('startLocal', value.allDay ? `${e.target.value}T00:00` : e.target.value)
              }
              className={FIELD_DATE_INPUT_CLASS}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="ef-end" className="text-sm font-medium">סיום</label>
            {/* All-day shows the LAST DAY THE EVENT COVERS, like Outlook — the
                stored value is the exclusive midnight after it, so ±1 day is
                applied on the way out and back in. Showing the raw value made
                a one-day event read as two, and "correcting" it to the same
                day produced a zero-length span the server rightly refused. */}
            <input
              id="ef-end"
              type={value.allDay ? 'date' : 'datetime-local'}
              value={
                value.allDay
                  ? shiftDateOnly(value.endLocal.slice(0, 10), -1)
                  : value.endLocal
              }
              min={value.allDay ? value.startLocal.slice(0, 10) : value.startLocal}
              disabled={disabled}
              onChange={(e) =>
                set(
                  'endLocal',
                  value.allDay ? `${shiftDateOnly(e.target.value, 1)}T00:00` : e.target.value,
                )
              }
              className={FIELD_DATE_INPUT_CLASS}
            />
          </div>
        </div>

        {showRecurrence ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={recurrence !== null}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  set('recurrence', checked ? { frequency: 'weekly', interval: 1 } : null)
                }
              />
              <Repeat className="size-4 text-muted-foreground" aria-hidden />
              אירוע חוזר
            </label>

            {recurrence ? (
              // Indented under a start-side rule instead of a boxed frame —
              // reads as "part of Time", not a separate, foreign widget.
              <div className="space-y-2 border-s-2 border-border ps-4">
                <div className="flex items-center gap-2">
                  <FieldSelect
                    ariaLabel="תדירות"
                    value={recurrence.frequency}
                    disabled={disabled}
                    onChange={(e) =>
                      set('recurrence', {
                        ...recurrence,
                        frequency: e.target.value as RecurrenceDraft['frequency'],
                      })
                    }
                    className="flex-1"
                  >
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </FieldSelect>
                  <input
                    aria-label="כל כמה"
                    type="number"
                    min={1}
                    max={99}
                    value={recurrence.interval}
                    disabled={disabled}
                    onChange={(e) =>
                      set('recurrence', {
                        ...recurrence,
                        interval: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className={cn(FIELD_INPUT_CLASS, 'w-20 shrink-0')}
                  />
                </div>

                {recurrence.frequency === 'weekly' ? (
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((day) => {
                      const active = recurrence.daysOfWeek?.includes(day.value) ?? false;
                      return (
                        <button
                          key={day.value}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            const current = recurrence.daysOfWeek ?? [];
                            set('recurrence', {
                              ...recurrence,
                              daysOfWeek: active
                                ? current.filter((d) => d !== day.value)
                                : [...current, day.value],
                            });
                          }}
                          className={cn(
                            'size-8 rounded-full border text-xs transition disabled:opacity-50',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:bg-accent',
                          )}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="space-y-1">
                  <label htmlFor="ef-rec-end" className="text-xs text-muted-foreground">
                    מסתיים בתאריך (ריק = ללא סיום)
                  </label>
                  <input
                    id="ef-rec-end"
                    type="date"
                    value={recurrence.endDateIso ? recurrence.endDateIso.slice(0, 10) : ''}
                    disabled={disabled}
                    onChange={(e) =>
                      set('recurrence', {
                        ...recurrence,
                        endDateIso: e.target.value
                          ? new Date(`${e.target.value}T23:59`).toISOString()
                          : undefined,
                      })
                    }
                    className={FIELD_DATE_INPUT_CLASS}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </FieldSection>

      <FieldSection title="מיקום ותיאור">
        <div className="space-y-1">
          <label htmlFor="ef-location" className="text-sm font-medium">
            מיקום <span className="text-xs text-muted-foreground">(מאפשר ניווט מהטלפון)</span>
          </label>
          <input
            id="ef-location"
            type="text"
            value={value.location}
            disabled={disabled}
            onChange={(e) => set('location', e.target.value)}
            maxLength={255}
            className={FIELD_INPUT_CLASS}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="ef-body" className="text-sm font-medium">תיאור</label>
          <textarea
            id="ef-body"
            value={value.body}
            disabled={disabled}
            onChange={(e) => set('body', e.target.value)}
            rows={3}
            maxLength={5000}
            className={FIELD_INPUT_CLASS}
          />
        </div>
      </FieldSection>

      <FieldSection title="התראה ופרטיות">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ef-reminder" className="text-sm font-medium">הזכר לי</label>
            <FieldSelect
              id="ef-reminder"
              value={value.reminderMinutes}
              disabled={disabled}
              onChange={(e) => set('reminderMinutes', Number(e.target.value))}
            >
              {REMINDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </FieldSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor="ef-showas" className="text-sm font-medium">הצג אותי כ־</label>
            <FieldSelect
              id="ef-showas"
              value={value.showAs}
              disabled={disabled}
              onChange={(e) => set('showAs', e.target.value as EventFormValue['showAs'])}
            >
              {SHOW_AS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </FieldSelect>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="ef-category" className="text-sm font-medium">קטגוריה</label>
          <FieldSelect
            id="ef-category"
            value={value.category}
            disabled={disabled}
            onChange={(e) => set('category', e.target.value)}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </FieldSelect>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={value.isPrivate}
            disabled={disabled}
            onCheckedChange={(checked) => set('isPrivate', checked)}
          />
          פרטית
        </label>
      </FieldSection>
    </div>
  );
}
