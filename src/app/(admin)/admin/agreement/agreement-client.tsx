'use client';

import { useActionState, useState, useTransition } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/help-tip';
import type { AgreementModel } from '@/lib/agreements/template';

import {
  saveAgreementAction,
  approveAgreementAction,
  revertAgreementAction,
  loadAgreementStarterAction,
} from './actions';
import { ContractBodyEditor } from './contract-body-editor';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// One contract per pricing model. `tokens` are the placeholders this model's contract may use (substituted with
// escaped values at render); the server decides the list.
export function AgreementEditor({
  model,
  version,
  bodyHtml,
  status,
  tokens,
}: {
  model: AgreementModel;
  version: string;
  bodyHtml: string | null;
  status: 'draft' | 'approved';
  tokens: readonly string[];
}) {
  const [saveState, saveAction] = useActionState(saveAgreementAction, null);
  const [approveState, approveAction] = useActionState(approveAgreementAction, null);
  const [revertState, revertAction] = useActionState(revertAgreementAction, null);

  // "Load the current text": the live default, as an editable template. Remounting the editor (new key) hands it the
  // loaded body as its starting content.
  const [loaded, setLoaded] = useState<{ key: number; html: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const isPackage = model === 'package';
  const approvedVersionSuggestion = version.replace(/^draft-/, '');
  const initialHtml = loaded?.html ?? bodyHtml ?? '';

  function loadCurrentText() {
    startLoading(async () => {
      const result = await loadAgreementStarterAction();
      if ('error' in result) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setLoaded({ key: (loaded?.key ?? 0) + 1, html: result.body });
    });
  }

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">עריכת החוזה</h2>
        <p className="text-sm text-muted-foreground">
          שמירה מחזירה את החוזה ל<strong>טיוטה</strong> ודורשת אישור מחדש.{' '}
          {isPackage
            ? 'לחוזה החבילה אין נוסח ברירת מחדל בקוד: הנוסח כאן הוא המקור היחיד, ולקוח יקבל אותו רק לאחר שיאושר.'
            : 'השאר/י את הנוסח ריק כדי להשתמש בתבנית ברירת המחדל המבוקרת.'}
        </p>
        <form action={saveAction} className="space-y-3">
          <input type="hidden" name="model" value={model} />
          <FormError message={saveState?.error} />
          <FormNotice message={saveState?.notice} />
          <div className="max-w-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <label htmlFor="version" className="text-sm font-medium">
                גרסה
              </label>
              <HelpTip text="מזהה הגרסה של נוסח החוזה. כל שמירה מחזירה את החוזה לטיוטה. הסכמים שכבר נחתמו שומרים את הגרסה שעליה חתמו ואינם משתנים." />
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">
                  {isPackage ? 'נוסח חוזה החבילה' : 'נוסח מותאם — ריק = תבנית ברירת מחדל'}
                </span>
                <HelpTip text="ניתן לשבץ תחליפים (למשל שם האירוע או מחיר החבילה) שמוחלפים אוטומטית בערכים אמיתיים בעת ההצגה והאישור. השתמשו בכפתורי התחליפים מתחת לעורך." />
              </div>
              {!isPackage && bodyHtml == null ? (
                <Button type="button" variant="outline" size="sm" onClick={loadCurrentText} disabled={loading}>
                  {loading ? 'טוען…' : 'טעינת הנוסח הנוכחי לעריכה'}
                </Button>
              ) : null}
            </div>
            {loadError ? (
              <p role="alert" className="text-sm text-destructive">
                {loadError}
              </p>
            ) : null}
            <ContractBodyEditor
              key={loaded?.key ?? 0}
              name="body_html"
              initialHtml={initialHtml}
              tokens={tokens}
              model={model}
            />
            <FieldError errors={saveState?.fieldErrors?.body_html} />
          </div>
          <SubmitButton>שמירה</SubmitButton>
        </form>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">אישור החוזה</h2>
        {status === 'approved' ? (
          <p className="text-sm text-green-700">
            {isPackage
              ? 'חוזה החבילה מאושר — זה הנוסח שיוצג ללקוחות שירכשו חבילה.'
              : 'החוזה מאושר — תג הטיוטה אינו מוצג ללקוחות.'}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isPackage ? (
              <>
                כל עוד חוזה החבילה בטיוטה, הוא אינו מוצג לאף לקוח. האישור בודק שהנוסח כולל את מחיר החבילה והמכסה, שאין בו
                תחליפים לא מוכרים, ושאין בו נתוני חיוב לפי תוצאה.
              </>
            ) : (
              <>
                אישור מסיר את תג ה<strong>טיוטה</strong> מהחוזה שמוצג ונחתם ע״י לקוחות. ניתן לעדכן את הגרסה לגרסה ללא
                קידומת <code>draft-</code>.
              </>
            )}
          </p>
        )}
        <form action={approveAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="model" value={model} />
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

      {!isPackage && bodyHtml != null ? (
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold">שחזור תבנית ברירת המחדל</h2>
          <p className="text-sm text-muted-foreground">
            מבטל את הנוסח המותאם ומחזיר לתבנית המבוקרת בקוד (כטיוטה).
          </p>
          <form action={revertAction}>
            <FormError message={revertState?.error} />
            <FormNotice message={revertState?.notice} />
            <SubmitButton className="bg-destructive/10 text-destructive hover:bg-destructive/20">
              שחזור לתבנית
            </SubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}
