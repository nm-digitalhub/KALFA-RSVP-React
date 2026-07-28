'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellRing,
  CircleDot,
  ExternalLink,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Repeat,
  Tag,
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
import type {
  CalendarEventDetailDTO,
  LinkedCallbackDTO,
} from '@/lib/data/exchange-connections';
import { formatPhoneForDisplay } from '@/lib/callbacks/calendar-item';
import { categoryColorHex } from '@/lib/exchange-ews/category-colors';
import type { ExchangeCategory } from '@/lib/exchange-ews/types';
import {
  EventFormFields,
  REMINDER_OPTIONS as SHARED_REMINDERS,
  type EventFormValue,
} from './event-form-fields';
import {
  formatIsraelDate,
  formatIsraelDateTime,
  formatIsraelTime,
  formatIsraelWeekday,
} from '@/lib/date';

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

/**
 * The when-block: date on one line, times on the next, duration beside them.
 *
 * Split deliberately. As a single run ("09:00 — 09:15, 28.07.2026") it reads as
 * one string and the eye has to parse it; on two lines with different weights
 * the answer to "when" is available at a glance, which is the one thing every
 * calendar item must give instantly.
 */
function whenParts(startIso: string, endIso: string, allDay: boolean): {
  day: string;
  time: string;
  duration: string | null;
} {
  const sameDay = formatIsraelDate(startIso) === formatIsraelDate(endIso);
  const day = `${formatIsraelWeekday(startIso)}, ${formatIsraelDate(startIso)}`;

  if (allDay) return { day, time: 'יום שלם', duration: null };

  const time = sameDay
    ? `${formatIsraelTime(startIso)} – ${formatIsraelTime(endIso)}`
    : `${formatIsraelDateTime(startIso)} – ${formatIsraelDateTime(endIso)}`;

  // Spelled out rather than left to mental arithmetic.
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  let duration: string | null = null;
  if (minutes > 0 && minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    duration = h === 0 ? `${m} דקות` : m === 0 ? `${h} שעות` : `${h}:${String(m).padStart(2, '0')} שעות`;
    if (h === 1 && m === 0) duration = 'שעה';
  }
  return { day, time, duration };
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


/** Israeli mobile/landline in E.164 or local form, inside free text. */
const PHONE_SRC = '\\+972[\u2010-\u2015-]?\\d[\\d\u2010-\u2015-]{7,}|0\\d{1,2}[-\\s]?\\d{3}[-\\s]?\\d{4}';
/** http(s) URL, stopping before trailing punctuation that belongs to the sentence. */
const URL_SRC = 'https?://[^\\s<>"]+[^\\s<>".,;:!?)\u2013\u2014]';

/** One pass over the text; the capture groups keep the matches in the split. */
const LINKABLE_RE = new RegExp(`(${URL_SRC}|${PHONE_SRC})`, 'g');
const isUrl = (s: string) => /^https?:\/\//.test(s);
const isPhone = (s: string) => new RegExp(`^(?:${PHONE_SRC})$`).test(s);

/** Strips the separators a display format adds, leaving something dialable. */
const telHref = (raw: string) => `tel:${raw.replace(/[\s\u2010-\u2015-]/g, '')}`;

/**
 * What a link should SAY, rather than what it points at.
 *
 * A callback URL is a host plus a 36-character UUID. Printed in full it takes
 * three lines of an RTL paragraph, breaks mid-identifier, and tells the reader
 * nothing (measured on a live item). Shortening it to "host/path/…" was better
 * but still read as a naked address dropped into a sentence.
 *
 * For our own app the destination is knowable from the route, so the link says
 * where it goes. External addresses keep the host, which is the one part of a
 * foreign URL worth showing.
 */
function linkText(href: string): { label: string; internal: boolean } {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin === window.location.origin) {
      const path = url.pathname;
      if (/^\/admin\/callbacks\/[^/]+$/.test(path)) return { label: 'פתיחת הפנייה', internal: true };
      if (/^\/admin\/events\/[^/]+/.test(path)) return { label: 'פתיחת האירוע', internal: true };
      if (/^\/admin\/users\/[^/]+/.test(path)) return { label: 'פתיחת המשתמש', internal: true };
      return { label: 'פתיחה במערכת', internal: true };
    }
    const short = url.pathname.replace(/\/+$/, '');
    return {
      label: short.length > 24 ? `${url.host}/…` : `${url.host}${short}`,
      internal: false,
    };
  } catch {
    return { label: href, internal: false };
  }
}

