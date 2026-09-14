'use client';

import {
  optionIs,
  rankWith,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';
import { Plus, X } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SECRET_REFERENCE_REGEX } from '@/lib/workflow/catalogue/types';
import { HEADER_ROWS_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import { useSecretsStore } from './use-secrets-store';

// An editable list of HTTP header rows, for `action.webhook`.
//
// WHY THIS FILE EXISTS. The SDK's `UISchemaControlElement` union ships eleven
// controls and not one of them edits an arbitrary array of objects —
// `DecisionBranches` and `AiTools` are array controls, but each is bound to its
// own fixed item shape. `jsonForm.renderers` is the extension point upstream
// ships for exactly this, and `withJsonFormsControlProps` / `rankWith` /
// `optionIs` are re-exported from the SDK so a custom renderer uses the SDK's
// single JsonForms copy rather than a second one that would break the context.
//
// ⚠️ THE VALUE FIELD MAY HOLD A SECRET REFERENCE, NEVER A SECRET.
//
// `{{secrets.<NAME>}}` is what an owner types here, and what is saved. The value
// behind that name lives in the worker's environment and is substituted a few
// lines before the socket write (see outbound-webhook.ts). So this input is an
// ordinary text field on purpose — there is nothing here worth masking, and
// masking it would imply the opposite.

type HeaderRow = { name: string; value: string };

function readRows(data: unknown): HeaderRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) =>
    typeof row === 'object' && row !== null
      ? [
          {
            name: typeof (row as HeaderRow).name === 'string' ? (row as HeaderRow).name : '',
            value: typeof (row as HeaderRow).value === 'string' ? (row as HeaderRow).value : '',
          },
        ]
      : [],
  );
}

/**
 * The secret names a row references that the server does not have.
 *
 * ⚠️ THE POINT OF THIS FUNCTION. Without it a typo is discovered when a live
 * workflow fails mid-run, hours later, with a message nobody is watching for.
 * With it the owner sees it the moment they look away from the field.
 *
 * It is a CONVENIENCE and not the enforcement: the worker refuses to send an
 * unconfigured reference regardless (see secrets.ts), and it must, because this
 * list is a snapshot taken when the page loaded and a secret can be added or
 * removed in `.env.local` at any time. So an unknown name is shown as a warning,
 * never as something that blocks saving.
 */
function unknownSecretsIn(value: string, known: readonly string[]): string[] {
  // A fresh regex per call — the shared one carries `g`, and a shared global
  // regex keeps `lastIndex` between calls.
  const pattern = new RegExp(SECRET_REFERENCE_REGEX.source, 'g');
  const missing: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const name = match[1];
    if (name && !known.includes(name) && !missing.includes(name)) missing.push(name);
  }
  return missing;
}

