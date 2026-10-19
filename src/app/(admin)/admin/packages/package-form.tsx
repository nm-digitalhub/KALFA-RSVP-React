'use client';

import { useActionState, useId, useState } from 'react';
import { Can } from '@casl/react';
import { PackageCopyField } from './package-copy-field';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import type { PlatformAbility } from '@/lib/casl';
import type { ChannelCatalogEntry } from '@/lib/data/channel-catalog';
import { firstSelectableKey, type ScheduleStepOption } from '@/lib/data/schedule-picker';

// Shared create/edit form for a package. The parent binds the correct Server
// Action (create, or update with the id pre-bound) and passes initial values
// for edit mode. `includes` (a JSON string[]) is edited as one item per line.
//
// A package is sold at ONE fixed price (`price_with_vat`, charged once) with a `contact_quota`: how many contacts its
// campaign may approach.
// `channels` is a checkbox group, one box per channel in the admin-managed catalog
// (channelOptions); the storable values are the campaign_channel enum (whatsapp/call).
// `outreach_schedule` is edited as a structured row list (never raw JSON
// typed by the admin) and synced into one hidden `outreach_schedule_json`
// field before submit.
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
  contact_quota: number | '';
  channels: string[];
  outreach_schedule: OutreachTouchpointFormValue[];
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
  contact_quota: '',
  channels: [],
  outreach_schedule: [],
};

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const labelClass = 'block text-sm font-medium';
const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

// What a new package starts with when an existing package already has a schedule: its channels and its steps, and the
// name of the package they came from, so the copy is shown and never silent.
export type ScheduleSeed = {
  fromName: string;
  channels: string[];
  schedule: OutreachTouchpointFormValue[];
};

