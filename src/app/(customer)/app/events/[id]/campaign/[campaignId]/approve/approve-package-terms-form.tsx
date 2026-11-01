'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { FieldError, FormError, SubmitButton } from '@/components/forms';
import { actionFormError } from '@/lib/action-result';

import type { approvePackageTermsAction } from '../../campaign-actions';

type ApprovePackageTermsResult = Awaited<ReturnType<typeof approvePackageTermsAction>>;

// Approving the fixed-price package terms: two boxes, one button. No drawn signature and no phone code — the server
// records who approved, when, from where and which version (recordPackageApproval). `terms_version` is the version of
// the terms the page SHOWED; the server compares it with the active document, so terms that changed between reading
// and clicking are never approved unseen. useActionState surfaces the server's safe Hebrew error inline; on success the
// action redirects straight to the payment page.
export function ApprovePackageTermsForm({
  action,
  termsVersion,
}: {
  action: (prev: ApprovePackageTermsResult, formData: FormData) => Promise<ApprovePackageTermsResult>;
  termsVersion: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const fieldErrors = state.validationErrors?.fieldErrors;
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="terms_version" value={termsVersion} />
      <FieldError errors={fieldErrors?.tos_version} />

      <fieldset className="space-y-2 border-t border-border pt-4">
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
        <FieldError errors={fieldErrors?.terms_accepted} />
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
        <FieldError errors={fieldErrors?.privacy_accepted} />
      </fieldset>

      <FormError message={actionFormError(state)} />
      <SubmitButton>אישור והמשך לתשלום</SubmitButton>
    </form>
  );
}
