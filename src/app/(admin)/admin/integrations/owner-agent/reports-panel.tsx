'use client';

import { useActionState, useState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { LocalDateTime } from '@/components/local-date-time';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { OwnerAgentAllowlistEntry } from '@/lib/data/admin/owner-agent';
import type {
  OwnerAgentReportRun,
  OwnerAgentReportSchedule,
  OwnerAgentReportSettings,
} from '@/lib/data/admin/owner-agent-reports';
import {
  DEFAULT_REPORT_SLOTS,
  MAX_REPORT_INSTRUCTIONS,
  MAX_REPORT_SLOTS,
} from '@/lib/validation/owner-agent-reports';

import {
  setOwnerAgentReportScheduleAction,
  setOwnerAgentReportTemplateAction,
  setOwnerAgentReportsEnabledAction,
} from './reports-actions';

// The proactive report (plans/owner-agent-chat-sdk-capabilities-plan.md §4.8): the
// reports switch, the template used outside the 24h window, per allow-list row the
// opt-in and the daily hours, and the recent runs. Owner decision 27.9: the schedule is
// set here and only here.
//
// What the screen can promise and what it cannot: the report still passes every gate
// at send time (the agent switch, this switch, the number, the row, the identity, the
// permissions), so a row that is ticked here can still get nothing — the runs table
// says why, in codes. The report carries only the sections the staff member's role
// permits; a person outside the staff has none, so they get no report at all.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

const STATUS_LABELS: Record<string, { label: string; tone: BadgeVariant }> = {
  queued: { label: 'בתור', tone: 'info' },
  processing: { label: 'בעיבוד', tone: 'info' },
  sending: { label: 'בשליחה', tone: 'info' },
  sent: { label: 'נשלח', tone: 'success' },
  failed: { label: 'נכשל', tone: 'destructive' },
  skipped: { label: 'דולג', tone: 'warning' },
  expired: { label: 'פג', tone: 'neutral' },
};

const CHANNEL_LABELS: Record<string, string> = {
  text: 'טקסט',
  template: 'תבנית',
};

// The codes are a pattern in the database, not a closed list: an unknown one is shown
// as-is rather than hidden.
const CODE_LABELS: Record<string, string> = {
  late: 'באיחור של יותר משעה',
  kill_switch_off: 'מתג הסוכן כבוי',
  reports_off: 'מתג הדוחות כבוי',
  no_number: 'לא נבחר מספר',
  subscription_off: 'השעה בוטלה',
  not_allowlisted: 'הרשומה הושבתה',
  not_opted_in: 'הרשומה לא מקבלת דוחות',
  not_staff: 'אינו איש צוות',
  phone_unverified: 'טלפון לא מאומת',
  no_permissions: 'אין הרשאות לנתוני הדוח',
  permissions_changed: 'ההרשאות השתנו',
  number_changed: 'המספר הוחלף',
  template_unavailable: 'מחוץ לחלון 24 השעות ואין תבנית',
  window_closed: 'חלון 24 השעות נסגר',
  provider_rejected: 'Meta דחתה את ההודעה',
  send_unknown: 'תוצאת השליחה לא ידועה',
  send_unconfirmed: 'שליחה לא אושרה',
  partial_send: 'נשלח חלקית',
};

function entryName(entry: OwnerAgentAllowlistEntry | undefined): string {
  if (!entry) return 'רשומה שהוסרה';
  return entry.staffName ?? entry.label ?? 'ללא שם';
}

export function ReportsPanel({
  settings,
  schedules,
  runs,
  entries,
  agentEnabled,
}: {
  settings: OwnerAgentReportSettings;
  schedules: OwnerAgentReportSchedule[];
  runs: OwnerAgentReportRun[];
  entries: OwnerAgentAllowlistEntry[];
  agentEnabled: boolean;
}) {
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const schedulesById = new Map(schedules.map((s) => [s.entryId, s]));

  return (
    <div className="space-y-5">
      <ReportsSwitch
        enabled={settings.reportsEnabled}
        agentEnabled={agentEnabled}
        hasTemplate={settings.templateName !== null}
      />
      <TemplateForm templateName={settings.templateName} templateLang={settings.templateLang} />

      <div className="space-y-3">
        <h3 className="text-base font-semibold">מי מקבל דוח, ומתי</h3>
        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            אין עדיין רשומות ברשימת ההיתר.
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id}>
                <ScheduleForm
                  entry={entry}
                  schedule={
                    schedulesById.get(entry.id) ?? { entryId: entry.id, optIn: false, slots: [], configured: false }
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-semibold">דוחות אחרונים</h3>
        <p className="text-sm text-muted-foreground">
          {runs.length > 0 ? `${runs.length} האחרונים. ` : ''}קודים בלבד: תוכן הדוח לא נשמר ולא מוצג כאן.
        </p>
        <RunsTable runs={runs} entriesById={entriesById} />
      </div>
    </div>
  );
}

function ReportsSwitch({
  enabled,
  agentEnabled,
  hasTemplate,
}: {
  enabled: boolean;
  agentEnabled: boolean;
  hasTemplate: boolean;
}) {
  const [state, action] = useActionState(setOwnerAgentReportsEnabledAction, null);

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">מתג הדוחות</p>
        <p className="text-xs text-muted-foreground">
          מתג נפרד ממתג הסוכן. כשהוא כבוי לא נוצר ולא נשלח אף דוח. הדוח נבנה ממספרים בלבד, בלי
          מודל, ורק מהנתונים שההרשאות של איש הצוות מתירות.
        </p>
        {enabled && !agentEnabled ? (
          <p className="text-xs font-medium text-warning">מתג הדוחות דלוק, אבל מתג הסוכן כבוי — לא יישלח דוח.</p>
        ) : null}
        {enabled && !hasTemplate ? (
          <p className="text-xs font-medium text-warning">
            אין תבנית מוגדרת: דוח יישלח רק למי שכתב לסוכן ב-24 השעות האחרונות.
          </p>
        ) : null}
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="owner_agent_reports_enabled"
            defaultChecked={enabled}
            className="size-4 accent-primary"
          />
          מופעל
        </label>
        <SubmitButton className="w-auto">עדכון</SubmitButton>
      </div>
    </form>
  );
}

