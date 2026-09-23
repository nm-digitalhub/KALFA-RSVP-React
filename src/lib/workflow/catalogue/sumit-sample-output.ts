import { flatten } from 'flat';

import { SUMIT_HOLDS_FOLDER_ID } from '@/lib/sumit/hold-status';

import {
  SUMIT_CARD_BASE_OUTPUT,
  SUMIT_HOLD_FIELDS_OUTPUT,
  type SumitCardOutput,
  type SumitCardOutputField,
} from './sumit-card-output';

// The SUMIT trigger's picker fields, derived from a REAL call instead of a list
// typed by hand.
//
// WHY A SAMPLE AND NOT A SCHEMA. A SUMIT trigger sends the columns of the VIEW
// the owner chose in SUMIT, so which fields exist is a fact about that trigger,
// not about the node type. The last call this workflow received is the only
// place that fact is recorded on our side — so the editor page reads it
// (server-side, see `getSumitCardSampleOutput`) and this turns it into picker
// entries. `flatten` (npm `flat`) produces exactly the paths the picker inserts
// and `resolveTemplate` walks: `properties.Billing_Customer.0.Name`.
//
// ⚠️ KEYS AND TYPES LEAVE THE SERVER — NEVER VALUES. The payload carries a
// customer's name and card digits; only the SHAPE is needed to offer a field,
// so every value is reduced to a type here and dropped.
//
// ⚠️ THE PAYLOAD IS UNSIGNED, so its keys are hostile input too:
//   • flattened UNDER a `properties` prefix, so no key can ever be the bare
//     `__proto__` that `flat`'s `output[newKey] = value` (index.js:41) would
//     turn into a prototype write — and the three prototype-chain names are
//     refused as path segments anyway;
//   • only paths `resolveTemplate`'s grammar accepts (`[\w.-]`) are offered —
//     anything else would be a reference that can never resolve;
//   • capped in count and length, so a crafted body cannot flood the picker.

/** The bookkeeping every SUMIT reference object carries, which nobody picks. */
const REFERENCE_INTERNALS = new Set(['Version', 'Status', 'SchemaID']);
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_PATH = /^[\w.-]+$/;
const MAX_FIELDS = 80;
const MAX_PATH_LENGTH = 120;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const SAMPLED_NOTE = 'נמצא בקריאה האחרונה מ-SUMIT לתהליך הזה — ייתכן שלא יישלח בכל קריאה';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): SumitCardOutputField['type'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return ISO_DATETIME.test(value) ? 'datetime' : 'string';
  if (Array.isArray(value)) return 'array';
  if (isPlainObject(value)) return 'object';
  // null: no evidence of a type; text is what the editor assumes anyway.
  return 'string';
}

/**
 * Picker entries for one stored SUMIT call body, or `null` when the body is not
 * a SUMIT card (`{ Properties: {…} }` with at least one usable field) — the
 * caller then keeps the fixed list.
 *
 * For the frame-holds folder the MEASURED list stays the base: a field the
 * latest release happened not to carry (`Billing_PaymentDocument` is empty on
 * most) still exists in that folder's schema, and its entry carries the
 * measured label, type and `?` advice. Any other folder gets exactly what was
 * seen.
 */
export function sumitCardOutputFromSample(body: unknown): SumitCardOutput | null {
  if (!isPlainObject(body) || !isPlainObject(body.Properties)) return null;

  const flat = flatten<Record<string, unknown>, Record<string, unknown>>({ properties: body.Properties });
  // The measured labels ("(תפיסות מסגרת)", the `?` advice) describe THAT folder;
  // another folder's `Billing_Amount` is not known to mean the same, so it is
  // described only by what was seen.
  const isHolds = Number(body.Folder) === SUMIT_HOLDS_FOLDER_ID;
  const known: Record<string, SumitCardOutputField> = isHolds
    ? (SUMIT_HOLD_FIELDS_OUTPUT as Record<string, SumitCardOutputField>)
    : {};

  const sampled: SumitCardOutput = {};
  let count = 0;
  for (const [path, value] of Object.entries(flat)) {
    if (count >= MAX_FIELDS) break;
    if (path.length > MAX_PATH_LENGTH || !SAFE_PATH.test(path)) continue;
    const segments = path.split('.');
    // `flat` keeps an EMPTY object or array as one leaf (index.js:36), so an
    // empty `Properties` flattens to the bare `properties` — already a base field.
    if (segments.length < 2) continue;
    if (segments.some((s) => FORBIDDEN_SEGMENTS.has(s))) continue;
    const parent = segments.at(-2);
    if (parent !== undefined && /^\d+$/.test(parent) && REFERENCE_INTERNALS.has(segments.at(-1)!)) continue;

    sampled[path] = known[path] ?? {
      type: typeOf(value),
      label: segments.slice(1).join('.'),
      description: SAMPLED_NOTE,
    };
    count += 1;
  }
  if (count === 0) return null;

  return { ...SUMIT_CARD_BASE_OUTPUT, ...known, ...sampled };
}
