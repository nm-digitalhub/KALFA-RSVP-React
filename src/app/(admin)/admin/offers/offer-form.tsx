'use client';

import { useActionState, useId, useState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { computeOfferOption, type OfferKind } from '@/lib/offers/pricing';
import type { OfferPackageChoice } from '@/lib/data/admin/offers';
import type { FormState } from '@/lib/validation/result';

// Shared create/edit form for an offer (personal-coupons D14/D23, mockup ui/OfferEdit.dc.html).
// The parent binds the correct Server Action (create, or update with the id pre-bound) and passes
// initial values for edit mode.
//
// The allowed packages are checkbox rows over the real catalogue; each selected row shows the live
// final price (the SAME computeOfferOption the server refuses with, so the preview and the refusal
// can never disagree) and an optional per-package override. The selection is synced into one
// hidden `packages_json` field — the structured-rows-to-hidden-JSON pattern of the package form.
// The preview is a convenience only; the server recomputes from stored prices and refuses a
// non-positive floor.

export interface OfferFormInitial {
  title: string;
  kind: OfferKind;
  value: number | '';
  validity_days: number | '';
  allow_agent: boolean;
  allow_staff: boolean;
  agent_objections: string[];
  may_replace: boolean;
  is_active: boolean;
  packages: { package_id: string; value_override: number | null }[];
}

const EMPTY: OfferFormInitial = {
  title: '',
  kind: 'percent',
  value: '',
  validity_days: '',
  allow_agent: false,
  allow_staff: true,
  agent_objections: [],
  may_replace: false,
  is_active: true,
  packages: [],
};

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const labelClass = 'block text-sm font-medium';
const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

const currency = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 2,
});

type PackageRowState = { checked: boolean; override: string };

function initialRows(
  choices: OfferPackageChoice[],
  selected: OfferFormInitial['packages'],
): Record<string, PackageRowState> {
  const byId = new Map(selected.map((p) => [p.package_id, p]));
  const rows: Record<string, PackageRowState> = {};
  for (const choice of choices) {
    const stored = byId.get(choice.id);
    rows[choice.id] = {
      checked: stored !== undefined,
      override: stored?.value_override != null ? String(stored.value_override) : '',
    };
  }
  return rows;
}

