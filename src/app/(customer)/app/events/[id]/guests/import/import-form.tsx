'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError } from '@/components/forms';
import { CSV_MAX_BYTES } from '@/lib/constants';
import type { ImportState } from './import-actions';

type ImportAction = (
  prevState: ImportState,
  formData: FormData,
) => Promise<ImportState>;

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
  const [state, formAction] = useActionState<ImportState, FormData>(
    action,
    null,
  );
  const [fileError, setFileError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <FormError message={state?.error} />

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

        <UploadButton />
      </form>

      {state?.done ? (
        <div className="space-y-3">
          <p
            role="status"
            className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            {state.imported && state.imported > 0
              ? `יובאו ${state.imported} מוזמנים בהצלחה.`
              : 'לא יובאו מוזמנים.'}
          </p>

          {state.failed && state.failed.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="mb-2 font-medium">
                {state.failed.length} שורות לא יובאו:
              </p>
              <ul className="space-y-1">
                {state.failed.map((f) => (
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
