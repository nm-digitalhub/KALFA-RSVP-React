'use client';

import { useActionState, useState } from 'react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// Shared create/edit form for a package. The parent binds the correct Server
// Action (create, or update with the id pre-bound) and passes initial values
// for edit mode. `includes` (a JSON string[]) is edited as one item per line.
//
// Operational (campaign) fields: `price_per_reached` empty = the package is
// NOT campaign-enabled (a valid state, not an error — see
// plans/admin-packages-operational-fields-plan.md §1.6/§2). `channels` is a
// checkbox pair (whatsapp/call — the only two campaign_channel values).
// `outreach_schedule` is edited as a structured row list (never raw JSON
// typed by the admin) and synced into one hidden `outreach_schedule_json`
// field before submit. `hold_buffer_pct` is entered/displayed as a PERCENT
// (10 = +10%); the server converts to the stored fraction (0.1) — see §5.1.
// A `call` touchpoint has no verifiable source of truth yet (the Voximplant
// AI-voice channel is not built — see admin/channels/channels-client.tsx's
// disabled "Voximplant (בקרוב)" tab) and is flagged as such, not blocked.

export type OutreachTouchpointFormValue = {
  days_before: number | '';
  channel: 'whatsapp' | 'call';
  message_key: string;
};

export interface PackageFormInitial {
  name: string;
  tier: string;
  category: string;
  description: string;
  price_with_vat: number | '';
  includes: string[];
  active: boolean;
  sort_order: number | '';
  price_per_reached: number | '';
  channels: ('whatsapp' | 'call')[];
  outreach_schedule: OutreachTouchpointFormValue[];
  min_hold_floor: number | '';
  // Percent, for display — already converted from the stored fraction by the
  // caller (page.tsx), e.g. stored 0.1 → 10 here.
  hold_buffer_pct_percent: number | '';
}

const EMPTY: PackageFormInitial = {
  name: '',
  tier: '',
  category: '',
  description: '',
  price_with_vat: '',
  includes: [],
  active: true,
  sort_order: '',
  price_per_reached: '',
  channels: [],
  outreach_schedule: [],
  min_hold_floor: '',
  hold_buffer_pct_percent: '',
};

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const labelClass = 'block text-sm font-medium';
const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

const CHANNEL_LABELS: Record<'whatsapp' | 'call', string> = {
  whatsapp: 'וואטסאפ',
  call: 'שיחת AI (Voximplant)',
};