function HeaderRowsControl({ data, path, handleChange, enabled, label }: ControlProps) {
  const rows = readRows(data);
  const secretNames = useSecretsStore((s) => s.names);
  // One id per mounted control, so two controls on one page cannot share a list.
  const listId = `kalfa-secrets-${path.replaceAll(/[^\w-]/g, '-')}`;

  // `handleChange` with the WHOLE array each time, which is what JsonForms
  // expects for an array-valued scope — there is no per-index handle here the
  // way there is for a nested Control.
  const commit = useCallback(
    (next: HeaderRow[]) => {
      // An empty array is written as `undefined` so a node with no headers does
      // not persist `headers: []` into the diagram. The saved jsonb is what the
      // owner can read in an export, and an empty array there is noise.
      handleChange(path, next.length > 0 ? next : undefined);
    },
    [handleChange, path],
  );

  const update = (index: number, patch: Partial<HeaderRow>) => {
    commit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="flex flex-col gap-2" dir="rtl">
      {label ? <span className="text-xs font-medium text-muted-foreground">{label}</span> : null}

      {/*
        The names the server has, offered as ready-made tokens. A `datalist` and
        not a dropdown, because the value is usually a token inside other text
        ("Bearer …"): a picker would have to replace the whole field, while this
        suggests and gets out of the way.

        NAMES ONLY — there is nothing here worth hiding, which is the entire
        design. If this list ever contained a value, that would be the bug.
      */}
      <datalist id={listId}>
        {secretNames.map((name) => (
          <option key={name} value={`{{secrets.${name}}}`} />
        ))}
      </datalist>

      {rows.map((row, index) => {
        const unknown = unknownSecretsIn(row.value, secretNames);
        return (
          // Keyed by INDEX, which is normally the wrong choice and is right here:
          // a header row has no stable id, and the alternative — keying by name —
          // would remount the input on every keystroke in the name field and lose
          // focus after each character.
          <div key={index} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`שם הכותרת ${index + 1}`}
                value={row.name}
                disabled={enabled === false}
                placeholder="Authorization"
                onChange={(e) => update(index, { name: e.target.value })}
                className="basis-2/5"
              />
              <Input
                aria-label={`ערך הכותרת ${index + 1}`}
                value={row.value}
                disabled={enabled === false}
                placeholder="Bearer {{secrets.ACME_API_KEY}}"
                onChange={(e) => update(index, { value: e.target.value })}
                className="basis-3/5"
                list={secretNames.length > 0 ? listId : undefined}
                // Never `type="password"`: the value is a reference, not a
                // secret. A masked field here would teach the owner to paste the
                // real key.
                spellCheck={false}
                autoComplete="off"
                aria-invalid={unknown.length > 0 || undefined}
                aria-describedby={unknown.length > 0 ? `${listId}-${index}-warn` : undefined}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`הסרת הכותרת ${index + 1}`}
                disabled={enabled === false}
                onClick={() => commit(rows.filter((_, i) => i !== index))}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>
            {unknown.length > 0 ? (
              // A WARNING, never a block. This list is a snapshot from page load
              // and a secret can be added to the server at any moment — so the
              // owner is told, and the worker stays the thing that actually
              // refuses.
              <p id={`${listId}-${index}-warn`} className="text-xs text-amber-600 dark:text-amber-500">
                {unknown.length === 1
                  ? `הסוד "${unknown[0]}" אינו מוגדר בשרת — הקריאה תיכשל עד שיוגדר.`
                  : `הסודות ${unknown.map((n) => `"${n}"`).join(', ')} אינם מוגדרים בשרת.`}
              </p>
            ) : null}
          </div>
        );
      })}

      {secretNames.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          סודות זמינים: {secretNames.join(' · ')}
        </p>
      ) : (
        // The empty state has to teach, not just say "none". Adding a secret is
        // an env edit plus a worker restart, and an owner who does not know that
        // will type the key straight into the field — the one thing this whole
        // design exists to prevent.
        <p className="text-xs text-muted-foreground">
          לא הוגדרו סודות. להוספה: שורה <code>KALFA_WORKFLOW_SECRET_SHEM=...</code> בקובץ{' '}
          <code>.env.local</code>, ואז הפעלה מחדש של ה-worker. אל תקלידו מפתח כאן.
        </p>
      )}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={enabled === false}
        onClick={() => commit([...rows, { name: '', value: '' }])}
        className="self-start"
      >
        <Plus aria-hidden="true" className="size-4" />
        הוספת כותרת
      </Button>
    </div>
  );
}

/**
 * The registry entry, for `<WorkflowBuilder.Root jsonForm={{ renderers: [...] }}>`.
 *
 * Rank 5000 is comfortably above every built-in (the SDK's own controls register
 * in the low thousands), which is what `rankWith`'s documentation prescribes for
 * overriding one. The tester matches `options.format` rather than the scope, so
 * the binding is declared at the call site instead of inferred from a field name.
 */
export const headerRowsRenderer: JsonFormsRendererExtension = {
  tester: rankWith(5000, optionIs('format', HEADER_ROWS_FORMAT)),
  renderer: withJsonFormsControlProps(HeaderRowsControl),
};
