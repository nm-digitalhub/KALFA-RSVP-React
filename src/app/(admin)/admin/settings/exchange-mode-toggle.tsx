'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton, compactSelectClass } from '@/components/forms';
import { updateExchangeConnectionModeAction } from './actions';

// Admin control for app_settings.exchange_connection_mode (plan §3.1,
// plans/exchange-ews-stage1.md). Native <select> (not the shadcn Select
// primitive) — same convention as the rest of this admin form family:
// FormData-native, no controlled state needed to submit correctly.
export function ExchangeModeToggle({ mode }: { mode: 'per_user' | 'per_org' }) {
  const [state, formAction] = useActionState(updateExchangeConnectionModeAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <label className="flex items-center gap-2 text-sm font-medium">
        מודל בעלות על חיבור Exchange
        <select
          name="exchange_connection_mode"
          defaultValue={mode}
          className={compactSelectClass}
        >
          <option value="per_user">לפי משתמש (ברירת מחדל)</option>
          <option value="per_org">משותף לארגון</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        קובע רק אילו חיבורים חדשים נוצרים ואיזה מסלול פעיל במסך &quot;חיבור
        Exchange&quot; שמעל (/admin/settings) — לא מוחק ולא מנתק חיבורים קיימים.
      </p>
      <SubmitButton className="w-auto">שמירה</SubmitButton>
    </form>
  );
}
