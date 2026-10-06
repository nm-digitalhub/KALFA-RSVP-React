'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { FieldError, FormError, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// Approving the fixed-price package terms: two boxes, one button. No drawn signature and no phone code — the server
// records who approved, when, from where and which version (recordPackageApproval). `terms_version` is the version of
// the terms the page SHOWED; the server compares it with the active document, so terms that changed between reading
// and clicking are never approved unseen. useActionState surfaces the server's safe Hebrew error inline; on success the
// action redirects back to the setup flow.
export function ApprovePackageTermsForm({
  action,
  termsVersion,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  termsVersion: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="terms_version" value={termsVersion} />
      <FieldError errors={state?.fieldErrors?.tos_version} />

      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms_accepted" className="mt-1" />
          <span>
            קראתי ואני מאשר/ת את תנאי החבילה ואת{' '}
            <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
              תנאי השירות
            </Link>
            , לרבות התשלום החד‑פעמי.
          </span>
        </label>
        <FieldError errors={state?.fieldErrors?.terms_accepted} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="privacy_accepted" className="mt-1" />
          <span>
            אני מאשר/ת את{' '}
            <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">
              מדיניות הפרטיות
            </Link>
            .
          </span>
        </label>
        <FieldError errors={state?.fieldErrors?.privacy_accepted} />
      </fieldset>

      <FormError message={state?.error} />
      <SubmitButton>אישור והמשך לתשלום</SubmitButton>
    </form>
  );
}
