'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice } from '@/components/forms';

import {
  saveAgreementAction,
  approveAgreementAction,
  revertAgreementAction,
} from './actions';
import { HelpTip } from './help-tip';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// The tokens a custom body may use (substituted with escaped values at render).
const TOKENS = [
  'eventName',
  'pricePerReached',
  'maxContacts',
  'ceiling',
  'channels',
  'windowText',
  'vatRate',
  'version',
  'company.name',
  'company.id',
  'company.address',
  'company.contactPhone',
  'company.contactEmail',
  'company.warrantyText',
  'privacyLink',
  'termsLink',
];

function RowSubmit({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'danger';
}) {
  const { pending } = useFormStatus();
  const style =
    variant === 'danger'
      ? 'bg-red-50 text-red-700 hover:bg-red-100'
      : variant === 'primary'
        ? 'bg-primary text-primary-foreground hover:opacity-90'
        : 'border border-border hover:bg-muted';
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-60 ${style}`}
    >
      {pending ? 'רגע…' : children}
    </button>
  );
}

export function AgreementEditor({
  version,
  bodyHtml,
  status,
}: {
  version: string;
  bodyHtml: string | null;
  status: 'draft' | 'approved';
}) {
  const [saveState, saveAction] = useActionState(saveAgreementAction, null);
  const [approveState, approveAction] = useActionState(approveAgreementAction, null);
  const [revertState, revertAction] = useActionState(revertAgreementAction, null);

  const approvedVersionSuggestion = version.replace(/^draft-/, '');

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">עריכת החוזה</h2>
        <p className="text-sm text-muted-foreground">
          שמירה מחזירה את החוזה ל<strong>טיוטה</strong> ודורשת אישור מחדש. השאר/י את
          הנוסח ריק כדי להשתמש בתבנית ברירת המחדל המבוקרת.
        </p>
        <form action={saveAction} className="space-y-3">
          <FormError message={saveState?.error} />
          <FormNotice message={saveState?.notice} />
          <div className="max-w-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <label htmlFor="version" className="text-sm font-medium">
                גרסה
              </label>
              <HelpTip text="מזהה הגרסה של נוסח החוזה (למשל draft-2026-06-v2). כל שמירה מחזירה את החוזה לטיוטה. הסכמים שכבר נחתמו שומרים את הגרסה שעליה חתמו ואינם משתנים." />
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
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label htmlFor="body_html" className="text-sm font-medium">
                נוסח מותאם (HTML) — ריק = תבנית ברירת מחדל
              </label>
              <HelpTip text="נוסח HTML מלא שמחליף את תבנית ברירת המחדל המבוקרת. השאר/י ריק כדי להשתמש בתבנית שבקוד. ניתן לשבץ תחליפים כמו {{eventName}} או {{company.name}} שמוחלפים אוטומטית בערכים אמיתיים בעת ההצגה והחתימה (ראו רשימת התחליפים למטה)." />
            </div>
            <textarea
              id="body_html"
              name="body_html"
              rows={14}
              defaultValue={bodyHtml ?? ''}
              dir="ltr"
              className={`${inputClass} font-mono`}
              placeholder="<h2>1. הצדדים</h2> … (אפשר להשתמש ב-{{eventName}} וכו')"
            />
            <FieldError errors={saveState?.fieldErrors?.body_html} />
          </div>
          <p className="text-xs text-muted-foreground">
            תחליפים זמינים:{' '}
            {TOKENS.map((t) => (
              <code key={t} className="me-1 rounded bg-muted px-1">{`{{${t}}}`}</code>
            ))}
          </p>
          <RowSubmit variant="primary">שמירה</RowSubmit>
        </form>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">אישור החוזה</h2>
        {status === 'approved' ? (
          <p className="text-sm text-green-700">החוזה מאושר — תג הטיוטה אינו מוצג ללקוחות.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            אישור מסיר את תג ה<strong>טיוטה</strong> מהחוזה שמוצג ונחתם ע״י לקוחות.
            ניתן לעדכן את הגרסה לגרסה ללא קידומת <code>draft-</code>.
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
              <HelpTip text="הגרסה שתסומן כמאושרת. האישור מסיר את תג ה״טיוטה״ מהחוזה שהלקוחות רואים וחותמים עליו. מומלץ להזין גרסה ללא הקידומת draft-." />
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
          <RowSubmit variant="primary">
            {status === 'approved' ? 'עדכון אישור' : 'אישור והסרת טיוטה'}
          </RowSubmit>
        </form>
      </section>

      {bodyHtml != null ? (
        <section className={sectionClass}>
          <h2 className="text-lg font-semibold">שחזור תבנית ברירת המחדל</h2>
          <p className="text-sm text-muted-foreground">
            מבטל את הנוסח המותאם ומחזיר לתבנית המבוקרת בקוד (כטיוטה).
          </p>
          <form action={revertAction}>
            <FormError message={revertState?.error} />
            <FormNotice message={revertState?.notice} />
            <RowSubmit variant="danger">שחזור לתבנית</RowSubmit>
          </form>
        </section>
      ) : null}
    </div>
  );
}
