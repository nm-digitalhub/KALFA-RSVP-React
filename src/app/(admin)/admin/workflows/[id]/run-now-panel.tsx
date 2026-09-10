'use client';

// The door that did not exist.
//
// Until this panel, `trigger.whatsapp_inbound` was the only trigger in the
// catalogue and an inbound guest message was the only thing that could create a
// run. On 2026-09-10 the live count was 20 saved workflows, one armed, and ZERO
// runs ever — an editor, a runner, a step ledger and a live log all sitting
// behind a door only a guest could open. This opens a second one.
//
// It is NOT the dry run beside it. This creates a real `workflow_runs` row and
// hands it to the worker with the real ports, so a `send_whatsapp` node sends
// and a `start_rsvp_ai_callback` node dials a real phone. Everything about the
// design below follows from that: the person is named before the button is
// armed, the button says what it will do, and it asks once more.
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import type { ManualRunContact, ManualRunEvent } from '@/lib/data/admin/workflows';

import {
  listManualRunContactsAction,
  listManualRunEventsAction,
  startManualRunAction,
} from '../actions';

const REFUSAL_LABEL: Record<string, string> = {
  workflow_not_found: 'התהליך לא נמצא.',
  workflow_scoped_to_other_event: 'התהליך משויך לאירוע אחר ולא ירוץ על האירוע שנבחר.',
  no_trigger_node: 'לתהליך אין צומת התחלה יחיד. פתחו את התרשים ותקנו לפני הרצה.',
  contact_not_in_event: 'איש הקשר אינו שייך לאירוע שנבחר.',
  run_not_created: 'יצירת ההרצה נכשלה.',
};

function contactLabel(contact: ManualRunContact): string {
  const names = contact.guestNames.length > 0 ? contact.guestNames.join(', ') : 'ללא שם';
  return `${names} · ****${contact.phoneTail}`;
}

export function RunNowPanel({
  workflowId,
  /** Non-null when the workflow is pinned to one event; then the picker is fixed. */
  scopedEventId,
}: {
  workflowId: string;
  scopedEventId: string | null;
}) {
  const [events, setEvents] = useState<ManualRunEvent[]>([]);
  const [contacts, setContacts] = useState<ManualRunContact[]>([]);
  const [eventId, setEventId] = useState(scopedEventId ?? '');
  const [contactId, setContactId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [buttonPayload, setButtonPayload] = useState('');
  const [armed, setArmed] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Loaded on mount rather than passed from the page: this panel is the only
  // consumer, and a workflow that is never run manually should not make every
  // page load pay for an events query.
  useEffect(() => {
    let cancelled = false;
    void listManualRunEventsAction()
      .then((rows) => {
        if (cancelled) return;
        setEvents(rows);
        // A scoped workflow has nothing to choose; a global one starts on the
        // most recent event so the contact list is never empty for no reason.
        if (!scopedEventId && rows[0]) setEventId((current) => current || rows[0]!.id);
      })
      .catch(() => {
        if (!cancelled) setNotice({ kind: 'error', text: 'טעינת האירועים נכשלה.' });
      });
    return () => {
      cancelled = true;
    };
  }, [scopedEventId]);

  // Fetch only. The three resets that used to live here moved into
  // `chooseEvent` below: lint is right that clearing React state synchronously
  // in an effect body is a cascading render, and the clearing belongs to the
  // user's action anyway — it is not synchronisation with anything external.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    void listManualRunContactsAction(eventId)
      .then((rows) => {
        if (!cancelled) setContacts(rows);
      })
      .catch(() => {
        if (!cancelled) setNotice({ kind: 'error', text: 'טעינת אנשי הקשר נכשלה.' });
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  /**
   * Switching event clears who it acts on, and DISARMS.
   *
   * Without the disarm a confirmation given for one person could carry over onto
   * whoever happens to land in the same dropdown slot for another event — and
   * the next click after that places a real call.
   */
  const chooseEvent = (next: string) => {
    setEventId(next);
    setContacts([]);
    setContactId('');
    setArmed(false);
  };

  const chosen = contacts.find((c) => c.id === contactId);

  const run = () => {
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await startManualRunAction(workflowId, {
          eventId,
          contactId,
          messageText,
          buttonPayload,
        });
        if (result.ok) {
          setArmed(false);
          setNotice({
            kind: 'ok',
            text: `ההרצה נוצרה ונשלחה לעובד. מזהה: ${result.runId.slice(0, 8)} — היא תופיע ברשימת ההרצות למטה.`,
          });
        } else {
          setNotice({
            kind: 'error',
            text: REFUSAL_LABEL[result.reason] ?? `ההרצה נדחתה: ${result.reason}`,
          });
        }
      } catch (e) {
        setNotice({
          kind: 'error',
          text: e instanceof Error ? e.message : 'ההרצה נכשלה.',
        });
      }
    });
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">הרצה אמיתית</h2>
        <p className="text-sm text-muted-foreground">
          מריץ את הגרסה השמורה על אדם אמיתי. הודעות נשלחות באמת, שיחות מתבצעות באמת,
          וסטטוס אורח משתנה באמת. להרצה ללא תופעות לוואי השתמשו ב״הרצת בדיקה״.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">אירוע</span>
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
            value={eventId}
            disabled={Boolean(scopedEventId) || pending}
            onChange={(e) => chooseEvent(e.target.value)}
          >
            <option value="">בחרו אירוע</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
          {scopedEventId && (
            <span className="text-xs text-muted-foreground">
              התהליך משויך לאירוע הזה ולכן אי אפשר להחליף.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">על מי זה ירוץ</span>
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
            value={contactId}
            disabled={pending || contacts.length === 0}
            onChange={(e) => {
              setContactId(e.target.value);
              setArmed(false);
            }}
          >
            <option value="">
              {contacts.length === 0 ? 'אין אנשי קשר לאירוע הזה' : 'בחרו איש קשר'}
            </option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contactLabel(contact)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            טקסט ההודעה (במקום מה שהאורח היה שולח)
          </span>
          <input
            className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
            value={messageText}
            disabled={pending}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="נשאר ריק אם התהליך לא קורא אותו"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">מזהה כפתור (quick reply)</span>
          <input
            className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
            value={buttonPayload}
            disabled={pending}
            onChange={(e) => setButtonPayload(e.target.value)}
            placeholder="לרוב ריק"
          />
        </label>
      </div>

      {/* Two steps on purpose. The first names the person, so "run" is never the
          first click after choosing them from a dropdown. */}
      {!armed ? (
        <Button
          type="button"
          variant="outline"
          disabled={!eventId || !contactId || pending}
          onClick={() => setArmed(true)}
        >
          המשך להרצה אמיתית
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p role="alert" className="text-sm">
            התהליך ירוץ עכשיו על <strong>{chosen ? contactLabel(chosen) : '—'}</strong>.
            צעדים ששולחים הודעה או מתקשרים יבצעו זאת באמת.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={run} disabled={pending}>
              {pending ? 'מריץ…' : 'הרץ עכשיו'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setArmed(false)}
              disabled={pending}
            >
              ביטול
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={notice.kind === 'error' ? 'text-sm text-destructive' : 'text-sm'}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
