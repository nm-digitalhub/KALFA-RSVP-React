'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import type { CookieConsentAdminView } from '@/lib/data/admin/cookie-consent';
import {
  updateCookieConsentEnabledAction,
  updateCookieConsentAnalyticsEnabledAction,
  updateCookieConsentMarketingEnabledAction,
  bumpCookieConsentRevisionAction,
} from './actions';

type ToggleAction = typeof updateCookieConsentEnabledAction;

function ToggleForm({
  action,
  name,
  defaultChecked,
  label,
}: {
  action: ToggleAction;
  name: string;
  defaultChecked: boolean;
  label: string;
}) {
  const [state, formAction] = useActionState(action, {});
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
      <FormNotice message={state?.notice} />
      <FormError message={state?.error} />
    </form>
  );
}

export function CookieConsentClient({ view }: { view: CookieConsentAdminView }) {
  const [bumpState, bumpAction] = useActionState(bumpCookieConsentRevisionAction, {});

  return (
    <div className="space-y-6">
      <ToggleForm
        action={updateCookieConsentEnabledAction}
        name="cookie_consent_enabled"
        defaultChecked={view.enabled}
        label="מנגנון ההסכמה מופעל"
      />
      <ToggleForm
        action={updateCookieConsentAnalyticsEnabledAction}
        name="cookie_consent_analytics_enabled"
        defaultChecked={view.analyticsEnabled}
        label="קטגוריית אנליטיקה מוצעת"
      />
      <ToggleForm
        action={updateCookieConsentMarketingEnabledAction}
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
        <FormNotice message={bumpState?.notice} />
        <FormError message={bumpState?.error} />
      </div>
    </div>
  );
}