function TouchpointRow({
  value,
  onChange,
  onRemove,
  errors,
  callChannelStatus,
  channelOptions,
  stepOptions,
}: {
  value: OutreachTouchpointFormValue;
  onChange: (next: OutreachTouchpointFormValue) => void;
  onRemove: () => void;
  errors?: string[];
  callChannelStatus: CallChannelStatus;
  channelOptions: ChannelCatalogEntry[];
  // Every step an admin may put on a schedule (the page loads them); the row shows the ones of its own channel.
  stepOptions: ScheduleStepOption[];
}) {
  // Each field of the row is tied to its visible label, so a screen reader and a click on the label reach the control.
  const rowId = useId();
  const forChannel = stepOptions.filter((o) => o.channel === value.channel);
  // A stored key that is not on offer (an old value, or a step that has since been switched off for good) stays visible
  // and selected rather than being swapped silently; the save-time check says what is wrong with it.
  const keyIsOffered = forChannel.some((o) => o.messageKey === value.message_key);
  return (
    <div className="space-y-1 rounded-md border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[6rem_10rem_1fr_auto] sm:items-center">
        <div>
          <label htmlFor={`${rowId}-days`} className="text-xs text-muted-foreground">
            ימים לפני
          </label>
          <input
            id={`${rowId}-days`}
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
          <label htmlFor={`${rowId}-channel`} className="text-xs text-muted-foreground">
            ערוץ
          </label>
          <select
            id={`${rowId}-channel`}
            value={value.channel}
            // A step of one channel is not a step of another: the row moves to the first pickable step of the new channel.
            onChange={(e) =>
              onChange({ ...value, channel: e.target.value, message_key: firstSelectableKey(stepOptions, e.target.value) })
            }
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
          <label htmlFor={`${rowId}-key`} className="text-xs text-muted-foreground">
            {value.channel === 'call' ? 'תסריט שיחה' : 'תבנית הודעה'}
          </label>
          <select
            id={`${rowId}-key`}
            value={value.message_key}
            onChange={(e) => onChange({ ...value, message_key: e.target.value })}
            className={inputClass}
          >
            {value.message_key === '' ? (
              <option value="" disabled>
                בחרו…
              </option>
            ) : null}
            {value.message_key !== '' && !keyIsOffered ? (
              <option value={value.message_key} disabled>
                {value.message_key} (לא זמין)
              </option>
            ) : null}
            {forChannel.map((o) => (
              <option key={o.messageKey} value={o.messageKey} disabled={o.problem !== null}>
                {o.label}
                {o.problem ? ` — ${o.problem}` : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-4 text-sm text-destructive hover:underline"
        >
          הסרה
        </button>
      </div>
      {/* The call row's key is INERT today, and the field looks like it configures
          the AI script, so say so rather than let the admin believe picking another
          step there changed the call. It travels as OutreachCallRequest.scriptKey, which is
          written at six call sites and read at none; message_templates holds no
          call-channel rows to validate it against either, which is why
          validateOutreachScheduleForPackage skips call rows. Remove this note the
          moment scriptKey gains a real consumer. */}
      {value.channel === 'call' && (
        <p className="text-xs text-muted-foreground">
          מזהה התסריט אינו בשימוש כרגע — תוכן שיחת ה-AI נקבע בהגדרות סוכן הקול,
          לא כאן. שינוי הערך לא ישנה את מה שייאמר בשיחה.
        </p>
      )}
      {value.channel === 'call' &&
        (callChannelStatus === 'live' ? (
          <p className="text-xs text-muted-foreground">
            ערוץ שיחת ה-AI (Voximplant) פעיל ומחובר. שלב זה יבצע שיחה אמיתית —
            בכפוף להסכמת הנמען, חסימות (DNC), חלון שעות פעילות, יתרה ומכסות.
          </p>
        ) : callChannelStatus === 'configured_off' ? (
          <p className="text-xs text-amber-600">
            ערוץ שיחת ה-AI (Voximplant) מוגדר אך כבוי כרגע — שלב זה לא יבצע שיחה עד
            שהערוץ יודלק תחת /admin/integrations.
          </p>
        ) : (
          <p className="text-xs text-amber-600">
            ערוץ שיחת ה-AI (Voximplant) טרם הוגדר במערכת — הגדירו אותו תחת
            /admin/integrations לפני שילוב שלב שיחה. שלב זה לא יבצע שיחה.
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
  scheduleOptions,
  scheduleSeed = null,
}: {
  action: FormAction;
  initial?: PackageFormInitial;
  submitLabel: string;
  // Three-state dial status of the Voximplant AI-voice channel, derived
  // server-side by the page from getVoximplantConfig() (no manage_voice needed).
  callChannelStatus: CallChannelStatus;
  // Admin-managed channel catalog (public.channels) — the source of the channel
  // list + labels. Fetched by the page.
  channelOptions: ChannelCatalogEntry[];
  // Every step that may be put on the outreach schedule, so the admin picks instead of typing a key.
  scheduleOptions: ScheduleStepOption[];
  // Create page only: the schedule of an existing package, so a new package does not start empty. Ignored when the
  // form is editing (an `initial` was given).
  scheduleSeed?: ScheduleSeed | null;
}) {
  const [state, formAction] = useActionState(action, null);
  const seed = initial === EMPTY ? scheduleSeed : null;
  // The form edits when an `initial` was given and creates otherwise; its save button follows that action.
  const saveAction = initial === EMPTY ? 'create' : 'update';
  const [channels, setChannels] = useState<string[]>(seed?.channels ?? initial.channels);
  const [schedule, setSchedule] = useState<OutreachTouchpointFormValue[]>(
    seed?.schedule ?? initial.outreach_schedule,
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
    // Default to the first catalog channel (falls back to '' if the catalog is empty — the admin then picks
    // explicitly), starting on the first step of that channel that can be picked.
    const channel = channelOptions[0]?.key ?? '';
    setSchedule((prev) => [
      ...prev,
      { days_before: '', channel, message_key: firstSelectableKey(scheduleOptions, channel) },
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

      <PackageCopyField
        field="description"
        label="תיאור"
        initialValue={initial.description}
        rows={3}
        errors={state?.fieldErrors?.description}
      />

      <PackageCopyField
        field="includes"
        label="כלול בחבילה (שורה לכל פריט)"
        initialValue={initial.includes.join('\n')}
        rows={5}
        errors={state?.fieldErrors?.includes}
      />

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
      <h2 className="text-sm font-semibold">תצורת קמפיין</h2>
      <p className="text-xs text-muted-foreground">
        המחיר הקבוע הוא שדה &quot;מחיר&quot; בראש הטופס, והוא נגבה פעם אחת ברכישה. מכסת אנשי קשר היא מספר אנשי
        הקשר שהקמפיין רשאי לפנות אליהם, גם אם לא ענו; אנשי קשר שמעבר למכסה ימתינו. שמירה כאן לא פותחת את החבילה
        למכירה: הצגתה ללקוחות ורכישתה מופעלות בנפרד.
      </p>
      <div className="space-y-1">
        <label htmlFor="contact_quota" className={labelClass}>
          מכסת אנשי קשר
        </label>
        <input
          id="contact_quota"
          name="contact_quota"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          dir="ltr"
          defaultValue={initial.contact_quota}
          className={inputClass}
          required
          placeholder="מספר שלם, 1 ומעלה"
        />
        <FieldError errors={state?.fieldErrors?.contact_quota} />
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
        <span className={labelClass}>לוח פניות</span>
        <p className="text-xs text-muted-foreground">
          כל שלב נשלח מספר ימים לפני האירוע, בערוץ ובתבנית שנבחרו. את התבנית בוחרים מרשימת התבניות במערכת.
        </p>
        {seed ? (
          <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            הלוח והערוצים הועתקו מהחבילה &quot;{seed.fromName}&quot;. אפשר לשנות כל שלב, להסיר שלבים או להוסיף.
          </p>
        ) : null}
        {schedule.map((tp, i) => (
          <TouchpointRow
            key={i}
            value={tp}
            callChannelStatus={callChannelStatus}
            channelOptions={channelOptions}
            stepOptions={scheduleOptions}
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

      {/* Display only: createPackageAction / updatePackageAction check the same action themselves
          (pilot-casl-package-permissions, design D5). */}
      <Can<PlatformAbility> I={saveAction} a="Package">
        <SubmitButton>{submitLabel}</SubmitButton>
      </Can>
    </form>
  );
}
