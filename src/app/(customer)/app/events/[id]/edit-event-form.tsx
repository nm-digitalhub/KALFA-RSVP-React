'use client';

import Image from 'next/image';
import { useActionState, useState } from 'react';

import { updateEventAction } from './actions';
import {
  CELEBRANT_KIND_BY_EVENT_TYPE,
  CELEBRANT_REQUIRED_FIELD_KEYS_BY_KIND,
  EVENT_TYPES,
  type CelebrantFieldKey,
} from '@/lib/validation/schemas';
import {
  CELEBRANT_FIELD_LABELS,
  EVENT_TYPE_LABELS,
  HOST_COMPOSITION_LABELS,
} from '@/lib/data/event-labels';
import type { EventDetail } from '@/lib/data/events';
import { ilDateInputValue, ilTimeInputValue } from '@/lib/data/event-date';
import { INVITE_IMAGE_MAX_BYTES } from '@/lib/constants';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { TimeSelect24 } from '@/components/time-select-24';
import { DateSelectIL } from '@/components/date-select-il';

type EventType = (typeof EVENT_TYPES)[number];

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60';

// event_date is a timestamptz in the DB, so the value arrives as a full ISO
// string; a <input type="date"> needs YYYY-MM-DD. ilDateInputValue converts to
// the ISRAEL calendar day (a raw UTC slice shows the previous day for
// early-morning IL times); rsvp_deadline is a plain date and passes through.
const dateInputValue = ilDateInputValue;

// events.celebrants is schemaless jsonb (Json | null), so narrow defensively:
// prefill only from a plain object's string values — no cast of the stored
// value to a celebrant shape. CelebrantFields renders (and therefore reads)
// only the CURRENTLY selected type's fields, so a stored shape left over from
// a different kind simply yields empty inputs, never a wrong prefill.
function celebrantDefaults(value: EventDetail['celebrants']): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const defaults: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') defaults[key] = entry;
  }
  return defaults;
}