export function OfferForm({
  action,
  initial,
  submitLabel,
  packageChoices,
}: {
  action: FormAction;
  initial?: OfferFormInitial;
  submitLabel: string;
  packageChoices: OfferPackageChoice[];
}) {
  const [state, formAction] = useActionState(action, null);
  const values = initial ?? EMPTY;
  const formId = useId();

  const [kind, setKind] = useState<OfferKind>(values.kind);
  const [value, setValue] = useState<string>(values.value === '' ? '' : String(values.value));
  const [rows, setRows] = useState<Record<string, PackageRowState>>(() =>
    initialRows(packageChoices, values.packages),
  );

  const setRow = (id: string, next: Partial<PackageRowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));

  // An inactive package is shown only while the offer still allows it (stored state is never
  // hidden); it cannot be newly selected.
  const visibleChoices = packageChoices.filter((c) => c.active || rows[c.id]?.checked);

  const packagesJson = JSON.stringify(
    visibleChoices
      .filter((c) => rows[c.id]?.checked)
      .map((c) => {
        const override = rows[c.id]?.override.trim() ?? '';
        return {
          package_id: c.id,
          value_override: override === '' ? null : Number(override),
        };
      }),
  );

  // The live preview for one row — null while the discount value is not a number yet.
  const previewFor = (choice: OfferPackageChoice): number | null => {
    const row = rows[choice.id];
    const effective = row?.override.trim() !== '' ? Number(row?.override) : Number(value);
    if (!Number.isFinite(effective) || effective <= 0) return null;
    return computeOfferOption(choice.price_with_vat, kind, effective).finalPrice;
  };

  const fieldErrors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div className="space-y-1">
        <label htmlFor={`${formId}-title`} className={labelClass}>
          שם ההצעה
        </label>
        <input
          id={`${formId}-title`}
          name="title"
          defaultValue={values.title}
          className={inputClass}
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground">לצוות בלבד. הלקוח לא רואה את השם.</p>
        <FieldError errors={fieldErrors.title} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${formId}-kind`} className={labelClass}>
            סוג ההנחה
          </label>
          <select
            id={`${formId}-kind`}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value === 'amount' ? 'amount' : 'percent')}
            className={inputClass}
          >
            <option value="percent">אחוז ממחיר החבילה</option>
            <option value="amount">סכום קבוע בשקלים</option>
          </select>
          <FieldError errors={fieldErrors.kind} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-value`} className={labelClass}>
            גובה ההנחה
          </label>
          <input
            id={`${formId}-value`}
            name="value"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
          />
          <FieldError errors={fieldErrors.value} />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${formId}-days`} className={labelClass}>
          תוקף, בימים מרגע ההקצאה
        </label>
        <input
          id={`${formId}-days`}
          name="validity_days"
          inputMode="numeric"
          defaultValue={values.validity_days === '' ? '' : String(values.validity_days)}
          className={inputClass}
        />
        <FieldError errors={fieldErrors.validity_days} />
      </div>

      <hr className="border-border" />

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">חבילות שההצעה כוללת</legend>
        {visibleChoices.map((choice) => {
          const row = rows[choice.id];
          const final = row?.checked ? previewFor(choice) : null;
          return (
            <div key={choice.id} className="space-y-1 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`${formId}-pkg-${choice.id}`}
                  type="checkbox"
                  checked={row?.checked ?? false}
                  onChange={(e) => setRow(choice.id, { checked: e.target.checked })}
                  className="size-4 rounded border-border"
                />
                <label htmlFor={`${formId}-pkg-${choice.id}`} className="text-sm font-medium">
                  {choice.name} · <span dir="ltr">{currency.format(choice.price_with_vat)}</span>
                  {final !== null && (
                    <>
                      {' '}
                      ←{' '}
                      <span dir="ltr" className={final <= 0 ? 'text-destructive' : undefined}>
                        {currency.format(final)}
                      </span>
                    </>
                  )}
                </label>
                {!choice.active && (
                  <span className="rounded-full border border-border px-2 text-xs text-muted-foreground">
                    לא פעילה
                  </span>
                )}
              </div>
              {row?.checked && (
                <div className="flex items-center gap-2 ps-6">
                  <label
                    htmlFor={`${formId}-ovr-${choice.id}`}
                    className="text-xs text-muted-foreground"
                  >
                    הנחה שונה לחבילה זו (לא חובה)
                  </label>
                  <input
                    id={`${formId}-ovr-${choice.id}`}
                    inputMode="decimal"
                    value={row.override}
                    onChange={(e) => setRow(choice.id, { override: e.target.value })}
                    className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                </div>
              )}
              {final !== null && final <= 0 && (
                <p className="text-xs text-destructive">
                  ההנחה מביאה את החבילה למחיר אפס או שלילי — ההצעה תידחה בשמירה.
                </p>
              )}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          רק חבילות פעילות שמוצעות ללקוחות מופיעות כאן.
        </p>
        <input type="hidden" name="packages_json" value={packagesJson} />
        <FieldError errors={fieldErrors.packages} />
      </fieldset>

      <hr className="border-border" />

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">מי רשאי להקצות</legend>
        <div className="flex items-center gap-2">
          <input
            id={`${formId}-agent`}
            name="allow_agent"
            type="checkbox"
            defaultChecked={values.allow_agent}
            className="size-4 rounded border-border"
          />
          <label htmlFor={`${formId}-agent`} className="text-sm font-medium">
            עומר, סוכן המכירות, בשיחה
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            id={`${formId}-staff`}
            name="allow_staff"
            type="checkbox"
            defaultChecked={values.allow_staff}
            className="size-4 rounded border-border"
          />
          <label htmlFor={`${formId}-staff`} className="text-sm font-medium">
            צוות עם הרשאת חיוב
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">כללי שימוש לסוכן</legend>
        <div className="space-y-1">
          <label htmlFor={`${formId}-objections`} className={labelClass}>
            מתי מותר להציע — סיבות התנגדות, שורה לכל סיבה
          </label>
          <textarea
            id={`${formId}-objections`}
            name="agent_objections"
            rows={3}
            defaultValue={values.agent_objections.join('\n')}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">
            הסוכן מדווח את התנגדות הלקוח במילים; השרת מתאים את הדיווח לרשימה זו ובוחר את ההצעה.
          </p>
          <FieldError errors={fieldErrors.agent_objections} />
        </div>
        <div className="flex items-center gap-2">
          <input
            id={`${formId}-replace`}
            name="may_replace"
            type="checkbox"
            defaultChecked={values.may_replace}
            className="size-4 rounded border-border"
          />
          <label htmlFor={`${formId}-replace`} className="text-sm font-medium">
            רשאית להחליף הטבה פעילה קיימת (העלאה מבוקרת)
          </label>
        </div>
      </fieldset>

      <div className="flex items-center gap-2">
        <input
          id={`${formId}-active`}
          name="is_active"
          type="checkbox"
          defaultChecked={values.is_active}
          className="size-4 rounded border-border"
        />
        <label htmlFor={`${formId}-active`} className="text-sm font-medium">
          פעילה
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        שינוי ההצעה חל רק על הטבות שיוקצו מעכשיו. הטבות שכבר הוקצו שומרות את התנאים והמחירים שלהן.
      </p>

      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