function TemplateForm({ templateName, templateLang }: { templateName: string | null; templateLang: string | null }) {
  const [state, action] = useActionState(setOwnerAgentReportTemplateAction, null);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-background p-4">
      <div>
        <p className="text-sm font-semibold">תבנית מחוץ לחלון 24 השעות</p>
        <p id="report-template-hint" className="text-xs text-muted-foreground">
          WhatsApp מתיר טקסט חופשי רק עד 24 שעות מההודעה האחרונה של איש הצוות. אחרי זה יוצאת רק
          תבנית שאושרה ב-Meta. בלי תבנית, דוח מחוץ לחלון לא יוצא בכלל.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div>
          <label htmlFor="report-template-name" className="mb-1 block text-sm font-medium">
            שם התבנית
          </label>
          <input
            id="report-template-name"
            name="templateName"
            dir="ltr"
            defaultValue={templateName ?? ''}
            placeholder="kalfa_owner_daily_report_util_v1"
            aria-describedby="report-template-hint"
            aria-invalid={state?.fieldErrors?.templateName ? true : undefined}
            className={`${inputClass} font-mono`}
          />
          <FieldError errors={state?.fieldErrors?.templateName} />
        </div>
        <div>
          <label htmlFor="report-template-lang" className="mb-1 block text-sm font-medium">
            שפה
          </label>
          <input
            id="report-template-lang"
            name="templateLang"
            dir="ltr"
            defaultValue={templateLang ?? ''}
            placeholder="he"
            aria-invalid={state?.fieldErrors?.templateLang ? true : undefined}
            className={`${inputClass} font-mono`}
          />
          <FieldError errors={state?.fieldErrors?.templateLang} />
        </div>
        <SubmitButton className="w-auto">שמירה</SubmitButton>
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

let nextSlotKey = 0;
const slotRow = (time: string, instructions: string | null = null) => ({
  key: ++nextSlotKey,
  time,
  instructions: instructions ?? '',
});

function ScheduleForm({ entry, schedule }: { entry: OwnerAgentAllowlistEntry; schedule: OwnerAgentReportSchedule }) {
  const [state, action] = useActionState(setOwnerAgentReportScheduleAction, null);
  // Any whole-minute time (owner decision 27.9). A row that never had a schedule is
  // offered the owner's own request (08:00, 00:00); nothing is saved until "שמירה".
  const [slots, setSlots] = useState(() =>
    schedule.configured
      ? schedule.slots.map((s) => slotRow(s.time, s.instructions))
      : DEFAULT_REPORT_SLOTS.map((t) => slotRow(t)),
  );
  const update = (key: number, patch: Partial<{ time: string; instructions: string }>) =>
    setSlots((cur) => cur.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const external = entry.approvalKind === 'external_override';
  const hoursId = `report-hours-${entry.id}`;

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-background p-4">
      <input type="hidden" name="entryId" value={entry.id} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {entryName(entry)}{' '}
          <span dir="ltr" className="font-mono text-xs font-normal text-muted-foreground">
            {entry.maskedNumber}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {!entry.enabled ? <Badge variant="neutral">מושבתת</Badge> : null}
          {external ? <Badge variant="warning">חיצוני — אין הרשאות, לא יקבל דוח</Badge> : null}
          {schedule.optIn ? <Badge variant="success">מקבל דוחות</Badge> : null}
        </div>
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="optIn" defaultChecked={schedule.optIn} className="size-4 accent-primary" />
        לשלוח דוחות לרשומה הזו
      </label>

      <fieldset className="space-y-2" aria-describedby={`${hoursId}-hint`}>
        <legend className="text-sm font-medium">שעות (שעון ישראל)</legend>
        <p id={`${hoursId}-hint`} className="text-xs text-muted-foreground">
          כל שעה בדקות שלמות, עד {MAX_REPORT_SLOTS}. 00:00 מסכם את היום שהסתיים; כל שעה אחרת מסכמת
          מחצות עד אותה שעה, ומוסיפה תמונת מצב. ביום המעבר לשעון קיץ אין 02:00–02:59, ודוח בשעה כזו לא
          יוצא באותו יום.
        </p>
        <p className="text-xs text-muted-foreground">
          הנחיות לדוח (לא חובה): כשכתובות הנחיות, הסוכן כותב את הדוח לפיהן, מהנתונים שההרשאות של איש
          הצוות מתירות. בלי הנחיות יוצא הדוח המספרי הקבוע.
        </p>
        <ul className="space-y-3">
          {slots.map((slot, i) => (
            <li key={slot.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`${hoursId}-${slot.key}`} className="text-sm font-medium">
                  שעה {i + 1}
                </label>
                <input
                  id={`${hoursId}-${slot.key}`}
                  type="time"
                  name="slots"
                  step={60}
                  dir="ltr"
                  value={slot.time}
                  onChange={(e) => update(slot.key, { time: e.target.value })}
                  className="min-h-11 rounded-md border border-border bg-background px-3 text-sm tabular-nums outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ms-auto min-h-11"
                  aria-label={`הסרת שעה ${i + 1}`}
                  onClick={() => setSlots((cur) => cur.filter((s) => s.key !== slot.key))}
                >
                  הסרה
                </Button>
              </div>
              <label htmlFor={`${hoursId}-${slot.key}-instructions`} className="sr-only">
                הנחיות לדוח של שעה {i + 1}
              </label>
              <Textarea
                id={`${hoursId}-${slot.key}-instructions`}
                name="instructions"
                rows={2}
                maxLength={MAX_REPORT_INSTRUCTIONS}
                placeholder="הנחיות לדוח (לא חובה) — למשל: רק אירועים חדשים והכנסות, בשלוש שורות"
                value={slot.instructions}
                onChange={(e) => update(slot.key, { instructions: e.target.value })}
              />
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={slots.length >= MAX_REPORT_SLOTS}
          onClick={() => setSlots((cur) => [...cur, slotRow('')])}
        >
          הוספת שעה
        </Button>
        <FieldError errors={state?.fieldErrors?.slots ?? firstSlotError(state?.fieldErrors)} />
      </fieldset>

      <div className="flex items-center justify-end">
        <SubmitButton className="w-auto">שמירה</SubmitButton>
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

// A bad single time or text comes back keyed "slots.<i>.time" / "slots.<i>.instructions".
function firstSlotError(fieldErrors: Record<string, string[] | undefined> | undefined): string[] | undefined {
  if (!fieldErrors) return undefined;
  const key = Object.keys(fieldErrors).find((k) => k.startsWith('slots.'));
  return key ? fieldErrors[key] : undefined;
}

function RunsTable({
  runs,
  entriesById,
}: {
  runs: OwnerAgentReportRun[];
  entriesById: Map<string, OwnerAgentAllowlistEntry>;
}) {
  if (runs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        עדיין לא נוצר אף דוח.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>נוצר</TableHead>
          <TableHead>רשומה</TableHead>
          <TableHead>משבצת</TableHead>
          <TableHead>מצב</TableHead>
          <TableHead>ערוץ</TableHead>
          <TableHead>סיבה</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const status = STATUS_LABELS[run.status];
          return (
            <TableRow key={run.id}>
              <TableCell>
                <LocalDateTime iso={run.claimedAt} />
              </TableCell>
              <TableCell>{run.entryId ? entryName(entriesById.get(run.entryId)) : '—'}</TableCell>
              <TableCell>
                <span dir="ltr" className="tabular-nums">
                  {run.localDate} {run.slotTime}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={status?.tone ?? 'neutral'}>{status?.label ?? run.status}</Badge>
              </TableCell>
              <TableCell>{run.channel ? (CHANNEL_LABELS[run.channel] ?? run.channel) : '—'}</TableCell>
              <TableCell>{run.errorCode ? (CODE_LABELS[run.errorCode] ?? run.errorCode) : '—'}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
