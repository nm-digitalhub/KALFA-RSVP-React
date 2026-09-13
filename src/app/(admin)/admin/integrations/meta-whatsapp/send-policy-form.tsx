'use client';

import { useActionState } from 'react';

import { Badge } from '@/components/ui/badge';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { HelpTip } from '@/components/help-tip';
import { updateSendPolicyAction } from '@/app/(admin)/admin/integrations/actions';
import type { AdminSendPolicy } from '@/lib/data/admin/integrations/send-policy';
import { EDITABLE_WEEKDAYS, WEEKDAY_LABELS } from '@/lib/validation/send-policy-form';

// The send-timing window, editable from the panel for the first time (G9). Every
// campaign send is scheduled against this; the value was live and SQL-only.
//
// WHAT THIS FORM CANNOT DO, and why that is the feature: it can only NARROW.
// parseSendPolicy holds the floor (09:00), the weekday and Friday ceilings, the
// 21:00 hard cap, the ≥60-minute motzash delay, and Saturday = no sends. A window
// that crosses any of them is refused with the ceiling named, and Saturday gets no
// inputs at all — opening night or Shabbat sends is a code change, not a setting.
// That is a legal and reputational boundary, not a preference.
//
// The times are `type="time"`, so the browser renders its locale's own clock and
// posts 'HH:MM' either way — which is exactly what the schema's regex accepts.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

function TimeInput({
  name,
  defaultValue,
  label,
  errors,
  'aria-label': ariaLabel,
}: {
  name: string;
  defaultValue: string;
  label?: string;
  errors?: string[];
  'aria-label'?: string;
}) {
  return (
    <div>
      {label ? (
        <label htmlFor={name} className={labelClass}>
          {label}
        </label>
      ) : null}
      <input
        id={name}
        name={name}
        type="time"
        defaultValue={defaultValue}
        aria-label={ariaLabel}
        dir="ltr"
        className={inputClass}
      />
      <FieldError errors={errors} />
    </div>
  );
}

function NumberInput({
  name,
  label,
  defaultValue,
  help,
  hint,
  min,
  max,
  errors,
  'aria-label': ariaLabel,
}: {
  name: string;
  label?: string;
  defaultValue: string;
  help?: string;
  hint?: string;
  min: number;
  max: number;
  errors?: string[];
  'aria-label'?: string;
}) {
  return (
    <div>
      {label ? (
        <label htmlFor={name} className={labelClass}>
          {label}
          {help ? <HelpTip text={help} /> : null}
        </label>
      ) : null}
      <input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        defaultValue={defaultValue}
        aria-label={ariaLabel}
        dir="ltr"
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError errors={errors} />
    </div>
  );
}

function SourceBadge({ source }: { source: AdminSendPolicy['source'] }) {
  if (source === 'stored') return <Badge variant="success">מדיניות שמורה</Badge>;
  if (source === 'default') return <Badge variant="neutral">ברירת מחדל</Badge>;
  return <Badge variant="warning">הערך השמור נדחה</Badge>;
}