function TouchpointRow({
  value,
  onChange,
  onRemove,
  errors,
}: {
  value: OutreachTouchpointFormValue;
  onChange: (next: OutreachTouchpointFormValue) => void;
  onRemove: () => void;
  errors?: string[];
}) {
  return (
    <div className="space-y-1 rounded-md border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[6rem_10rem_1fr_auto] sm:items-center">
        <div>
          <label className="text-xs text-muted-foreground">ימים לפני</label>
          <input
            type="number"
            min="0"
            step="1"
            dir="ltr"
            value={value.days_before}
            onChange={(e) =>
              onChange({
                ...value,
                days_before: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">ערוץ</label>
          <select
            value={value.channel}
            onChange={(e) =>
              onChange({ ...value, channel: e.target.value as 'whatsapp' | 'call' })
            }
            className={inputClass}
          >
            <option value="whatsapp">{CHANNEL_LABELS.whatsapp}</option>
            <option value="call">{CHANNEL_LABELS.call}</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">מזהה תבנית הודעה</label>
          <input
            type="text"
            dir="ltr"
            value={value.message_key}
            onChange={(e) => onChange({ ...value, message_key: e.target.value })}
            className={inputClass}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-4 text-sm text-destructive hover:underline"
        >
          הסרה
        </button>
      </div>
      {value.channel === 'call' && (
        <p className="text-xs text-amber-600">
          לא מאומת — ערוץ ה-AI voice (Voximplant) טרם נבנה (C2). השלב הזה לא
          יופעל עד אז.
        </p>
      )}
      <FieldError errors={errors} />
    </div>
  );
}

export function PackageForm({
  action,
  initial = EMPTY,
  submitLabel,
}: {
  action: FormAction;
  initial?: PackageFormInitial;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [channels, setChannels] = useState<('whatsapp' | 'call')[]>(initial.channels);
  const [schedule, setSchedule] = useState<OutreachTouchpointFormValue[]>(
    initial.outreach_schedule,
  );

  function toggleChannel(channel: 'whatsapp' | 'call', checked: boolean) {
    setChannels((prev) =>
      checked ? [...prev, channel] : prev.filter((c) => c !== channel),
    );
  }

  function updateTouchpoint(index: number, next: OutreachTouchpointFormValue) {
    setSchedule((prev) => prev.map((tp, i) => (i === index ? next : tp)));
  }

  function removeTouchpoint(index: number) {
    setSchedule((prev) => prev.filter((_, i) => i !== index));
  }

  function addTouchpoint() {
    setSchedule((prev) => [
      ...prev,
      { days_before: '', channel: 'whatsapp', message_key: '' },
    ]);
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div className="space-y-1">
        <label htmlFor="name" className={labelClass}>
          שם החבילה
        </label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={initial.name}
          className={inputClass}
          required
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="tier" className={labelClass}>
            דרגה
          </label>
          <input
            id="tier"
            name="tier"
            type="text"
            defaultValue={initial.tier}
            className={inputClass}
            required
          />
          <FieldError errors={state?.fieldErrors?.tier} />
        </div>

        <div className="space-y-1">
          <label htmlFor="category" className={labelClass}>
            קטגוריה
          </label>
          <input
            id="category"
            name="category"
            type="text"
            defaultValue={initial.category}
            className={inputClass}
            required
          />
          <FieldError errors={state?.fieldErrors?.category} />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="price_with_vat" className={labelClass}>
          מחיר (₪, מחיר סופי לצרכן)
        </label>
        <input
          id="price_with_vat"
          name="price_with_vat"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          dir="ltr"
          defaultValue={initial.price_with_vat}
          className={inputClass}
          required
        />
        <FieldError errors={state?.fieldErrors?.price_with_vat} />
      </div>

      <div className="space-y-1">
        <label htmlFor="description" className={labelClass}>
          תיאור
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial.description}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.description} />
      </div>

      <div className="space-y-1">
        <label htmlFor="includes" className={labelClass}>
          כלול בחבילה (שורה לכל פריט)
        </label>
        <textarea
          id="includes"
          name="includes"
          rows={5}
          defaultValue={initial.includes.join('\n')}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.includes} />
      </div>

      <div className="space-y-1">
        <label htmlFor="sort_order" className={labelClass}>
          סדר תצוגה
        </label>
        <input
          id="sort_order"
          name="sort_order"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          dir="ltr"
          defaultValue={initial.sort_order}
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground">
          מספר נמוך מוצג קודם בקטלוג הלקוחות. ברירת מחדל: 0.
        </p>
        <FieldError errors={state?.fieldErrors?.sort_order} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={initial.active}
          className="size-4 rounded border-border"
        />
        <label htmlFor="active" className="text-sm font-medium">
          חבילה פעילה (מוצגת ללקוחות)
        </label>
        <FieldError errors={state?.fieldErrors?.active} />
      </div>

      <hr className="border-border" />
      <h2 className="text-sm font-semibold">תצורת קמפיין (אופציונלי)</h2>
      <p className="text-xs text-muted-foreground">
        השאירו את מחיר-לאיש-קשר ריק אם החבילה אינה מסלול קמפיין.
      </p>

      <div className="space-y-1">
        <label htmlFor="price_per_reached" className={labelClass}>
          מחיר לאיש קשר שהושג (₪)
        </label>
        <input
          id="price_per_reached"
          name="price_per_reached"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          dir="ltr"
          defaultValue={initial.price_per_reached}
          className={inputClass}
          placeholder="ריק = לא מסלול קמפיין"
        />
        <FieldError errors={state?.fieldErrors?.price_per_reached} />
      </div>

      <div className="space-y-1">
        <span className={labelClass}>ערוצים</span>
        <div className="flex gap-4">
          {(['whatsapp', 'call'] as const).map((channel) => (
            <label key={channel} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="channels"
                value={channel}
                checked={channels.includes(channel)}
                onChange={(e) => toggleChannel(channel, e.target.checked)}
                className="size-4 rounded border-border"
              />
              {CHANNEL_LABELS[channel]}
            </label>
          ))}
        </div>
        <FieldError errors={state?.fieldErrors?.channels} />
      </div>

      <div className="space-y-2">
        <span className={labelClass}>לוח פניות (outreach schedule)</span>
        {schedule.map((tp, i) => (
          <TouchpointRow
            key={i}
            value={tp}
            onChange={(next) => updateTouchpoint(i, next)}
            onRemove={() => removeTouchpoint(i)}
            errors={[
              // All per-row error keys the server can emit (§5.4 convention):
              // days_before (structural), channel (§2#5 subset enforcement in
              // superRefine) and message_key (template validation). An empty
              // merged array renders nothing (FieldError returns null).
              ...(state?.fieldErrors?.[`outreach_schedule.${i}.days_before`] ?? []),
              ...(state?.fieldErrors?.[`outreach_schedule.${i}.channel`] ?? []),
              ...(state?.fieldErrors?.[`outreach_schedule.${i}.message_key`] ?? []),
            ]}
          />
        ))}
        <button
          type="button"
          onClick={addTouchpoint}
          className="text-sm text-primary hover:underline"
        >
          + הוספת שלב
        </button>
        <FieldError errors={state?.fieldErrors?.outreach_schedule} />
        {/* Controlled JSON bridge — the admin never types this directly, only
            the structured rows above; readOperationalForm() parses it server-side. */}
        <input
          type="hidden"
          name="outreach_schedule_json"
          value={JSON.stringify(schedule)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="min_hold_floor" className={labelClass}>
            רצפת hold (₪)
          </label>
          <input
            id="min_hold_floor"
            name="min_hold_floor"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            dir="ltr"
            defaultValue={initial.min_hold_floor}
            className={inputClass}
          />
          <FieldError errors={state?.fieldErrors?.min_hold_floor} />
        </div>
        <div className="space-y-1">
          <label htmlFor="hold_buffer_pct" className={labelClass}>
            Buffer (%)
          </label>
          <input
            id="hold_buffer_pct"
            name="hold_buffer_pct"
            type="number"
            min="0"
            step="0.1"
            inputMode="decimal"
            dir="ltr"
            defaultValue={initial.hold_buffer_pct_percent}
            className={inputClass}
            placeholder="לדוגמה: 10 = תוספת 10%"
          />
          <FieldError errors={state?.fieldErrors?.hold_buffer_pct} />
        </div>
      </div>
      <p className="text-xs text-amber-600">
        אזהרה: שינוי כאן משפיע על קמפיינים שכבר אושרו אך טרם ביצעו חיוב-מקדים
        (J5 hold) — לא רק על קמפיינים חדשים.
      </p>

      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
