'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { updateCallConsentRequiredAction } from '@/app/(admin)/admin/channels/actions';

// The §30א consent gate for AI CALLS — the exact twin of WhatsAppConsentToggle in
// ../meta-whatsapp/, deliberately mirrored so the two outreach channels cannot drift in
// wording, shape, or audit trail. Named for what it is rather than folded into a
// "danger zone" grab-bag, which is what keeps the twinning visible in the file list.
//
// The checkbox REQUIRES explicit prior consent and defaults ON (safe). Turning it OFF
// permits AI dialing to contacts with no recorded consent — a legal decision, not a
// technical one, which is why it is surfaced in red and alerts Slack on every flip.
// opt-out, the DNC list and fail-closed reads still apply regardless.
//
// It is a SIBLING form, never nested inside another — see the note in
// voximplant-personas.tsx for the bug that rule prevents.

export function VoximplantConsentToggle({ consentRequired }: { consentRequired: boolean }) {
  const [state, action] = useActionState(updateCallConsentRequiredAction, null);

  return (
    <form
      action={action}
      className="mt-4 space-y-2 rounded-lg border border-red-500/50 bg-red-500/5 p-4"
    >
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">דרישת הסכמה לשיחות AI</p>
          <p className="text-xs text-muted-foreground">
            כשמסומן (ברירת מחדל) — שיחות AI יוצאות רק לאנשי קשר עם הסכמה מתועדת
            (<code>call_consent_at</code>). ביטול הסימון מאפשר חיוג גם ללא הסכמה
            מוקדמת. הסרת נמענים (opt-out), רשימת DNL וכשל־סגור נשמרים בכל מקרה.
          </p>
          {consentRequired ? null : (
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">
              ⚠️ דרישת ההסכמה כבויה — שיחות AI ייצאו לאנשי קשר ללא הסכמה מוקדמת.
              זו חשיפה משפטית תחת סעיף 30א (חוק הספאם) והחלטה משפטית, לא טכנית.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="call_consent_required"
              defaultChecked={consentRequired}
              className="size-4 accent-primary"
            />
            דרוש הסכמה
          </label>
          <SubmitButton className="w-auto">עדכון</SubmitButton>
        </div>
      </div>
    </form>
  );
}
