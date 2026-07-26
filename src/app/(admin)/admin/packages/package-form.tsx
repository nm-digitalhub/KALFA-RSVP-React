'use client';

import { useActionState, useState } from 'react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import type { ChannelCatalogEntry } from '@/lib/data/channel-catalog';

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
// A `call` touchpoint dials the live Voximplant AI-voice bridge (RSVPAgent,
// rule 1520915). The row shows the REAL channel state, derived server-side from
// getVoximplantConfig() (env + app_settings, no manage_voice needed) and passed
// in as `callChannelStatus` — three states, so the copy never claims the channel
// is "built" when it was never configured:
//   'not_configured' → getVoximplantConfig() === null (no SA/rule/caller)
//   'configured_off' → configured but liveCallsEnabled === false (env/DB toggle off)
//   'live'           → liveCallsEnabled === true (a real call will fire, subject to
//                      consent/DNC/quiet-hours/balance/quotas)
export type CallChannelStatus = 'not_configured' | 'configured_off' | 'live';

// Gate-aware pricing-model status, computed server-side by the page. `gateActive`
// = app_settings.base_overage_pricing_enabled. `effectiveSummaryHe` is the live,
// data-driven price phrasing from buildBusinessFacts (the SAME source the
// support-drafter quotes) — never a number hardcoded here; null when there is no
// saved campaign package yet (the create page), where only the gate state shows.
export type PricingModelStatus = {
  gateActive: boolean;
  effectiveSummaryHe: string | null;
};

// `channel` is a plain string: the storable set comes from the admin-managed
// channel catalog (public.channels), and the server (z.enum in validation/admin.ts)
// is the narrowing guard on submit — see channel-catalog.ts.
export type OutreachTouchpointFormValue = {
  days_before: number | '';
  channel: string;
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
  base_price: number | '';
  included_reached: number | '';
  channels: string[];
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
  base_price: '',
  included_reached: '',
  channels: [],
  outreach_schedule: [],
  min_hold_floor: '',
  hold_buffer_pct_percent: '',
};

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const labelClass = 'block text-sm font-medium';
const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

function TouchpointRow({
  value,
  onChange,
  onRemove,
  errors,
  callChannelStatus,
  channelOptions,
}: {
  value: OutreachTouchpointFormValue;
  onChange: (next: OutreachTouchpointFormValue) => void;
  onRemove: () => void;
  errors?: string[];
  callChannelStatus: CallChannelStatus;
  channelOptions: ChannelCatalogEntry[];
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
            onChange={(e) => onChange({ ...value, channel: e.target.value })}
            className={inputClass}
          >
            {channelOptions.map((c) => (
              <option key={c.key} value={c.key}>
                {c.display_name}
              </option>
            ))}
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
      {value.channel === 'call' &&
        (callChannelStatus === 'live' ? (
          <p className="text-xs text-muted-foreground">
            ערוץ שיחת ה-AI (Voximplant) פעיל ומחובר. שלב זה יבצע שיחה אמיתית —
            בכפוף להסכמת הנמען, חסימות (DNC), חלון שעות פעילות, יתרה ומכסות.
          </p>
        ) : callChannelStatus === 'configured_off' ? (
          <p className="text-xs text-amber-600">
            ערוץ שיחת ה-AI (Voximplant) מוגדר אך כבוי כרגע — שלב זה לא יבצע שיחה עד
            שהערוץ יודלק תחת /admin/channels.
          </p>
        ) : (
          <p className="text-xs text-amber-600">
            ערוץ שיחת ה-AI (Voximplant) טרם הוגדר במערכת — הגדירו אותו תחת
            /admin/channels לפני שילוב שלב שיחה. שלב זה לא יבצע שיחה.
          </p>
        ))}
      <FieldError errors={errors} />
    </div>
  );
}

