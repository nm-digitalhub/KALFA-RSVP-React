'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { updateOutreachMasterSwitchAction } from '@/app/(admin)/admin/channels/actions';

// The ONE global outreach switch (app_settings.outreach_enabled), lifted verbatim out
// of channels-client.tsx. It gates every outbound channel — WhatsApp sends AND AI
// dials (src/lib/data/outreach-calls.ts checks getOutreachEnabled() before dialing) —
// which is why it heads BOTH provider pages rather than living on one of them.
//
// The switch has a single writer, updateOutreachMasterSwitchAction, and that does not
// change here: this component only moves the control, never the ownership. The action
// re-checks "at least one channel is configured" server-side, so the `disabled`
// attribute below is a courtesy, not the gate.
//
// It requires `manage_settings` (getOutreachMasterState + setOutreachEnabled both
// enforce it). A page whose own gate is a DIFFERENT permission must therefore decide
// whether to render it with hasPlatformPermission and NOT call the DAL otherwise —
// requirePlatformPermission REDIRECTS, so simply reading the state would eject a
// manage_voice-only viewer out of the admin area. See voximplant/page.tsx.

export function OutreachMasterSwitch({
  enabled,
  anyChannelReady,
}: {
  enabled: boolean;
  anyChannelReady: boolean;
}) {
  const [state, action] = useActionState(updateOutreachMasterSwitchAction, null);
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">מתג פנייה ראשי (כל הערוצים)</p>
        <p className="text-xs text-muted-foreground">
          מפעיל שליחות/שיחות חיות בכל ערוץ מוגדר. שיחות Voximplant דורשות בנוסף
          את מתג השרת VOXIMPLANT_LIVE_CALLS.
        </p>
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="outreach_enabled"
            defaultChecked={enabled}
            disabled={!enabled && !anyChannelReady}
            className="size-4 accent-primary"
          />
          מופעל
        </label>
        <SubmitButton className="w-auto">עדכון</SubmitButton>
      </div>
    </form>
  );
}
