'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';

import { setOwnerAgentDailyCapAction, setOwnerAgentEnabledAction } from './actions';

// The two app_settings scalars of the owner agent: the kill switch and the daily cap.
// Same shape as the outreach master switch (checkbox + explicit submit) so every
// switch in /admin/integrations is recognisably one mechanism, and a stray click
// changes nothing until "עדכון" is pressed.

export function OwnerAgentSwitch({
  enabled,
  numberSelected,
  activeEntries,
}: {
  enabled: boolean;
  numberSelected: boolean;
  activeEntries: number;
}) {
  const [state, action] = useActionState(setOwnerAgentEnabledAction, null);
  // What "on" will actually do right now. The switch alone diverts nothing: the
  // webhook needs a selected number, and the agent needs someone allowed to reach it.
  const inert = !numberSelected || activeEntries === 0;

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">מתג הסוכן</p>
        <p className="text-xs text-muted-foreground">
          כשהמתג כבוי, הודעה מטלפון ברשימת ההיתר לא מקבלת תשובה ולא מגיעה למודל; נרשמת
          עליה רק שורת יומן עם מזהים. תעבורת האורחים לא תלויה במתג הזה.
        </p>
        {enabled && inert ? (
          <p className="text-xs font-medium text-warning">
            המתג דלוק, אבל הסוכן לא יקבל הודעות עד שייבחר מספר ותהיה לפחות רשומה פעילה
            אחת ברשימת ההיתר.
          </p>
        ) : null}
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="owner_agent_enabled"
            defaultChecked={enabled}
            className="size-4 accent-primary"
          />
          מופעל
        </label>
        <SubmitButton className="w-auto">עדכון</SubmitButton>
      </div>
    </form>
  );
}

export function OwnerAgentDailyCapForm({ dailyCap }: { dailyCap: number }) {
  const [state, action] = useActionState(setOwnerAgentDailyCapAction, null);

  return (
    <form action={action} className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="owner-agent-daily-cap" className="mb-1 block text-sm font-medium">
            תקרה יומית לכל איש צוות
          </label>
          <input
            id="owner-agent-daily-cap"
            name="dailyCap"
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            step={1}
            required
            defaultValue={dailyCap}
            aria-describedby="owner-agent-daily-cap-hint"
            aria-invalid={state?.fieldErrors?.dailyCap ? true : undefined}
            className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <SubmitButton className="w-auto">שמירה</SubmitButton>
      </div>
      <p id="owner-agent-daily-cap-hint" className="text-xs text-muted-foreground">
        מספר ההודעות שהסוכן מעבד לכל איש צוות ביום, לפי שורות אמיתיות ולא לפי מונה בזיכרון.
        0 עד 10000; 0 פירושו שאף הודעה לא מעובדת.
      </p>
      <FieldError errors={state?.fieldErrors?.dailyCap} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
