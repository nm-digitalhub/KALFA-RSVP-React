'use client';

import {
  EVENT_TYPES,
  type CelebrantFieldKey,
} from '@/lib/validation/schemas';
import { CELEBRANT_FIELD_LABELS, HOST_COMPOSITION_LABELS } from '@/lib/data/event-labels';
import { FieldError } from '@/components/forms';

type EventType = (typeof EVENT_TYPES)[number];

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60';

// Celebrant (בעלי שמחה) inputs for the selected event type: plain named
// inputs (celebrants.groom, celebrants.bride, ...) that the server action
// reads per the submitted event_type's kind. Uncontrolled — the parent
// remounts the group via key={eventType} whenever the type changes, so no
// stale value from another kind ever lingers. Every field is optional here:
// completeness is enforced only at campaign enablement.
//
// ONE component for both the create and the edit form (owner ruling
// 2026-09-02: the two forms carry the same fields) — the create form passes no
// defaults and no requiredKeys.
export function CelebrantFields({
  eventType,
  defaults = {},
  errors,
  requiredKeys,
}: {
  eventType: EventType;
  defaults?: Record<string, string>;
  errors?: Record<string, string[] | undefined>;
  // While an operational campaign exists these fields are `required` (they are
  // bound into every pending invite/reminder — the browser must block a save that
  // empties them). Empty otherwise: at draft/no-campaign all fields stay
  // optional (completeness is only the campaign gate's concern).
  requiredKeys?: readonly CelebrantFieldKey[];
}) {
  const required = new Set<string>(requiredKeys ?? []);
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium">בעלי השמחה</legend>
      <p className="text-xs text-muted-foreground">
        {required.size > 0
          ? 'כל עוד קיים קמפיין אישורי הגעה בתהליך — הפרטים מופיעים בהזמנות ובתזכורות ולכן חייבים להישאר מלאים.'
          : 'יש למלא לפני הפעלת אישורי הגעה'}
      </p>
      {Object.entries(CELEBRANT_FIELD_LABELS[eventType]).map(([field, label]) => (
        <div key={field}>
          <label
            htmlFor={`celebrants.${field}`}
            className="mb-1 block text-sm font-medium"
          >
            {label}
          </label>
          {field === 'host_composition' ? (
            <select
              id={`celebrants.${field}`}
              name={`celebrants.${field}`}
              defaultValue={defaults[field] ?? ''}
              required={required.has(field)}
              className={inputClass}
            >
              <option value="" disabled>
                בחרו…
              </option>
              {Object.entries(HOST_COMPOSITION_LABELS).map(([value, optLabel]) => (
                <option key={value} value={value}>
                  {optLabel}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`celebrants.${field}`}
              name={`celebrants.${field}`}
              type="text"
              defaultValue={defaults[field] ?? ''}
              required={required.has(field)}
              className={inputClass}
            />
          )}
          <FieldError errors={errors?.[`celebrants.${field}`]} />
        </div>
      ))}
    </fieldset>
  );
}
