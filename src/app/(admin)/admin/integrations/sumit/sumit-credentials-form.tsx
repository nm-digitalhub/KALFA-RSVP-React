'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { EditableField } from '@/app/(admin)/admin/_form-fields';

import { updateSumitCredentialsAction } from './actions';

// The last of the three restorations: Task 0.2 built this DAL pair and removed the
// settings tab that held the fields, leaving the SUMIT credentials un-editable from the
// panel. ExtrA and the mail transport were the other two.

export type SumitCredentialsValues = {
  sumit_company_id: string;
  sumit_api_public_key: string;
  sumit_api_key: string;
};

export function SumitCredentialsForm({ values }: { values: SumitCredentialsValues }) {
  const [state, action] = useActionState(updateSumitCredentialsAction, null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <EditableField
        name="sumit_company_id"
        label="מזהה חברה (CompanyID)"
        defaultValue={values.sumit_company_id}
        inputMode="numeric"
        placeholder="123456"
        hint="מספר בלבד. SUMIT דוחה ערך לא מספרי כ״פרטים שגויים״, ולכן הוא נבדק כאן לפני שהוא נשלח."
        errors={e?.sumit_company_id}
      />

      <EditableField
        name="sumit_api_key"
        label="מפתח API (סודי)"
        defaultValue={values.sumit_api_key}
        maskable
        hint="נשמר בשרת בלבד ולעולם אינו נרשם ללוג. יחד עם מזהה החברה — זהו צמד ההרשאה לכל פעולת סליקה."
        errors={e?.sumit_api_key}
      />

      <EditableField
        name="sumit_api_public_key"
        label="מפתח ציבורי (אופציונלי)"
        defaultValue={values.sumit_api_public_key}
        hint="משמש רק לטפסי סליקה בדפדפן. חשבון סליקה עובד בלעדיו, ולכן הוא אינו נספר כ״מוגדר״."
        errors={e?.sumit_api_public_key}
      />

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
