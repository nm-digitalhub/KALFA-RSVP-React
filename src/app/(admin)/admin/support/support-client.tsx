'use client';

import { useState, useTransition } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatIsraelDate } from '@/lib/date';

import { Badge } from '../_components';
import {
  findSupportEventsAction,
  viewSupportEventAction,
  type SupportEventDossier,
} from './actions';
import type { SupportEventLookupResult } from '@/lib/data/admin/support';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// Read-only support surface. Two steps, both client-driven via useTransition +
// the ActionResult<T> server actions (mirrors the roles-client staff-role
// selector pattern already in this codebase):
//   1. Find candidate event(s) by event id OR the owner's phone/email.
//   2. Pick one and view it — REQUIRES a break-glass reason; the server action
//      (via getEventForSupportView) writes the audit row before returning data.
// There are no edit/toggle/delete affordances anywhere on this page.
export function SupportClient() {
  const [eventId, setEventId] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [reason, setReason] = useState('');

  const [findError, setFindError] = useState<string | undefined>();
  const [candidates, setCandidates] = useState<SupportEventLookupResult[] | null>(null);
  const [findPending, startFind] = useTransition();

  const [viewError, setViewError] = useState<string | undefined>();
  const [dossier, setDossier] = useState<SupportEventDossier | null>(null);
  const [viewPending, startView] = useTransition();

  const reasonTooShort = reason.trim().length < 10;

  const onFind = (): void => {
    setFindError(undefined);
    setCandidates(null);
    setDossier(null);
    startFind(async () => {
      const result = await findSupportEventsAction({
        event_id: eventId,
        owner_phone: ownerPhone,
        owner_email: ownerEmail,
        reason,
      });
      if (!result.ok) {
        setFindError(result.error);
        return;
      }
      if (result.data.length === 0) {
        setFindError('לא נמצא אירוע תואם');
        return;
      }
      setCandidates(result.data);
    });
  };

  const onView = (id: string): void => {
    setViewError(undefined);
    setDossier(null);
    startView(async () => {
      const result = await viewSupportEventAction({ event_id: id, reason });
      if (!result.ok) {
        setViewError(result.error);
        return;
      }
      setDossier(result.data);
    });
  };

  return (
    <div className="space-y-6">
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">סיבת הגישה (מחייב)</h2>
        <p className="text-sm text-muted-foreground">
          כל חיפוש וכל צפייה חושפים נתוני לקוח ומתועדים ביומן ביקורת. יש לציין
          סיבה (לפחות 10 תווים) לפני איתור או צפייה.
        </p>
        <div>
          <label htmlFor="support-reason" className="mb-1 block text-sm font-medium">
            סיבה
          </label>
          <textarea
            id="support-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
            rows={2}
            placeholder="לדוגמה: פנייה בנושא הזמנה #1234 בטופס יצירת קשר"
          />
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">איתור אירוע</h2>
        <FormError message={findError} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="support-event-id" className="mb-1 block text-sm font-medium">
              מזהה אירוע
            </label>
            <input
              id="support-event-id"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="support-owner-phone" className="mb-1 block text-sm font-medium">
              טלפון בעל האירוע (אופציונלי)
            </label>
            <input
              id="support-owner-phone"
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="support-owner-email" className="mb-1 block text-sm font-medium">
              אימייל בעל האירוע (אופציונלי)
            </label>
            <input
              id="support-owner-email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onFind}
          disabled={findPending || reasonTooShort}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {findPending ? 'מחפש…' : 'איתור'}
        </button>
        {reasonTooShort ? (
          <p className="text-sm text-muted-foreground">יש להזין סיבה למעלה לפני איתור.</p>
        ) : null}

        {candidates && candidates.length > 0 ? (
          <ul className="divide-y divide-border">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {c.name}
                  {c.ownerFullName ? ` · ${c.ownerFullName}` : ''}
                  {c.eventDate ? ` · ${formatIsraelDate(c.eventDate)}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setEventId(c.id)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  בחר/י
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">צפייה באירוע</h2>
        <FormError message={viewError} />
        <p className="text-sm text-muted-foreground">
          בחר/י אירוע מהתוצאות למעלה (או הזן/י מזהה אירוע), ולחץ/י לצפייה. הצפייה
          משתמשת בסיבה שצוינה למעלה ומתועדת.
        </p>
        <button
          type="button"
          onClick={() => onView(eventId)}
          disabled={viewPending || !eventId || reasonTooShort}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {viewPending ? 'טוען…' : 'צפייה באירוע'}
        </button>
      </section>

      {dossier ? (
        <section className={sectionClass}>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{dossier.event.name}</h2>
            <Badge>תצוגת תמיכה — קריאה בלבד</Badge>
          </div>
          <FormNotice message="נתוני חיוב אינם מוצגים במסך זה." />
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">סוג אירוע</dt>
              <dd>{dossier.event.eventTypeLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">תאריך</dt>
              <dd>{dossier.event.eventDate ? formatIsraelDate(dossier.event.eventDate) : '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">חוגגים</dt>
              <dd>{dossier.event.celebrantsText ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">אולם</dt>
              <dd>{dossier.event.venueName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">סטטוס</dt>
              <dd>
                <Badge>{dossier.event.statusLabel}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">בעל האירוע</dt>
              <dd>
                {dossier.event.owner.fullName ?? '—'}
                {dossier.event.owner.phone ? ` · ${dossier.event.owner.phone}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">אימייל בעל האירוע</dt>
              <dd dir="ltr">{dossier.event.owner.email ?? '—'}</dd>
            </div>
          </dl>

          <h3 className="pt-2 font-medium">אורחים ({dossier.guests.length})</h3>
          {dossier.guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין אורחים.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>שם</TableHead>
                    <TableHead>טלפון</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>מבוגרים</TableHead>
                    <TableHead>ילדים</TableHead>
                    <TableHead>העדפת מזון</TableHead>
                    <TableHead>הערת RSVP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dossier.guests.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium">{g.fullName}</TableCell>
                      <TableCell dir="ltr" className="text-muted-foreground">
                        {g.phone ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge>{g.statusLabel}</Badge>
                      </TableCell>
                      <TableCell>{g.confirmedAdults ?? '—'}</TableCell>
                      <TableCell>{g.confirmedKids ?? '—'}</TableCell>
                      <TableCell>{g.mealPref ?? '—'}</TableCell>
                      <TableCell className="max-w-xs truncate">{g.rsvpNote ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
