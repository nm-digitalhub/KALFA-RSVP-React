'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { actionErrorMessage } from '@/lib/action-result';
import type { CookieConsentAdminView } from '@/lib/data/admin/cookie-consent';
import {
  updateCookieConsentEnabledAction,
  updateCookieConsentAnalyticsEnabledAction,
  updateCookieConsentMarketingEnabledAction,
  bumpCookieConsentRevisionAction,
} from './actions';

// Each toggle's action reads its own checkbox, so the three result types differ; the hooks live in the parent and
// each form receives its own state and dispatcher.
type ToggleResult =
  | Awaited<ReturnType<typeof updateCookieConsentEnabledAction>>
  | Awaited<ReturnType<typeof updateCookieConsentAnalyticsEnabledAction>>
  | Awaited<ReturnType<typeof updateCookieConsentMarketingEnabledAction>>;

function ToggleForm({
  state,
  formAction,
  name,
  defaultChecked,
  label,
}: {
  state: ToggleResult;
  formAction: (formData: FormData) => void;
  name: string;
  defaultChecked: boolean;
  label: string;
}) {
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          className="size-4 accent-primary"
        />
        {label}
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton className="w-auto">עדכון</SubmitButton>
      </div>
      <FormNotice message={state.data?.notice} />
      <FormError message={actionErrorMessage(state)} />
    </form>
  );
}

export function CookieConsentClient({ view }: { view: CookieConsentAdminView }) {
  const [enabledState, enabledAction] = useActionState(updateCookieConsentEnabledAction, {});
  const [analyticsState, analyticsAction] = useActionState(updateCookieConsentAnalyticsEnabledAction, {});
  const [marketingState, marketingAction] = useActionState(updateCookieConsentMarketingEnabledAction, {});
  const [bumpState, bumpAction] = useActionState(bumpCookieConsentRevisionAction, {});

  return (
    <div className="space-y-6">
      <ToggleForm
        state={enabledState}
        formAction={enabledAction}
        name="cookie_consent_enabled"
        defaultChecked={view.enabled}
        label="מנגנון ההסכמה מופעל"
      />
      <ToggleForm
        state={analyticsState}
        formAction={analyticsAction}
        name="cookie_consent_analytics_enabled"
        defaultChecked={view.analyticsEnabled}
        label="קטגוריית אנליטיקה מוצעת"
      />
      <ToggleForm
        state={marketingState}
        formAction={marketingAction}
        name="cookie_consent_marketing_enabled"
        defaultChecked={view.marketingEnabled}
        label="קטגוריית שיווק/רימרקטינג מוצעת"
      />

      <div className="rounded-md border border-border p-4 text-sm">
        <p className="text-muted-foreground">
          Revision נוכחי בפועל:{' '}
          <span className="font-mono">{view.effectiveRevision}</span> (בסיס קוד +{' '}
          {view.revisionBump} עדכוני אדמין). הכפתור למטה מכריז revision חדש בלי
          לשנות אף מתג — כל המשתמשים יתבקשו להסכים מחדש בטעינה הבאה.
        </p>
        <form action={bumpAction} className="mt-3 flex items-center gap-2">
          <SubmitButton className="w-auto">הכרזת גרסה חדשה (בקש הסכמה מחדש)</SubmitButton>
        </form>
        <FormNotice message={bumpState.data?.notice} />
        <FormError message={actionErrorMessage(bumpState)} />
      </div>
    </div>
  );
}
