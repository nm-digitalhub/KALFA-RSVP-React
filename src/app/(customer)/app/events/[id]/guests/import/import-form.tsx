'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError } from '@/components/forms';
import { actionErrorMessage } from '@/lib/action-result';
import { CSV_MAX_BYTES } from '@/lib/constants';
import type { importGuestsAction } from './import-actions';

type ImportResult = Awaited<ReturnType<typeof importGuestsAction>>;

type ImportAction = (
  prevState: ImportResult,
  formData: FormData,
) => Promise<ImportResult>;

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'מייבא…' : 'ייבוא'}
    </button>
  );
}

export function ImportForm({ action }: { action: ImportAction }) {
  const [state, formAction] = useActionState(action, {});
  const [fileError, setFileError] = useState<string | null>(null);
  // A finished import (the file was read; some rows may have failed).
  const result = state.data;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <FormError message={actionErrorMessage(state)} />

        <div>
          <label htmlFor="file" className="mb-1 block text-sm font-medium">
            קובץ CSV
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm"
            onChange={(e) => {
              // Same pre-check rationale as the invite image: above the Server
              // Action body limit the framework rejects BEFORE the action, so
              // the server's friendly size error would never render.
              const f = e.target.files?.[0];
              if (f && f.size > CSV_MAX_BYTES) {
                setFileError(
                  `הקובץ גדול מדי (מעל ${Math.floor(CSV_MAX_BYTES / 1000)}KB). פצלו את הקובץ.`,
                );
                e.target.value = '';
              } else {
                setFileError(null);
              }
            }}
          />
          <FieldError errors={fileError ? [fileError] : undefined} />
        </div>

        <div>
          <label
            htmlFor="default_expected_count"
            className="mb-1 block text-sm font-medium"
          >
            כמות מוזמנים ברירת מחדל <span className="font-normal text-muted-foreground">(אופציונלי)</span>
          </label>
          <input
            id="default_expected_count"
            name="default_expected_count"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="למשל 2"
            className="w-32 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            חל רק על שורות שבהן העמודה ריקה או שאינה קיימת בקובץ. בלי ערך כאן,
            מוזמן ללא כמות יוכל לאשר הגעה לכל מספר, ולא נדע לסמן חריגה מהכמות
            שהוזמנה.
          </p>
        </div>

        <UploadButton />
      </form>

      {result?.done ? (
        <div className="space-y-3">
          <p
            role="status"
            className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            {result.imported > 0
              ? `יובאו ${result.imported} מוזמנים בהצלחה.`
              : 'לא יובאו מוזמנים.'}
          </p>

          {result.failed.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="mb-2 font-medium">
                {result.failed.length} שורות לא יובאו:
              </p>
              <ul className="space-y-1">
                {result.failed.map((f) => (
                  <li key={f.row}>
                    שורה {f.row}: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Link
            href="../"
            className="inline-block text-sm text-muted-foreground hover:underline"
          >
            חזרה לרשימת המוזמנים
          </Link>
        </div>
      ) : null}
    </div>
  );
}
