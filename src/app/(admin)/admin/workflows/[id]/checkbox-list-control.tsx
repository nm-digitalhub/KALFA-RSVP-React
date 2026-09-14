'use client';

import {
  FormControlWithLabel,
  optionIs,
  rankWith,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';

import { Checkbox } from '@/components/ui/checkbox';
import { CHECKBOX_LIST_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

// A multi-select stored as an ARRAY OF STRINGS.
//
// WHY IT IS CUSTOM. The SDK's `UISchemaControlElement` union ships eleven
// controls, and its only multi-value ones (`DecisionBranches`, `AiTools`) are
// each bound to a fixed item shape. There is no "pick several from a list", so
// this is the second renderer registered through `jsonForm` — the same extension
// point, the same `optionIs('format', …)` binding, as header-rows-control.
//
// ⚠️ THE STORED SHAPE IS AN OPEN LIST, NOT AN ENUM, and that is the point.
// The choices below come from the uischema's `options.choices`, but what lands
// in the diagram is whatever strings were ticked. A value the editor no longer
// offers still round-trips, and a new one needs a catalogue entry rather than a
// migration of every saved workflow.
//
// ABSENT IS NOT THE SAME AS EMPTY, and the caller decides what absent means —
// for the WhatsApp trigger, absent means `DEFAULT_WHATSAPP_MESSAGE_KINDS`, which
// is how every diagram saved before the field keeps its behaviour. So unticking
// the last box writes `undefined`, never `[]`: an empty array would read as "the
// owner chose nothing" and a trigger that matches nothing is a dead workflow
// that looks armed.

type Choice = { value: string; label: string };

function readChoices(options: unknown): Choice[] {
  const raw = (options as { choices?: unknown })?.choices;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) =>
    typeof c === 'object' && c !== null && typeof (c as Choice).value === 'string'
      ? [{ value: (c as Choice).value, label: String((c as Choice).label ?? (c as Choice).value) }]
      : [],
  );
}

/**
 * The ticked values, from EITHER stored shape.
 *
 * `{ value }` objects are what this control writes — the SDK's `ArrayFieldSchema`
 * can only describe arrays of objects, and storing bare strings under an
 * object-typed schema put a validation error on every node that used it.
 *
 * Bare strings are read too, because diagrams saved by the first version are in
 * the database and must keep showing their ticks. `matchesKind` on the worker
 * side accepts both for the same reason.
 */
function readSelected(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((v) =>
    typeof v === 'string'
      ? [v]
      : v !== null && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'string'
        ? [(v as { value: string }).value]
        : [],
  );
}

function CheckboxListControl({
  data,
  path,
  handleChange,
  enabled,
  label,
  required,
  uischema,
}: ControlProps) {
  const choices = readChoices(uischema?.options);
  const selected = readSelected(data);
  // The placeholder the owner sees while the field is untouched. Supplied by the
  // caller because only it knows what "absent" resolves to.
  const defaultNote = (uischema?.options as { defaultNote?: string })?.defaultNote;

  const toggle = (value: string, checked: boolean) => {
    const next = checked ? [...selected, value] : selected.filter((v) => v !== value);
    // Written as `{ value }` objects — the shape the schema declares. Reading
    // tolerates bare strings; writing always produces the declared one, so a
    // node saved once stops carrying the validation error.
    handleChange(path, next.length > 0 ? next.map((v) => ({ value: v })) : undefined);
  };

  return (
    // ⚠️ THE SDK'S WRAPPER, not a hand-rolled <span>. This used to render the
    // label itself, which looked close enough and was not: `FormControlWithLabel`
    // also draws the `*` for a required field and owns the label/control spacing
    // every built-in control uses. A custom renderer that approximates it drifts
    // the moment the editor's form styling changes, and silently omits the
    // required marker — the one part of a label an owner acts on.
    <FormControlWithLabel label={label} required={required}>
      <div className="flex flex-col gap-2" dir="rtl">

      <div className="flex flex-col gap-1.5">
        {choices.map((choice) => {
          const id = `${path}-${choice.value}`;
          return (
            <label key={choice.value} htmlFor={id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={id}
                checked={selected.includes(choice.value)}
                disabled={enabled === false}
                onCheckedChange={(checked) => toggle(choice.value, checked === true)}
              />
              {choice.label}
            </label>
          );
        })}
      </div>

      {selected.length === 0 && defaultNote ? (
        <p className="text-xs text-muted-foreground">{defaultNote}</p>
      ) : null}
      </div>
    </FormControlWithLabel>
  );
}

export const checkboxListRenderer: JsonFormsRendererExtension = {
  // Above every built-in, the same rank and for the same documented reason as
  // the header-rows renderer.
  tester: rankWith(5000, optionIs('format', CHECKBOX_LIST_FORMAT)),
  renderer: withJsonFormsControlProps(CheckboxListControl),
};
