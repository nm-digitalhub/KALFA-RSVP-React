'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { updateWhatsAppConsentRequiredAction } from '@/app/(admin)/admin/channels/actions';

// The §30א consent gate for WhatsApp. Added 2026-09-08, AFTER the consolidation plan
// was written, which is how it fell outside every copy range in Task 0.3 and was
// nearly lost in the move — the plan's own readiness review caught that. It is a legal
// exposure surface, so it is extracted first and asserted by the page test.

        {/* WhatsApp CONSENT toggle — a SIBLING form, never nested (a <form>
            inside a <form> caused a "React form was unexpectedly submitted"
            error here before). Mirrors the AI-call consent toggle in the
            Voximplant panel: same shape, same wording, same red warning, so the
            two channels stay recognisably one mechanism. It lives beside the
            channel it governs rather than in /admin/settings, because it is a
            per-channel gate — the same reason its twin lives in this file. */}
export function WhatsAppConsentToggle({ consentRequired }: { consentRequired: boolean }) {
  const [waConsentState, waConsentAction] = useActionState(
    updateWhatsAppConsentRequiredAction,
    null,
  );

  return (
      <form action={waConsentAction} className="mt-4 space-y-2 rounded-lg border border-border bg-card p-4">
            <FormError message={waConsentState?.error} />
            <FormNotice message={waConsentState?.notice} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">דרישת הסכמה לוואטסאפ</p>
                <p className="text-xs text-muted-foreground">
                  כשמסומן (ברירת מחדל) — הודעות וואטסאפ יוצאות רק לאנשי קשר עם הסכמה
                  מתועדת (<code>whatsapp_consent_at</code>). ביטול הסימון מאפשר שליחה
                  גם ללא הסכמה מוקדמת. הסרת נמענים (opt-out), רשימת הנמענים הקפואה של
                  הקמפיין וכשל־סגור נשמרים בכל מקרה.
                </p>
                {consentRequired ? null : (
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                    ⚠️ דרישת ההסכמה כבויה — הודעות וואטסאפ ייצאו לאנשי קשר ללא הסכמה
                    מוקדמת. זו חשיפה משפטית תחת סעיף 30א (חוק הספאם) והחלטה משפטית,
                    לא טכנית.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="whatsapp_consent_required"
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