export function PackageForm({
  action,
  initial = EMPTY,
  submitLabel,
  callChannelStatus,
  channelOptions,
  pricingModelStatus,
}: {
  action: FormAction;
  initial?: PackageFormInitial;
  submitLabel: string;
  // Three-state dial status of the Voximplant AI-voice channel, derived
  // server-side by the page from getVoximplantConfig() (no manage_voice needed).
  callChannelStatus: CallChannelStatus;
  // Admin-managed channel catalog (public.channels) — the source of the channel
  // list + labels, replacing the old hardcoded literals. Fetched by the page.
  channelOptions: ChannelCatalogEntry[];
  // Gate-aware effective pricing model, so the base/included fields don't
  // mislead (they are inert while the base+overage gate is off).
  pricingModelStatus: PricingModelStatus;
}) {
  const [state, formAction] = useActionState(action, null);
  const [channels, setChannels] = useState<string[]>(initial.channels);
  const [schedule, setSchedule] = useState<OutreachTouchpointFormValue[]>(
    initial.outreach_schedule,
  );

  function toggleChannel(channel: string, checked: boolean) {
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
      // Default to the first catalog channel (falls back to '' if the catalog is
      // empty — the admin then picks explicitly).
      { days_before: '', channel: channelOptions[0]?.key ?? '', message_key: '' },
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
          מחיר לכל מושג מעבר לכמות הכלולה (חריגה, ₪)
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="base_price" className={labelClass}>
            מחיר בסיס (₪)
          </label>
          <input
            id="base_price"
            name="base_price"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            dir="ltr"
            defaultValue={initial.base_price}
            className={inputClass}
            placeholder="ריק = בלי דמי בסיס (לפי תוצאה בלבד)"
          />
          <FieldError errors={state?.fieldErrors?.base_price} />
        </div>
        <div className="space-y-1">
          <label htmlFor="included_reached" className={labelClass}>
            כמות מושגים כלולה בבסיס
          </label>
          <input
            id="included_reached"
            name="included_reached"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            dir="ltr"
            defaultValue={initial.included_reached}
            className={inputClass}
            placeholder="מספר המושגים הכלול במחיר הבסיס"
          />
          <FieldError errors={state?.fieldErrors?.included_reached} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        מחיר בסיס + כמות כלולה מפעילים תמחור מדורג (בסיס + חריגה): הבסיס נגבה עד
        הכמות הכלולה, ומעבר לה מחיר החריגה לכל מושג נוסף. השאירו את שניהם ריקים
        לתמחור לפי-תוצאה בלבד. התמחור החדש נכנס לתוקף רק כשהוא מודלק במערכת.
      </p>

      {/* Gate-aware effective-model status. Numbers come from the data-driven
          effectiveSummaryHe (buildBusinessFacts) — never hardcoded here. */}
      <div
        className={`rounded-md border p-3 text-xs ${
          pricingModelStatus.gateActive
            ? 'border-border text-muted-foreground'
            : 'border-amber-300 text-amber-700'
        }`}
      >
        {pricingModelStatus.gateActive ? (
          <p>
            המודל המדורג (בסיס + חריגה) פעיל במערכת — קמפיינים חדשים יחויבו לפיו.
          </p>
        ) : (
          <p>
            המודל המדורג (בסיס + חריגה) מוגדר אך כבוי כרגע — המחיר האפקטיבי הוא
            לפי-תוצאה בלבד. שדות מחיר הבסיס והכמות הכלולה נשמרים אך אינם פעילים
            עד שהמודל יודלק במערכת.
          </p>
        )}
        {pricingModelStatus.effectiveSummaryHe ? (
          <p className="mt-1 font-medium">
            המחיר האפקטיבי כעת: {pricingModelStatus.effectiveSummaryHe}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <span className={labelClass}>ערוצים</span>
        <div className="flex gap-4">
          {channelOptions.map((channel) => (
            <label key={channel.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="channels"
                value={channel.key}
                checked={channels.includes(channel.key)}
                onChange={(e) => toggleChannel(channel.key, e.target.checked)}
                className="size-4 rounded border-border"
              />
              {channel.display_name}
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
            callChannelStatus={callChannelStatus}
            channelOptions={channelOptions}
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
