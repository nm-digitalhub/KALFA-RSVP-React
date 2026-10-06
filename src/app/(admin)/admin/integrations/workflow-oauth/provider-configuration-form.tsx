'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { saveMicrosoftWorkflowOAuthProviderAction } from './actions';

export function ProviderConfigurationForm({
  clientId,
  enabled,
  hasStoredSecret,
}: {
  clientId: string | null;
  enabled: boolean;
  hasStoredSecret: boolean;
}) {
  const [state, action] = useActionState(saveMicrosoftWorkflowOAuthProviderAction, null);
  const errors = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div className="space-y-1.5">
        <Label htmlFor="clientId">Client ID</Label>
        <Input
          id="clientId"
          name="clientId"
          defaultValue={clientId ?? ''}
          autoComplete="off"
          required
          aria-invalid={Boolean(errors?.clientId?.length)}
        />
        <FieldError errors={errors?.clientId} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="clientSecret">Client Secret</Label>
        <Input
          id="clientSecret"
          name="clientSecret"
          type="password"
          defaultValue=""
          autoComplete="new-password"
          required={!hasStoredSecret}
        />
        <p className="text-xs text-muted-foreground">
          {hasStoredSecret
            ? 'סוד כבר שמור באופן מאובטח. השאירו את השדה ריק כדי לשמור את הסוד הקיים.'
            : 'בהגדרה הראשונה יש להזין את הסוד שהתקבל ב-Microsoft Entra.'}
        </p>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">הספק פעיל</span>
          <span className="block text-xs text-muted-foreground">
            כשהספק כבוי אי אפשר להתחיל חיבור OAuth חדש.
          </span>
        </span>
      </label>

      <SubmitButton className="w-auto">שמירת הגדרת Microsoft OAuth</SubmitButton>
    </form>
  );
}
