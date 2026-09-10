'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import {
  updateVoximplantLiveCallsAction,
  updateMeetingConfirmChannelAction,
  updateSalesCallChannelAction,
} from '@/app/(admin)/admin/channels/actions';

// The three call KILL SWITCHES, lifted out of channels-client.tsx so the provider page
// and the old channels tab render one definition while both exist.
//
// ⚠️ SIBLING FORMS, NEVER NESTED. Carried over verbatim from the comment these forms
// were written under, because it is the evidence for the bug it prevents: a <form>
// inside another <form> produced "React form was unexpectedly submitted" on this exact
// panel. Each switch owns its own <form> and its own useActionState, which is why they
// are exported as three components rather than one.
//
// Each dials its OWN rule_id, deliberately separate from voximplant_rule_id
// (RSVPAgent's OutCall rule, 1494311, must never carry another persona's calls). The
// `disabled` attributes are a courtesy — every action re-checks the full config
// server-side and fails closed, and the env VOXIMPLANT_LIVE_CALLS='false' still
// hard-overrides all of it regardless of what the panel shows.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

/** The RSVP agent's live-dial gate — enabling PERMITS real, paid outbound calls. */
export function VoximplantLiveCallsToggle({
  liveCalls,
  fullyConfigured,
}: {
  /** raw app_settings.voximplant_live_calls — the toggle's own value, not the effective gate */
  liveCalls: boolean;
  fullyConfigured: boolean;
}) {
  const [state, action] = useActionState(updateVoximplantLiveCallsAction, null);
  return (
    <form
      action={action}
      className="mt-4 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">שיחות חיות (Live calls)</p>
          <p className="text-xs text-muted-foreground">
            הפעלה = שיחות טלפון אמיתיות בתשלום, לאנשי קשר שנתנו הסכמה בלבד.
            {fullyConfigured
              ? ''
              : ' יש להשלים את כל פרטי החשבון והחיוג לפני הפעלה.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="voximplant_live_calls"
              defaultChecked={liveCalls}
              disabled={!fullyConfigured && !liveCalls}
              className="size-4 accent-primary"
            />
            מופעל
          </label>
          <SubmitButton className="w-auto">עדכון</SubmitButton>
        </div>
      </div>
    </form>
  );
}

/** Meeting-confirm persona (2026-08-22): its own rule_id, its own toggle. */
export function VoximplantMeetingConfirmToggle({
  ruleId,
  enabled,
  fullyConfigured,
}: {
  ruleId: string;
  enabled: boolean;
  fullyConfigured: boolean;
}) {
  const [state, action] = useActionState(updateMeetingConfirmChannelAction, null);
  return (
    <form
      action={action}
      className="mt-4 space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-4"
    >
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">שיחות אישור פגישה (Meeting-confirm)</p>
          <p className="text-xs text-muted-foreground">
            שיחת AI קצרה לאישור/שינוי מועד לפגישה שכבר תואמה. משתמש בחשבון
            ובמספר היוצא המשותפים, עם Rule ID נפרד משלה.
          </p>
          <label htmlFor="voximplant_meeting_confirm_rule_id" className={labelClass}>
            Rule ID
          </label>
          <input
            id="voximplant_meeting_confirm_rule_id"
            name="voximplant_meeting_confirm_rule_id"
            dir="ltr"
            defaultValue={ruleId}
            placeholder="לא הוגדר"
            className={inputClass}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="voximplant_meeting_confirm_enabled"
              defaultChecked={enabled}
              disabled={!fullyConfigured && !enabled}
              className="size-4 accent-primary"
            />
            מופעל
          </label>
          <SubmitButton className="w-auto">עדכון</SubmitButton>
        </div>
      </div>
    </form>
  );
}

/** Sales-closing persona (2026-08-22): its own rule_id, its own toggle. */
export function VoximplantSalesCallToggle({
  ruleId,
  enabled,
  fullyConfigured,
}: {
  ruleId: string;
  enabled: boolean;
  fullyConfigured: boolean;
}) {
  const [state, action] = useActionState(updateSalesCallChannelAction, null);
  return (
    <form
      action={action}
      className="mt-4 space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-4"
    >
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">שיחות סגירת מכירה (Sales-closing)</p>
          <p className="text-xs text-muted-foreground">
            שיחת AI יוצאת ללקוח שביקש חזרה בנושא &quot;מכירות&quot;, במועד
            שנקבע. משתמש בחשבון ובמספר היוצא המשותפים, עם Rule ID נפרד משלה.
          </p>
          <label htmlFor="voximplant_sales_call_rule_id" className={labelClass}>
            Rule ID
          </label>
          <input
            id="voximplant_sales_call_rule_id"
            name="voximplant_sales_call_rule_id"
            dir="ltr"
            defaultValue={ruleId}
            placeholder="לא הוגדר"
            className={inputClass}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="voximplant_sales_calls_enabled"
              defaultChecked={enabled}
              disabled={!fullyConfigured && !enabled}
              className="size-4 accent-primary"
            />
            מופעל
          </label>
          <SubmitButton className="w-auto">עדכון</SubmitButton>
        </div>
      </div>
    </form>
  );
}