export function SendPolicyForm({ policy: admin }: { policy: AdminSendPolicy }) {
  const [state, action] = useActionState(updateSendPolicyAction, null);
  const e = state?.fieldErrors;
  const p = admin.policy;

  // Existing keys first (newest touchpoint first), then ONE blank row so a
  // days_before with no preferred time can be given one without a migration or a
  // developer. Clearing a time removes that row on save.
  const preferredRows = Object.keys(p.preferredTimeByDaysBefore)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <FieldError errors={e?._root} />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <SourceBadge source={admin.source} />
        <span className="text-sm text-muted-foreground">
          {admin.source === 'stored'
            ? 'הערכים למטה הם מה שמנוע השליחה משתמש בו כרגע.'
            : admin.source === 'default'
              ? 'לא נשמרה מדיניות, ולכן מנוע השליחה משתמש בברירת המחדל שמוצגת למטה. שמירה תקבע אותה במפורש.'
              : /* The state with no other way to be seen: a value IS stored, the
                   sender rejects it, and the panel used to show a policy nothing
                   was obeying. */
                `נשמרה מדיניות שאינה עוברת אימות, ולכן מנוע השליחה מתעלם ממנה ומשתמש בברירת המחדל שמוצגת למטה. הסיבה: ${admin.invalidReason}`}
        </span>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">חלון שליחה יומי</legend>
        <p className="text-xs text-muted-foreground">
          אפשר לצמצם בלבד: התחלה לא לפני 09:00, סיום לא אחרי 20:30 (יום שישי 12:00).
          שבת חסומה תמיד.
        </p>
        <div className="space-y-2">
          {EDITABLE_WEEKDAYS.map((d) => (
            <div key={d} className="flex flex-wrap items-start gap-3">
              <span className="min-w-16 pt-2 text-sm">{WEEKDAY_LABELS[d]}</span>
              <div className="w-32">
                <TimeInput
                  name={`weekday.${d}.start`}
                  defaultValue={p.weekday[d]?.start ?? ''}
                  aria-label={`${WEEKDAY_LABELS[d]} — התחלה`}
                  errors={e?.[`weekday.${d}.start`]}
                />
              </div>
              <span className="pt-2 text-sm text-muted-foreground">עד</span>
              <div className="w-32">
                <TimeInput
                  name={`weekday.${d}.end`}
                  defaultValue={p.weekday[d]?.end ?? ''}
                  aria-label={`${WEEKDAY_LABELS[d]} — סיום`}
                  errors={e?.[`weekday.${d}.end`]}
                />
              </div>
            </div>
          ))}
          {/* No inputs, by design. The action ignores anything posted for Saturday
              and parseSendPolicy rejects a non-null Saturday — a disabled control
              would suggest the rule is a setting someone could be given. */}
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2">
            <span className="min-w-16 text-sm">{WEEKDAY_LABELS[6]}</span>
            <span className="text-sm text-muted-foreground">
              אין שליחה — נעול בקוד, לא ניתן לפתיחה מהפאנל
            </span>
          </div>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <TimeInput
          name="hardCap"
          label="גבול קשיח"
          defaultValue={p.hardCap}
          errors={e?.hardCap}
        />
        <NumberInput
          name="motzashPlusMin"
          label="פתיחה במוצ״ש (דקות אחרי צאת השבת)"
          defaultValue={String(p.motzashPlusMin)}
          min={60}
          max={180}
          hint="לא פחות מ-60."
          help="השליחה נפתחת מחדש כך וכך דקות אחרי צאת השבת או החג, לפי זמני ירושלים."
          errors={e?.motzashPlusMin}
        />
        <NumberInput
          name="spreadSpanMinutes"
          label="פריסת שליחה (דקות)"
          defaultValue={String(Math.round(p.spreadSpanMs / 60_000))}
          min={0}
          max={360}
          hint="ההודעות נפרסות על פני חלון זה בתוך חלון השליחה."
          errors={e?.spreadSpanMinutes}
        />
        <TimeInput
          name="defaultPreferred"
          label="שעה מועדפת (ברירת מחדל)"
          defaultValue={p.defaultPreferred}
          errors={e?.defaultPreferred}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">שעה מועדפת לפי ימים לפני האירוע</legend>
        <p className="text-xs text-muted-foreground">
          כל מספר ימים שאין לו שורה נשלח בשעת ברירת המחדל. מחיקת השעה מסירה את
          השורה; השורה הריקה בסוף מוסיפה חדשה.
        </p>
        <div className="space-y-2">
          {[...preferredRows, null].map((days, i) => (
            <div key={days ?? 'new'} className="flex flex-wrap items-start gap-3">
              <div className="w-24">
                <NumberInput
                  name={`preferred.${i}.days`}
                  defaultValue={days === null ? '' : String(days)}
                  min={0}
                  max={365}
                  aria-label="ימים לפני האירוע"
                  errors={e?.[`preferred.${i}.days`]}
                />
              </div>
              <span className="pt-2 text-sm text-muted-foreground">ימים לפני →</span>
              <div className="w-32">
                <TimeInput
                  name={`preferred.${i}.time`}
                  defaultValue={
                    days === null ? '' : (p.preferredTimeByDaysBefore[String(days)] ?? '')
                  }
                  aria-label="שעה מועדפת"
                  errors={e?.[`preferred.${i}.time`]}
                />
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <SubmitButton>שמירת מדיניות השליחה</SubmitButton>
    </form>
  );
}
