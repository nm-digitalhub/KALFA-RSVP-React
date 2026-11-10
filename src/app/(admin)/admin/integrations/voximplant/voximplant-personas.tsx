'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { actionErrorMessage, actionFormError } from '@/lib/action-result';
import { VoximplantRuleField } from './voximplant-rule-field';
import {
  updateVoximplantLiveCallsAction,
  updateMeetingConfirmChannelAction,
  updateSalesCallChannelAction,
} from '@/app/(admin)/admin/integrations/actions';

// The three call KILL SWITCHES.
//
// ⚠️ SIBLING FORMS, NEVER NESTED. A <form> inside another <form> produced "React form
// was unexpectedly submitted" on this exact panel. Each switch owns its own <form> and
// its own useActionState, which is why they are exported as three components rather
// than one.
//
// Each dials its OWN rule_id, deliberately separate from voximplant_rule_id
// (the RSVPAgent bridge rule — 1520915, `OutCallAgent` — must never carry another
// persona's calls). Rule 1494311 is `OutCall`, the legacy DTMF `RSVP` scenario;
// CLAUDE.md forbids giving it to any agent persona, this page's fields included. The
// `disabled` attributes are a courtesy — every action re-checks the full config
// server-side and fails closed, and the env VOXIMPLANT_LIVE_CALLS='false' still
// hard-overrides all of it regardless of what the panel shows.

/** The RSVP agent's live-dial gate — enabling PERMITS real, paid outbound calls. */
export function VoximplantLiveCallsToggle({
  liveCalls,
  fullyConfigured,
}: {
  /** raw app_settings.voximplant_live_calls — the toggle's own value, not the effective gate */
  liveCalls: boolean;
  fullyConfigured: boolean;
}) {
  const [state, action] = useActionState(updateVoximplantLiveCallsAction, {});
  return (
    <form
      action={action}
      className="mt-4 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <FormError message={actionErrorMessage(state)} />
      <FormNotice message={state.data?.notice} />
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

// The panel of one persona's switch: its rule field, its checkbox and its submit.
// Markup only — the <form>'s action and its result come from the persona's own
// component (its own useActionState), so the forms stay siblings, never shared.
function PersonaChannelForm({
  action,
  formError,
  notice,
  title,
  description,
  ruleFieldName,
  ruleFieldHelp,
  enabledFieldName,
  ruleId,
  enabled,
  fullyConfigured,
}: {
  action: (formData: FormData) => void;
  formError?: string;
  notice?: string;
  title: string;
  description: React.ReactNode;
  ruleFieldName: string;
  ruleFieldHelp: string;
  enabledFieldName: string;
  ruleId: string;
  enabled: boolean;
  fullyConfigured: boolean;
}) {
  return (
    <form
      action={action}
      className="mt-4 space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-4"
    >
      <FormError message={formError} />
      <FormNotice message={notice} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
          <VoximplantRuleField name={ruleFieldName} defaultValue={ruleId} help={ruleFieldHelp} />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name={enabledFieldName}
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

/** Meeting-confirm persona: its own rule_id, its own toggle. */
export function VoximplantMeetingConfirmToggle({
  ruleId,
  enabled,
  fullyConfigured,
}: {
  ruleId: string;
  enabled: boolean;
  fullyConfigured: boolean;
}) {
  const [state, action] = useActionState(updateMeetingConfirmChannelAction, {});
  return (
    <PersonaChannelForm
      action={action}
      formError={actionFormError(state)}
      notice={state.data?.notice}
      title="שיחות אישור פגישה (Meeting-confirm)"
      description={
        <>
          שיחת AI קצרה לאישור/שינוי מועד לפגישה שכבר תואמה. משתמש בחשבון
          ובמספר היוצא המשותפים, עם Rule ID נפרד משלה.
        </>
      }
      ruleFieldName="voximplant_meeting_confirm_rule_id"
      ruleFieldHelp="הכלל שממנו יוצאת שיחת אישור הפגישה. בחרו מרשימת הכללים בחשבון כדי לא להקליד מזהה מהזיכרון."
      enabledFieldName="voximplant_meeting_confirm_enabled"
      ruleId={ruleId}
      enabled={enabled}
      fullyConfigured={fullyConfigured}
    />
  );
}

/** Sales-closing persona: its own rule_id, its own toggle. */
export function VoximplantSalesCallToggle({
  ruleId,
  enabled,
  fullyConfigured,
}: {
  ruleId: string;
  enabled: boolean;
  fullyConfigured: boolean;
}) {
  const [state, action] = useActionState(updateSalesCallChannelAction, {});
  return (
    <PersonaChannelForm
      action={action}
      formError={actionFormError(state)}
      notice={state.data?.notice}
      title="שיחות סגירת מכירה (Sales-closing)"
      description={
        <>
          שיחת AI יוצאת ללקוח שביקש חזרה בנושא &quot;מכירות&quot;, במועד
          שנקבע. משתמש בחשבון ובמספר היוצא המשותפים, עם Rule ID נפרד משלה.
        </>
      }
      ruleFieldName="voximplant_sales_call_rule_id"
      ruleFieldHelp="הכלל שממנו יוצאת שיחת סגירת המכירה. בחרו מרשימת הכללים בחשבון כדי לא להקליד מזהה מהזיכרון."
      enabledFieldName="voximplant_sales_calls_enabled"
      ruleId={ruleId}
      enabled={enabled}
      fullyConfigured={fullyConfigured}
    />
  );
}
