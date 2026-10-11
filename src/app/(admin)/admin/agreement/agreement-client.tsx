'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { HelpTip } from '@/components/help-tip';

import { saveAgreementAction, approveAgreementAction } from './actions';
import { ContractBodyEditor } from './contract-body-editor';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// The package contract. `tokens` are the placeholders the contract may use (substituted with escaped values at render);
// the server decides the list.
export function AgreementEditor({
  version,
  bodyHtml,
  status,
  tokens,
}: {
  version: string;
  bodyHtml: string | null;
  status: 'draft' | 'approved';
  tokens: readonly string[];
}) {
  const [saveState, saveAction] = useActionState(saveAgreementAction, null);
  const [approveState, approveAction] = useActionState(approveAgreementAction, null);

  const approvedVersionSuggestion = version.replace(/^draft-/, '');

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">עריכת החוזה</h2>
        <p className="text-sm text-muted-foreground">
          שמירה מחזירה את החוזה ל<strong>טיוטה</strong> ודורשת אישור מחדש. לחוזה החבילה אין נוסח ברירת מחדל בקוד:
          הנוסח כאן הוא המקור היחיד, ולקוח יקבל אותו רק לאחר שיאושר.
        </p>
        <form action={saveAction} className="space-y-3">
          <FormError message={saveState?.error} />
          <FormNotice message={saveState?.notice} />
          <div className="max-w-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <label htmlFor="version" className="text-sm font-medium">
                גרסה
              </label>
              <HelpTip text="מזהה הגרסה של נוסח החוזה. כל שמירה מחזירה את החוזה לטיוטה. אישורים שכבר ניתנו שומרים את הגרסה שאושרה ואינם משתנים." />
            </div>
            <input
              id="version"
              name="version"
              type="text"
              defaultValue={version}
              required
              dir="ltr"
              className={inputClass}
            />
            <FieldError errors={saveState?.fieldErrors?.version} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">נוסח חוזה החבילה</span>
              <HelpTip text="ניתן לשבץ תחליפים (למשל שם האירוע או מחיר החבילה) שמוחלפים אוטומטית בערכים אמיתיים בעת ההצגה והאישור. השתמשו בכפתורי התחליפים מתחת לעורך." />
            </div>
            <ContractBodyEditor name="body_html" initialHtml={bodyHtml ?? ''} tokens={tokens} />
            <FieldError errors={saveState?.fieldErrors?.body_html} />
          </div>
          <SubmitButton>שמירה</SubmitButton>
        </form>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">אישור החוזה</h2>
        {status === 'approved' ? (
          <p className="text-sm text-green-700">חוזה החבילה מאושר — זה הנוסח שיוצג ללקוחות שירכשו חבילה.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            כל עוד חוזה החבילה בטיוטה, הוא אינו מוצג לאף לקוח. האישור בודק שהנוסח כולל את מחיר החבילה והמכסה, ושאין בו
            תחליפים לא מוכרים.
          </p>
        )}
        <form action={approveAction} className="flex flex-wrap items-end gap-2">
          <FormError message={approveState?.error} />
          <FormNotice message={approveState?.notice} />
          <div className="max-w-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <label htmlFor="approve-version" className="text-sm font-medium">
                גרסת האישור
              </label>
              <HelpTip text="הגרסה שתסומן כמאושרת. מומלץ להזין גרסה ללא הקידומת draft-." />
            </div>
            <input
              id="approve-version"
              name="version"
              type="text"
              defaultValue={approvedVersionSuggestion}
              required
              dir="ltr"
              className={inputClass}
            />
            <FieldError errors={approveState?.fieldErrors?.version} />
          </div>
          <SubmitButton className="w-auto">
            {status === 'approved' ? 'עדכון אישור' : 'אישור והסרת טיוטה'}
          </SubmitButton>
        </form>
      </section>

    </div>
  );
}
