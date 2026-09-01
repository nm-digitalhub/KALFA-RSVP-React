'use client';

// Admin form for the callback-scheduling policy (business hours per weekday,
// minimum notice, horizon, call duration, daily cap, motzash resume delay).
// Follows the established admin-form pattern (useActionState + FormState +
// FieldError/FormError/FormNotice/SubmitButton), mirroring agreement-config-form.tsx.

import { useActionState, useState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { HelpTip } from '@/components/help-tip';
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs';
import { saveCallbackPolicyAction } from './actions';
import type { CallbackPolicyFormValues } from '@/lib/callbacks/policy-config-admin';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS: Record<(typeof DAYS)[number], string> = {
  sun: 'ראשון',
  mon: 'שני',
  tue: 'שלישי',
  wed: 'רביעי',
  thu: 'חמישי',
  fri: 'שישי',
  sat: 'שבת',
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'text-sm font-medium';

// The loader stores minutes-since-midnight as a plain numeric string (matching
// the DB column); <input type="time"> needs "HH:MM".
function minutesToHHMM(value: string): string {
  const n = Number(value);
  if (!value || !Number.isFinite(n)) return '';
  const h = Math.floor(n / 60) % 24;
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function cap(day: (typeof DAYS)[number]): string {
  return `${day[0].toUpperCase()}${day.slice(1)}`;
}

function DayRow({
  day,
  values,
  errors,
  dial = false,
}: {
  day: (typeof DAYS)[number];
  values: CallbackPolicyFormValues;
  errors?: string[];
  /** Renders the dial${Day}Open/Start/End fields (the "חיוג" tab) instead of the scheduling ones. */
  dial?: boolean;
}) {
  const openKey = (dial ? `dial${cap(day)}Open` : `${day}Open`) as keyof CallbackPolicyFormValues;
  const startKey = (dial ? `dial${cap(day)}Start` : `${day}Start`) as keyof CallbackPolicyFormValues;
  const endKey = (dial ? `dial${cap(day)}End` : `${day}End`) as keyof CallbackPolicyFormValues;
  const [open, setOpen] = useState(Boolean(values[openKey]));

  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <label className="inline-flex w-20 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name={openKey}
          checked={open}
          onChange={(e) => setOpen(e.target.checked)}
          className="size-4 accent-primary"
        />
        {DAY_LABELS[day]}
      </label>
      {open ? (
        <>
          <input
            type="time"
            name={startKey}
            defaultValue={minutesToHHMM(String(values[startKey] ?? ''))}
            dir="ltr"
            className={`${inputClass} w-32`}
          />
          <span className="text-sm text-muted-foreground">עד</span>
          <input
            type="time"
            name={endKey}
            defaultValue={minutesToHHMM(String(values[endKey] ?? ''))}
            dir="ltr"
            className={`${inputClass} w-32`}
          />
        </>
      ) : (
        <span className="text-sm text-muted-foreground">סגור</span>
      )}
      <FieldError errors={errors} />
    </div>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
  help,
  errors,
}: {
  name: string;
  label: string;
  defaultValue: string;
  help: string;
  errors?: string[];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <label htmlFor={name} className={labelClass}>
          {label}
        </label>
        <HelpTip text={help} />
      </div>
      <input
        id={name}
        name={name}
        type="number"
        defaultValue={defaultValue}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        className={inputClass}
      />
      <FieldError errors={errors} />
    </div>
  );
}

export function CallbackPolicyForm({ values }: { values: CallbackPolicyFormValues }) {
  const [state, action] = useActionState(saveCallbackPolicyAction, null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-6">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <Tabs defaultValue="scheduling">
        <TabsList>
          <TabsTab value="scheduling">תזמון</TabsTab>
          <TabsTab value="dialing">חיוג</TabsTab>
        </TabsList>

        <TabsPanel value="scheduling" keepMounted className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold">שעות פעילות לתזמון</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              מתי מותר לקבוע פגישת שיחה חוזרת חדשה ביומן.
            </p>
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              {DAYS.map((day) => (
                <DayRow key={day} day={day} values={values} errors={e?.[`${day}Start`]} />
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              name="minNoticeMinutes"
              label="זמן מראש מינימלי (דקות)"
              defaultValue={values.minNoticeMinutes}
              help="כמה זמן מראש חייב לחלוף מהרגע הנוכחי לפני שמותר לשבץ שיחה. ברירת מחדל: 120 (שעתיים)."
              errors={e?.minNoticeMinutes}
            />
            <NumberField
              name="horizonDays"
              label="טווח קדימה (ימים)"
              defaultValue={values.horizonDays}
              help="כמה ימים קדימה מהיום מותר לחפש מועד פנוי. ברירת מחדל: 14."
              errors={e?.horizonDays}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              name="durationMinutes"
              label="אורך שיחה (דקות)"
              defaultValue={values.durationMinutes}
              help="משך הזמן שנשמר ביומן עבור כל שיחה חוזרת. ברירת מחדל: 15."
              errors={e?.durationMinutes}
            />
            <NumberField
              name="dailyCap"
              label="מכסה יומית"
              defaultValue={values.dailyCap}
              help="מספר השיחות המקסימלי שניתן לשבץ באותו יום קלנדרי. ברירת מחדל: 8."
              errors={e?.dailyCap}
            />
          </div>

          <NumberField
            name="motzashResumeMinutes"
            label="השהיה אחרי מוצאי שבת (דקות)"
            defaultValue={values.motzashResumeMinutes}
            help="כמה דקות אחרי הבדלה מתחדש השיבוץ. ברירת מחדל: 30."
            errors={e?.motzashResumeMinutes}
          />
        </TabsPanel>

        <TabsPanel value="dialing" keepMounted className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold">שעות חיוג בפועל</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              מתי מותר להעביר שיחת טלפון בפועל — אנושית או של סוכן AI. נפרד משעות התזמון למעלה.
            </p>
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              {DAYS.map((day) => (
                <DayRow key={day} day={day} dial values={values} errors={e?.[`dial${cap(day)}Start`]} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">מכסת ניסיונות חיוג</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                name="maxAttempts"
                label="מספר ניסיונות מקסימלי"
                defaultValue={values.maxAttempts}
                help="כמה פעמים מותר לחייג לאותה בקשה (חוזר אנושי, סוכן אישור פגישה או סוכן סגירת מכירה — כולם חולקים את אותה מכסה) לפני חסימה. ברירת מחדל: 3."
                errors={e?.maxAttempts}
              />
              <NumberField
                name="attemptWindowDays"
                label="חלון ספירה (ימים)"
                defaultValue={values.attemptWindowDays}
                help="לאורך כמה ימים אחורה נספרים הניסיונות למכסה. ברירת מחדל: 30."
                errors={e?.attemptWindowDays}
              />
            </div>
          </div>
        </TabsPanel>
      </Tabs>

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