/**
 * Renders a body with phone numbers and URLs turned into real links.
 *
 * The same reasoning as the location becoming a maps link: this dialog is
 * opened in order to ACT, and a number or address you have to select and copy
 * is not an action. The body arrives as plain text — the provider flattens any
 * HTML — so this reads the text rather than parsing markup, which also means it
 * improves every appointment, including ones written in Outlook by hand.
 */
function BodyWithLinks({ text }: { text: string }) {
  const parts = text.split(LINKABLE_RE);
  return (
    <p className="wrap-anywhere whitespace-pre-wrap leading-relaxed">
      {parts.map((part, i) => {
        if (!part) return null;
        if (isUrl(part)) {
          const { label, internal } = linkText(part);
          // Internal links read as a sentence — "לפרטים המלאים: פתיחת הפנייה" —
          // so the link belongs to the text instead of interrupting it. An
          // external address stays LTR and unwrapped, since a host is not a
          // Hebrew phrase and breaking it mid-token reverses it visually.
          return internal ? (
            <span key={i} className="inline">
              לפרטים המלאים:{' '}
              <a
                href={part}
                className="text-primary underline underline-offset-2"
              >
                {label}
                <span aria-hidden> ←</span>
              </a>
            </span>
          ) : (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              className="inline-block max-w-full break-all align-bottom text-primary underline underline-offset-2"
            >
              {label}
            </a>
          );
        }
        if (isPhone(part)) {
          return (
            <a
              key={i}
              href={telHref(part)}
              dir="ltr"
              className="inline-block text-primary underline underline-offset-2"
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

/**
 * A callback request, rendered from its own fields rather than from the
 * appointment's description.
 *
 * The description in the mailbox exists FOR OUTLOOK. Read back here it is prose:
 * the number has already been formatted for the eye, the deep link has been
 * replaced by the words "פתיחת הפנייה", and everything that made them
 * actionable — the tel: and the href — was stripped when the provider flattened
 * the HTML. Rendering the columns instead gives back a number that dials and a
 * link that opens, on every such appointment, whatever its body happens to say.
 *
 * The number leads, at the largest size in the dialog, because this screen is
 * opened in the seconds before a call and everything else is context.
 */
function CallbackPanel({ callback }: { callback: LinkedCallbackDTO }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
          נייד ליצירת קשר
        </p>
        <a
          href={telHref(callback.phone)}
          dir="ltr"
          className="inline-block text-lg font-semibold tabular-nums text-primary underline underline-offset-4"
        >
          {formatPhoneForDisplay(callback.phone)}
        </a>
      </div>

      {callback.topic?.trim() ? (
        <Section label="נושא">{callback.topic}</Section>
      ) : null}

      {callback.note?.trim() ? (
        <Section label="הודעה">
          {/* wrap-anywhere: customer-written text, so an unbroken token would
              otherwise widen the dialog — same rule as /admin/callbacks/[id]. */}
          <p className="wrap-anywhere whitespace-pre-wrap leading-relaxed">{callback.note}</p>
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>התקבלה {formatIsraelDateTime(callback.createdAtIso)}</span>
        {/* The call about to be made is the one AFTER those already tried. */}
        {callback.attemptCount > 0 ? <span>ניסיון {callback.attemptCount + 1}</span> : null}
      </div>

      <a
        href={`/admin/callbacks/${callback.id}`}
        className="inline-block text-sm text-primary underline underline-offset-2"
      >
        פתיחת הפנייה
        <span aria-hidden> ←</span>
      </a>
    </div>
  );
}

const SHOW_AS_TEXT: Record<string, string> = {
  free: 'פנוי',
  tentative: 'משוער',
  busy: 'לא פנוי',
  oof: 'מחוץ למשרד',
  working_elsewhere: 'עובד מרחוק',
};

/**
 * A labelled block of content.
 *
 * A text label, not a lone icon: a circle beside "לא פנוי" tells you nothing
 * until you have guessed what it stands for. 11px uppercase-ish grey costs one
 * line and removes the guess.
 */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** One item in the compact settings strip. */
function Setting({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      {children}
    </span>
  );
}

/**
 * Category → dot colour, looked up in the MAILBOX's own list.
 *
 * An appointment carries a category NAME and nothing else — the colour lives in
 * the mailbox's master category list, which is where Outlook itself looks it
 * up. Doing the same here means the dot matches what the owner sees in Outlook
 * rather than what we guessed.
 *
 * This replaces a name-matching table that returned the brand colour for
 * anything starting with "KALFA". That was a fiction: measured 28.07, the
 * mailbox's list contains no KALFA entry at all, so Outlook draws those items
 * UNCOLOURED. Returning null here now tells the truth — an outline dot, meaning
 * "this name has no colour in your mailbox" — which is also the signal that
 * registering the category would fix.
 */
function categoryDot(category: string, categories: ExchangeCategory[] | undefined): string | null {
  const match = categories?.find((c) => c.name === category);
  return match ? categoryColorHex(match.colorIndex) : null;
}

export function EventEditDialog({
  connectionId,
  appointmentId,
  categories,
  onClose,
  onSaved,
}: {
  connectionId: string;
  appointmentId: string | null;
  /** The mailbox's category list; undefined while it is still loading. */
  categories?: ExchangeCategory[];
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
            // Three levels, not one flat list — see the design note above
            // Section(): WHEN, then CONTENT, then SETTINGS. 20px between the
            // levels, 16px inside one, 4px between a label and its value. The
            // previous uniform 12px is what made every fact look equally
            // important and the whole thing read as cramped.
            <div className="space-y-5">
              {/* ── Level 1: when ── */}
              {(() => {
                const when = whenParts(detail.startIso, detail.endIso, detail.allDay);
                return (
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-[13px] font-medium text-muted-foreground">{when.day}</p>
                    <div className="mt-0.5 flex items-baseline justify-between gap-3">
                      {/* tabular-nums: without it 09:00 and 11:15 differ in
                          width and the eye jogs between rows. */}
                      <span className="text-lg font-semibold tabular-nums">{when.time}</span>
                      {when.duration ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {when.duration}
                        </span>
                      ) : null}
                    </div>
                    {detail.recurrenceText ? (
                      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Repeat className="size-3.5 shrink-0" aria-hidden />
                        {detail.recurrenceText}
                      </p>
                    ) : null}
                  </div>
                );
              })()}

              {/* ── Level 2: content ── */}
              {detail.callback ||
              detail.location ||
              detail.attendees.length > 0 ||
              detail.body.trim() ? (
                <div className="space-y-4">
                  {/* First, because on a callback it IS the item: everything
                      below is context around the number to dial. */}
                  {detail.callback ? <CallbackPanel callback={detail.callback} /> : null}

                  {detail.location ? (
                    <Section label="מיקום">
                      <a
                        href={mapsHref(detail.location)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-1 wrap-anywhere text-primary underline underline-offset-2"
                      >
                        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {detail.location}
                        <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      </a>
                    </Section>
                  ) : null}

                  {detail.attendees.length > 0 ? (
                    <Section label="משתתפים">
                      <ul className="flex flex-wrap gap-1.5">
                        {detail.attendees.map((person) => (
                          <li
                            key={person.email}
                            dir="ltr"
                            className="wrap-anywhere rounded-md bg-muted px-2 py-0.5 text-xs"
                          >
                            {person.name?.trim() || person.email}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  ) : null}

                  {/* trim(): a body of nothing but whitespace used to render a
                      heading over an empty line. Full width — no icon gutter
                      stealing 24px from the item's actual content. */}
                  {/* Suppressed on a linked callback: the description there is a
                      rendering of the very fields shown above, composed for
                      Outlook. Printing it too would say everything twice, in a
                      weaker form — no dialable number, no working link. */}
                  {!detail.callback && detail.body.trim() ? (
                    <Section label="תיאור">
                      <BodyWithLinks text={detail.body} />
                    </Section>
                  ) : null}
                </div>
              ) : null}

              {/* ── Level 3: settings ── these are configuration, not content,
                  so they share one compact strip instead of a row each. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
                <Setting icon={<BellRing className="size-3.5" />}>
                  {reminderLabel(detail.reminderMinutes)}
                </Setting>
                <Setting icon={<CircleDot className="size-3.5" />}>
                  {SHOW_AS_TEXT[detail.showAs] ?? detail.showAs}
                </Setting>
                {detail.sensitivity === 'private' ? (
                  <Setting icon={<Lock className="size-3.5" />}>פרטי</Setting>
                ) : null}
                {detail.category ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    {categoryDot(detail.category, categories) ? (
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: categoryDot(detail.category, categories) as string,
                        }}
                        aria-hidden
                      />
                    ) : (
                      <Tag className="size-3.5 shrink-0" aria-hidden />
                    )}
                    {detail.category}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <EventFormFields
              value={form}
              onChange={setForm}
              disabled={readOnly || busy}
              categories={categories}
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
