'use client';

import { useActionState, useState } from 'react';

import { createEventAction } from '../actions';
import { CelebrantFields } from '../celebrant-fields';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import { INVITE_IMAGE_MAX_BYTES } from '@/lib/constants';
import { FieldError, FormError, SubmitButton } from '@/components/forms';
import { TimeSelect24 } from '@/components/time-select-24';
import { DateSelectIL } from '@/components/date-select-il';

type EventType = (typeof EVENT_TYPES)[number];

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ms-0.5 text-red-500">
      *
    </span>
  );
}

// The create form carries the SAME fields as the event page's edit form
// (owner ruling 2026-09-02: 1:1 — every owner-editable detail can be entered up
// front, not discovered later on the event page). What it deliberately lacks
// are the edit form's locks (dates after confirmation, type/celebrants/venue
// while a campaign is in process) — none apply to a brand-new draft — and the
// prefilled values. Both forms validate against the one eventFormSchema and
// share CelebrantFields, so they cannot drift apart.
export function NewEventForm() {
  const [state, action] = useActionState(createEventAction, null);

  // Controlled so the celebrant field group below follows the selected type.
  const [eventType, setEventType] = useState<EventType>('wedding');

  // Client-side pre-check of the image size cap: a pick above the Server
  // Action body limit (6mb) is rejected by the framework BEFORE the action
  // runs, so the server's friendly Hebrew error would never show.
  const [imageError, setImageError] = useState<string | null>(null);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />

      <p className="text-xs text-muted-foreground">
        שדות המסומנים ב-<span className="text-red-500">*</span> הם חובה
      </p>

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          שם האירוע
          <RequiredMark />
        </label>
        <input id="name" name="name" type="text" required className={inputClass} />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div>
        <label htmlFor="event_type" className="mb-1 block text-sm font-medium">
          סוג אירוע
          <RequiredMark />
        </label>
        <select
          id="event_type"
          name="event_type"
          required
          className={inputClass}
          value={eventType}
          // The options are rendered from EVENT_TYPES, so the emitted value
          // is always a valid EventType.
          onChange={(e) => setEventType(e.target.value as EventType)}
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <FieldError errors={state?.fieldErrors?.event_type} />
      </div>

      {/* key={eventType}: remount the uncontrolled group on type change. */}
      <CelebrantFields key={eventType} eventType={eventType} errors={state?.fieldErrors} />

      <div>
        <label htmlFor="event_date" className="mb-1 block text-sm font-medium">
          תאריך האירוע
          <RequiredMark />
        </label>
        <DateSelectIL id="event_date" name="event_date" required />
        <p className="mt-1 text-xs text-muted-foreground">יום / חודש / שנה</p>
        <FieldError errors={state?.fieldErrors?.event_date} />
      </div>

      <div>
        <label htmlFor="event_time" className="mb-1 block text-sm font-medium">
          שעת האירוע
        </label>
        <TimeSelect24 id="event_time" name="event_time" />
        <p className="mt-1 text-xs text-muted-foreground">
          רשות — תופיע בהזמנות ובתזכורות (שעון ישראל)
        </p>
        <FieldError errors={state?.fieldErrors?.event_time} />
      </div>

      <div>
        <label htmlFor="rsvp_deadline" className="mb-1 block text-sm font-medium">
          מועד אחרון לאישור הגעה
        </label>
        <DateSelectIL id="rsvp_deadline" name="rsvp_deadline" />
        <p className="mt-1 text-xs text-muted-foreground">
          רשות — עד יום האירוע, כולל
        </p>
        <FieldError errors={state?.fieldErrors?.rsvp_deadline} />
      </div>

      <div>
        <label htmlFor="venue_name" className="mb-1 block text-sm font-medium">
          מיקום
        </label>
        <input id="venue_name" name="venue_name" type="text" className={inputClass} />
        <p className="mt-1 text-xs text-muted-foreground">
          מופיע בהזמנות ובתזכורות — יש למלא לפני הפעלת אישורי הגעה
        </p>
        <FieldError errors={state?.fieldErrors?.venue_name} />
      </div>

      <div>
        <label htmlFor="venue_address" className="mb-1 block text-sm font-medium">
          כתובת המקום
        </label>
        <input id="venue_address" name="venue_address" type="text" className={inputClass} />
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
            defaultChecked
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
          JPG / PNG / WebP עד 5MB — תופיע בראש הזמנת הוואטסאפ.
        </p>
      </div>

      <SubmitButton>יצירת אירוע</SubmitButton>
    </form>
  );
}
