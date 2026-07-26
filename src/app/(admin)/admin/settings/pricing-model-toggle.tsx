'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { updateBaseOveragePricingAction } from './actions';

// Fail-closed toggle for the base+overage pricing gate
// (app_settings.base_overage_pricing_enabled). Its own form + action so the
// notice/error stay scoped; the server refuses to ENABLE unless the approved v4
// base-fee agreement is the active contract (see updateBaseOveragePricingAction),
// and audits every flip. Disabling is always allowed.
export function PricingModelToggle({ enabled }: { enabled: boolean }) {
  const [state, formAction] = useActionState(
    updateBaseOveragePricingAction,
    null,
  );
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="base_overage_pricing_enabled"
          defaultChecked={enabled}
          className="size-4 rounded border-border"
        />
        הפעל תמחור מדורג (דמי הפעלה ₪200 + כמות כלולה + חריגה)
      </label>
      <p className="text-xs text-amber-600">
        הפעלה מחייבת קמפיינים חדשים בדמי הפעלה ₪200 — גם ב‑0 תוצאות. ניתן להפעיל
        רק כשהסכם דמי‑ההפעלה (v4) פעיל ומאושר תחת /admin/agreement. חותמי v3
        ממשיכים לפי‑תוצאה בלבד (מוגן ע״י guard ה‑D5 בחיוב).
      </p>
      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