// Celebrant (בעלי שמחה) inputs for the selected event type: plain named
// inputs (celebrants.groom, celebrants.bride, ...) that the server action
// reads per the submitted event_type's kind. Uncontrolled — the parent
// remounts the group via key={eventType} whenever the type changes, so no
// stale value from another kind ever lingers. Every field is optional here:
// completeness is enforced only at campaign enablement.
function CelebrantFields({
  eventType,
  defaults,
  errors,
  requiredKeys,
}: {
  eventType: EventType;
  defaults: Record<string, string>;
  errors?: Record<string, string[] | undefined>;
  // While an operational campaign exists these fields are `required` (they are
  // bound into every pending invite/reminder — the browser must block a save that
  // empties them). Empty otherwise: at draft/no-campaign all fields stay
  // optional (completeness is only the campaign gate's concern).
  requiredKeys?: readonly CelebrantFieldKey[];
}) {
  const required = new Set<string>(requiredKeys ?? []);
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium">בעלי השמחה</legend>
      <p className="text-xs text-muted-foreground">
        {required.size > 0
          ? 'כל עוד קמפיין אישורי-הגעה פעיל — הפרטים מופיעים בהזמנות ובתזכורות ולכן חייבים להישאר מלאים.'
          : 'יש למלא לפני הפעלת אישורי הגעה'}
      </p>
      {Object.entries(CELEBRANT_FIELD_LABELS[eventType]).map(([field, label]) => (
        <div key={field}>
          <label
            htmlFor={`celebrants.${field}`}
            className="mb-1 block text-sm font-medium"
          >
            {label}
          </label>
          {field === 'host_composition' ? (
            <select
              id={`celebrants.${field}`}
              name={`celebrants.${field}`}
              defaultValue={defaults[field] ?? ''}
              required={required.has(field)}
              className={inputClass}
            >
              <option value="" disabled>
                בחרו…
              </option>
              {Object.entries(HOST_COMPOSITION_LABELS).map(([value, optLabel]) => (
                <option key={value} value={value}>
                  {optLabel}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`celebrants.${field}`}
              name={`celebrants.${field}`}
              type="text"
              defaultValue={defaults[field] ?? ''}
              required={required.has(field)}
              className={inputClass}
            />
          )}
          <FieldError errors={errors?.[`celebrants.${field}`]} />
        </div>
      ))}
    </fieldset>
  );
}

export function EditEventForm({
  event,
  inviteImageUrl,
  hasOperationalCampaign = false,
}: {
  event: EventDetail;
  // Short-lived signed URL of the CURRENT invitation image (private bucket) —
  // generated per render by the page, so it always reflects the latest upload.
  inviteImageUrl?: string | null;
  // True when an OPERATIONAL (non-terminal) campaign exists for this event — the
  // page derives it from the already-loaded campaign via isOperationalCampaignStatus
  // (the SSOT). Drives the "may change, must not remove / re-type" locks that
  // protect every pending send: event_type locked, celebrant completeness +
  // venue_name enforced. The server (updateEvent) is the authority — this is UX.
  hasOperationalCampaign?: boolean;
}) {
  const action = updateEventAction.bind(null, event.id);
  const [state, formAction] = useActionState(action, null);

  // R5: date fields are editable only while draft. Status itself is no longer
  // editable here at all (R6) — Publish/Close (EventStatusActions) are the only
  // legitimate transitions; a free dropdown would let the owner "choose" a
  // status the server silently ignores (updateEvent no longer accepts it).
  const isDraft = event.status === 'draft';

  // Controlled so the celebrant field group below follows the selected type.
  const [eventType, setEventType] = useState<EventType>(event.event_type);

  // Client-side pre-check of the image size cap: a pick above the Server
  // Action body limit (6mb) is rejected by the framework BEFORE the action
  // runs, so the server's friendly Hebrew error would never show.
  const [imageError, setImageError] = useState<string | null>(null);

  // Fingerprint of the SERVER's copy of every field rendered below as an
  // uncontrolled input. It keys the <form>, so the inputs remount — and pick up
  // their new defaultValue — whenever the saved event actually changes.
  //
  // WHY. React documents that "after the action function successfully
  // completes, all uncontrolled field elements within the form are
  // automatically reset" (react.dev, <form action>). Reset means "back to
  // defaultValue", and defaultValue comes from the `event` prop of the tree
  // that is already mounted — i.e. the state BEFORE the save. So a field the
  // owner had just edited snapped back to its old value seconds after pressing
  // save, while the database held the new one. It was reported for
  // "הרכב המזמינים" because there the old value was empty and the field visibly
  // fell back to "בחרו…", but every uncontrolled field here had it: change the
  // event name, save, and the box shows the previous name until a refresh.
  //
  // Keying the <form> and not this component is deliberate — useActionState
  // lives above it, so the "האירוע עודכן" notice and any field errors survive
  // the remount. The fingerprint only moves when the server's data moves, so
  // this cannot interrupt typing: it changes on a successful save (or someone
  // else's edit arriving via revalidation), which is exactly when the inputs
  // SHOULD be re-seeded.
  const serverFingerprint = JSON.stringify([
    event.name,
    event.event_type,
    event.event_date,
    event.rsvp_deadline,
    event.venue_name,
    event.venue_address,
    event.gift_payment_url,
    event.show_meal_pref,
    event.celebrants,
  ]);

  return (
    <form key={serverFingerprint} action={formAction} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          שם האירוע
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={event.name}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div>
        <label htmlFor="event_type" className="mb-1 block text-sm font-medium">
          סוג אירוע
        </label>
        <select
          id="event_type"
          // Locked while an operational campaign exists (the template family +
          // parameter contract are bound to the type). A disabled control is not
          // POSTed, so the value rides in a hidden input below (select has no name).
          name={hasOperationalCampaign ? undefined : 'event_type'}
          required
          value={eventType}
          disabled={hasOperationalCampaign}
          // The options are rendered from EVENT_TYPES, so the emitted value
          // is always a valid EventType.
          onChange={(e) => setEventType(e.target.value as EventType)}
          className={inputClass}
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {hasOperationalCampaign ? (
          <>
            <input type="hidden" name="event_type" value={event.event_type} />
            <p className="mt-1 text-xs text-muted-foreground">
              נעול כל עוד קמפיין אישורי-הגעה פעיל
            </p>
          </>
        ) : null}
        <FieldError errors={state?.fieldErrors?.event_type} />
      </div>

      {/* key={eventType}: remount the uncontrolled group on type change, so
          the stored defaults prefill only while the selected kind matches. */}
      <CelebrantFields
        key={eventType}
        eventType={eventType}
        defaults={celebrantDefaults(event.celebrants)}
        errors={state?.fieldErrors}
        requiredKeys={
          hasOperationalCampaign
            ? CELEBRANT_REQUIRED_FIELD_KEYS_BY_KIND[
                CELEBRANT_KIND_BY_EVENT_TYPE[eventType]
              ]
            : undefined
        }
      />

      <div>
        <label htmlFor="event_date" className="mb-1 block text-sm font-medium">
          תאריך האירוע
        </label>
        <DateSelectIL
          id="event_date"
          name={isDraft ? 'event_date' : undefined}
          defaultValue={dateInputValue(event.event_date)}
          disabled={!isDraft}
        />
        {!isDraft ? (
          <p className="mt-1 text-xs text-muted-foreground">נעול לאחר פרסום</p>
        ) : null}
        <FieldError errors={state?.fieldErrors?.event_date} />
      </div>

      <div>
        <label htmlFor="event_time" className="mb-1 block text-sm font-medium">
          שעת האירוע
        </label>
        <TimeSelect24
          id="event_time"
          name={isDraft ? 'event_time' : undefined}
          defaultValue={ilTimeInputValue(event.event_date)}
          disabled={!isDraft}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {isDraft
            ? 'תופיע בהזמנות ובתזכורות (שעון ישראל)'
            : 'נעול לאחר פרסום'}
        </p>
        <FieldError errors={state?.fieldErrors?.event_time} />
      </div>

      <div>
        <label htmlFor="rsvp_deadline" className="mb-1 block text-sm font-medium">
          מועד אחרון לאישור הגעה
        </label>
        <DateSelectIL
          id="rsvp_deadline"
          name={isDraft ? 'rsvp_deadline' : undefined}
          defaultValue={dateInputValue(event.rsvp_deadline)}
          disabled={!isDraft}
        />
        {!isDraft ? (
          <p className="mt-1 text-xs text-muted-foreground">נעול לאחר פרסום</p>
        ) : null}
        <FieldError errors={state?.fieldErrors?.rsvp_deadline} />
      </div>

      <div>
        <label htmlFor="venue_name" className="mb-1 block text-sm font-medium">
          מיקום
        </label>
        <input
          id="venue_name"
          name="venue_name"
          type="text"
          // Bound into every pending invite/reminder ({{…}} venue line) — while an
          // operational campaign exists it may change but must not be emptied, else
          // the next send skips as params_incomplete. Server-enforced too.
          required={hasOperationalCampaign}
          defaultValue={event.venue_name ?? ''}
          className={inputClass}
        />
        {hasOperationalCampaign ? (
          <p className="mt-1 text-xs text-muted-foreground">
            המיקום מופיע בהזמנות ובתזכורות ולכן אינו יכול להישאר ריק כל עוד קמפיין פעיל.
          </p>
        ) : null}
        <FieldError errors={state?.fieldErrors?.venue_name} />
      </div>

      <div>
        <label htmlFor="venue_address" className="mb-1 block text-sm font-medium">
          כתובת המקום
        </label>
        <input
          id="venue_address"
          name="venue_address"
          type="text"
          defaultValue={event.venue_address ?? ''}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.venue_address} />
      </div>

      <div>
        <label htmlFor="gift_payment_url" className="mb-1 block text-sm font-medium">
          קישור למתנה (פייבוקס/ביט)
        </label>
        <input
          id="gift_payment_url"
          name="gift_payment_url"
          type="url"
          dir="ltr"
          placeholder="https://…"
          defaultValue={event.gift_payment_url ?? ''}
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          יופיע בתזכורת המתנה בוואטסאפ — האורחים יועברו אליו בלחיצה.
        </p>
        <FieldError errors={state?.fieldErrors?.gift_payment_url} />
      </div>

      <div>
        <label className="flex items-start gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="show_meal_pref"
            defaultChecked={event.show_meal_pref}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            איסוף העדפת תפריט מהאורחים
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              כשמופעל, טופס אישור ההגעה יציג לאורחים שמאשרים הגעה שדה חופשי
              להעדפת תפריט (כשר, צמחוני וכדומה). ניתן לשינוי בכל שלב.
            </span>
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="invite_image" className="mb-1 block text-sm font-medium">
          תמונת הזמנה (רשות)
        </label>
        {inviteImageUrl ? (
          <a
            href={inviteImageUrl}
            target="_blank"
            rel="noreferrer"
            className="mb-2 block w-fit"
            aria-label="פתיחת תמונת ההזמנה הנוכחית בגודל מלא"
          >
            <Image
              src={inviteImageUrl}
              alt="תמונת ההזמנה הנוכחית"
              width={320}
              height={180}
              className="h-auto w-full max-w-[20rem] rounded-md border border-border object-contain"
            />
          </a>
        ) : null}
        <input
          id="invite_image"
          name="invite_image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && f.size > INVITE_IMAGE_MAX_BYTES) {
              setImageError('הקובץ גדול מדי (מעל 5MB) — נא לכווץ את התמונה.');
              e.target.value = '';
            } else {
              setImageError(null);
            }
          }}
        />
        <FieldError errors={imageError ? [imageError] : undefined} />
        <p className="mt-1 text-xs text-muted-foreground">
          {event.invite_image_path
            ? 'זו התמונה הנוכחית — העלאת קובץ חדש תחליף אותה. תופיע בראש הזמנת הוואטסאפ.'
            : 'JPG / PNG / WebP עד 5MB — תופיע בראש הזמנת הוואטסאפ.'}
        </p>
      </div>

      <SubmitButton>שמירת שינויים</SubmitButton>
    </form>
  );
}
