'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { EditableField } from '@/app/(admin)/admin/_form-fields';

import { updateEmailTransportAction } from './actions';

// Credentials for outgoing mail — a restoration, like the ExtrA form beside it: Task
// 0.2 built the DAL pair and removed the "הודעות" tab, and nothing replaced the UI, so
// these fields have not been editable from the panel since.
//
// ⚠️ THE SMTP FIELDS ARE SHOWN EVEN WHILE RESEND IS THE ACTIVE TRANSPORT, and that is
// the point of keeping them: EMAIL_PROVIDER is an env switch precisely so a rollback
// needs no deploy and no working database (see sender.ts). A rollback to a transport
// whose credentials silently rotted is not a rollback. The page says which one is live
// so nobody edits the idle half by accident.
//
// `smtp_from` is NOT an SMTP-only field despite the name — it is the From address both
// transports send as, which is why it sits above the SMTP block rather than inside it.

export type EmailTransportFormValues = {
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
};

export function EmailTransportForm({
  values,
  activeProvider,
}: {
  values: EmailTransportFormValues;
  activeProvider: 'resend' | 'smtp';
}) {
  const [state, action] = useActionState(updateEmailTransportAction, null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="email_enabled"
          defaultChecked={values.email_enabled}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">שליחת דואר מופעלת</span>
          <span className="block text-xs text-muted-foreground">
            גם ההסכם החתום וגם החשבוניות נשלחים בדואר. כשכבוי — שניהם אינם יוצאים,
            בשני הטרנספורטים.
          </span>
        </span>
      </label>

      <EditableField
        name="smtp_from"
        label="כתובת השולח (From)"
        defaultValue={values.smtp_from}
        placeholder="KALFA <noreply@kalfa.me>"
        hint="השדה היחיד ששני הטרנספורטים צריכים. ממנו נגזר גם הדומיין שבדיקת הבריאות מאמתת מול Resend."
        errors={e?.smtp_from}
      />

      <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            שרת SMTP{' '}
            {activeProvider === 'resend' ? (
              <span className="font-normal text-muted-foreground">— מסלול הגיבוי, אינו פעיל כעת</span>
            ) : (
              <span className="font-normal text-emerald-700 dark:text-emerald-400">— פעיל</span>
            )}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            נשמר גם כשהוא אינו פעיל: החלפת הטרנספורט היא שינוי של משתנה סביבה, בלי
            פריסה ובלי תלות במסד — ולכן פרטים שהתיישנו כאן הופכים את הנפילה-אחורה
            לבלתי-אפשרית בדיוק כשצריך אותה.
          </p>
        </div>

        <EditableField
          name="smtp_host"
          label="שרת (Host)"
          defaultValue={values.smtp_host}
          placeholder="smtp.example.com"
          errors={e?.smtp_host}
        />
        <EditableField
          name="smtp_port"
          label="פורט"
          defaultValue={values.smtp_port}
          inputMode="numeric"
          placeholder="587"
          hint="465 עם SSL, או 587 עם STARTTLS."
          errors={e?.smtp_port}
        />
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="smtp_secure"
            defaultChecked={values.smtp_secure}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            <span className="block text-sm font-medium">SSL ישיר (פורט 465)</span>
            <span className="block text-xs text-muted-foreground">
              כבוי = STARTTLS על 587. אין כאן אפשרות לשלוח ללא הצפנה.
            </span>
          </span>
        </label>
        <EditableField
          name="smtp_user"
          label="שם משתמש"
          defaultValue={values.smtp_user}
          errors={e?.smtp_user}
        />
        <EditableField
          name="smtp_password"
          label="סיסמה"
          defaultValue={values.smtp_password}
          maskable
          errors={e?.smtp_password}
        />
      </div>

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
